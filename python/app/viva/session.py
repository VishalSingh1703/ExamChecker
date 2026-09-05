"""The viva turn logic.

Two processors:

- ``InputAudioGate`` drops microphone frames unless the student is actually
  meant to be answering. Guardian wrote this class and never wired it into a
  pipeline; here it is load-bearing, because the examiner's own voice coming
  back through the laptop speaker would otherwise be transcribed as the
  student's answer.
- ``VivaOrchestrator`` holds the state machine. Guardian handed turn-taking to
  an LLM plus ``UserTurnStrategies``; a viva reads a fixed, ordered paper, so
  the whole thing is explicit here instead. That is also what makes the flow
  irreversible by construction rather than by hiding a button.
"""

import asyncio
from enum import Enum

from loguru import logger
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    Frame,
    InputAudioRawFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIClientMessageFrame, RTVIProcessor

from app.viva.models import (
    CLIENT_END,
    CLIENT_NEXT,
    CLIENT_REPEAT,
    CLIENT_START,
    IndexPayload,
    StartPayload,
    VivaQuestion,
    msg,
)


class VivaState(str, Enum):
    """Where the examiner is in the current question."""

    IDLE = "idle"            # connected, waiting for the paper
    ASKING = "asking"        # TTS is speaking; mic gated shut
    LISTENING = "listening"  # mic open, transcripts accumulating
    CAPTURED = "captured"    # silence crossed; waiting for the student to move on
    COMPLETE = "complete"    # paper finished


class InputAudioGate(FrameProcessor):
    """Passes microphone audio through only while ``open`` is True.

    Everything else flows untouched — this drops ``InputAudioRawFrame`` and
    nothing more, so VAD and STT simply see silence while the examiner talks.
    Sarvam's connection survives the gap because the service is constructed
    with ``keepalive_timeout``.
    """

    def __init__(self, **kwargs):
        """Start closed: the examiner speaks first."""
        super().__init__(**kwargs)
        self.open = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Forward every frame except gated-out microphone audio."""
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame) and not self.open:
            return

        await self.push_frame(frame, direction)


class VivaOrchestrator(FrameProcessor):
    """Drives the paper: speak a question, listen, capture, wait, advance.

    Reads (all arriving downstream unless noted):

    - ``RTVIClientMessageFrame``       — start / next / repeat / end
    - ``TranscriptionFrame``           — Sarvam finals, appended to the answer
    - ``VADUserStartedSpeakingFrame``  — cancels the pending silence timer
    - ``VADUserStoppedSpeakingFrame``  — starts it
    - ``BotStoppedSpeakingFrame``      — arrives UPSTREAM from the output
      transport once the question has finished *playing*, which is the only
      accurate moment to open the mic

    Writes ``TTSSpeakFrame`` downstream and every status update to the client
    through the RTVI processor.
    """

    def __init__(
        self,
        *,
        rtvi: RTVIProcessor,
        gate: InputAudioGate,
        silence_secs: float,
        max_questions: int,
        **kwargs,
    ):
        """Wire the orchestrator to its RTVI channel and mic gate."""
        super().__init__(**kwargs)
        self._rtvi = rtvi
        self._gate = gate
        self._silence_secs = silence_secs
        self._max_questions = max_questions

        self._questions: list[VivaQuestion] = []
        self._index = 0
        self._state = VivaState.IDLE
        # Final transcript chunks for the current question, in arrival order.
        self._chunks: list[str] = []
        self._silence_task: asyncio.Task | None = None

    # ── helpers ──────────────────────────────────────────────────────────────

    @property
    def _current(self) -> VivaQuestion | None:
        """The question being asked, or None outside the paper's bounds."""
        if 0 <= self._index < len(self._questions):
            return self._questions[self._index]
        return None

    def _answer(self) -> str:
        """Everything transcribed for the current question so far."""
        return " ".join(c for c in self._chunks if c).strip()

    async def _send(self, t: str, **fields) -> None:
        """Push one status message to the browser."""
        await self._rtvi.send_server_message(msg(t, **fields))

    async def _cancel_silence(self) -> None:
        """Stop a pending capture. Safe to call when none is scheduled."""
        if self._silence_task:
            task, self._silence_task = self._silence_task, None
            await self.cancel_task(task)

    # ── state transitions ────────────────────────────────────────────────────

    async def _ask(self, index: int) -> None:
        """Speak question ``index`` and close the mic until it finishes playing."""
        self._index = index
        self._chunks = []
        await self._cancel_silence()

        question = self._current
        if question is None:
            await self._finish()
            return

        self._state = VivaState.ASKING
        self._gate.open = False

        await self._send(
            "question",
            index=self._index,
            questionId=question.id,
            text=question.text,
            marks=question.marks,
            total=len(self._questions),
        )
        await self._send("speaking", index=self._index)

        logger.info(f"[viva] asking Q{self._index + 1}/{len(self._questions)}")
        # append_to_context=False: there is no LLM context to pollute.
        await self.push_frame(TTSSpeakFrame(text=question.text, append_to_context=False))

    async def _listen(self) -> None:
        """Open the mic. Called when the question has finished playing."""
        if self._state is not VivaState.ASKING:
            return
        self._state = VivaState.LISTENING
        self._gate.open = True
        logger.info(f"[viva] listening for Q{self._index + 1}")
        await self._send("listening", index=self._index)

    async def _capture(self) -> None:
        """Freeze the current answer and wait for the student to move on."""
        if self._state is not VivaState.LISTENING:
            return
        self._state = VivaState.CAPTURED
        self._gate.open = False
        answer = self._answer()
        logger.info(f"[viva] captured Q{self._index + 1} ({len(answer)} chars)")
        await self._send("captured", index=self._index, text=answer)

    async def _finish(self) -> None:
        """Mark the paper done and stop listening for good."""
        self._state = VivaState.COMPLETE
        self._gate.open = False
        await self._cancel_silence()
        logger.info("[viva] paper complete")
        await self._send("complete")

    async def _schedule_capture(self) -> None:
        """Capture the answer if the student stays quiet for the grace period.

        Restarted on every pause, so a student who thinks mid-answer and then
        keeps going never loses what they already said.
        """
        await self._cancel_silence()

        async def _wait() -> None:
            try:
                await asyncio.sleep(self._silence_secs)
            except asyncio.CancelledError:
                return
            await self._capture()

        self._silence_task = self.create_task(_wait(), name="viva_silence")

    # ── client messages ──────────────────────────────────────────────────────

    async def _handle_client_message(self, frame: RTVIClientMessageFrame) -> None:
        """Apply one control message from the browser."""
        data = frame.data if isinstance(frame.data, dict) else {}

        if frame.type == CLIENT_START:
            payload = StartPayload.model_validate(data)
            questions = [q for q in payload.questions if q.text.strip()]
            if not questions:
                await self._send("error", message="No questions were sent.")
                return
            if len(questions) > self._max_questions:
                await self._send(
                    "error",
                    message=f"That paper has {len(questions)} questions; the limit is {self._max_questions}.",
                )
                return
            self._questions = questions
            logger.info(f"[viva] starting a {len(questions)}-question paper")
            await self._ask(0)
            return

        if frame.type == CLIENT_NEXT:
            index = IndexPayload.model_validate(data).index
            # Irreversibility is enforced here, not in the UI. A viva does not
            # go back, so a stale or hand-crafted message cannot make it.
            if index < self._index:
                logger.warning(
                    f"[viva] rejected next(index={index}); already on {self._index}"
                )
                await self._send(
                    "error",
                    message="A viva does not go back to an earlier question.",
                )
                return
            if self._index + 1 >= len(self._questions):
                await self._finish()
            else:
                await self._ask(self._index + 1)
            return

        if frame.type == CLIENT_REPEAT:
            question = self._current
            if question is None or self._state is VivaState.COMPLETE:
                return
            # Re-speak without clearing what has already been transcribed.
            logger.info(f"[viva] repeating Q{self._index + 1}")
            self._state = VivaState.ASKING
            self._gate.open = False
            await self._cancel_silence()
            await self._send("speaking", index=self._index)
            await self.push_frame(
                TTSSpeakFrame(text=question.text, append_to_context=False)
            )
            return

        if frame.type == CLIENT_END:
            await self._finish()

    # ── frame processing ─────────────────────────────────────────────────────

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Advance the state machine, then forward the frame untouched."""
        await super().process_frame(frame, direction)

        if isinstance(frame, RTVIClientMessageFrame):
            try:
                await self._handle_client_message(frame)
            except Exception as e:  # a malformed message must not kill the session
                logger.exception(f"[viva] bad client message {frame.type!r}: {e}")
                await self._send("error", message="That request could not be handled.")

        elif isinstance(frame, BotStoppedSpeakingFrame):
            # Pushed both ways by the output transport; the upstream copy is the
            # one that reaches us, and it means the audio has finished playing.
            await self._listen()

        elif isinstance(frame, TranscriptionFrame):
            if self._state is VivaState.LISTENING and frame.text.strip():
                self._chunks.append(frame.text.strip())
                await self._send(
                    "transcript", index=self._index, text=self._answer()
                )

        elif isinstance(frame, VADUserStartedSpeakingFrame):
            await self._cancel_silence()

        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            # Nothing said yet means the pause is not the end of an answer.
            if self._state is VivaState.LISTENING and self._chunks:
                await self._schedule_capture()

        await self.push_frame(frame, direction)

    async def cleanup(self):
        """Drop the pending capture timer before the pipeline tears down."""
        await self._cancel_silence()
        await super().cleanup()
