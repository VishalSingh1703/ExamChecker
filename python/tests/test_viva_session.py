"""Drives VivaOrchestrator through a full paper without touching Sarvam or Murf.

The orchestrator is where every behavioural decision lives — when the mic opens,
when an answer is captured, and whether the paper can be rewound — so it is the
one piece worth testing offline. Run with:

    ./.venv/bin/python -m tests.test_viva_session
"""

import asyncio
import sys

from loguru import logger

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    InputAudioRawFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frameworks.rtvi import RTVIClientMessageFrame
from pipecat.tests.utils import SleepFrame, run_test

from app.viva.models import CLIENT_NEXT, CLIENT_REPEAT, CLIENT_START
from app.viva.session import InputAudioGate, VivaOrchestrator

# Pipecat logs every frame link at DEBUG, which buries the results.
logger.remove()
logger.add(sys.stderr, level="WARNING")

SILENCE = 0.3  # shortened from the 2.5s default so the test runs quickly


class StubRTVI:
    """Captures what the orchestrator would have sent to the browser."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send_server_message(self, data):
        self.sent.append(data)

    def types(self) -> list[str]:
        return [m["t"] for m in self.sent]

    def last(self, t: str) -> dict | None:
        for m in reversed(self.sent):
            if m["t"] == t:
                return m
        return None


def client(msg_type: str, **data) -> RTVIClientMessageFrame:
    """A control message as the browser would send it."""
    return RTVIClientMessageFrame(msg_id="test", type=msg_type, data=data)


def said(text: str) -> TranscriptionFrame:
    """A finalized Sarvam transcript chunk."""
    return TranscriptionFrame(text, "student", "2026-01-01T00:00:00Z")


def build():
    """A fresh gate + orchestrator pair wired to a stub RTVI channel."""
    rtvi = StubRTVI()
    gate = InputAudioGate()
    orch = VivaOrchestrator(
        rtvi=rtvi, gate=gate, silence_secs=SILENCE, max_questions=25
    )
    return rtvi, gate, orch


PAPER = [
    {"id": 1, "text": "Define photosynthesis.", "marks": 2},
    {"id": 2, "text": "Name two products of photosynthesis.", "marks": 2},
]


async def test_full_paper():
    """One question spoken, answered, captured, then advanced to the next."""
    rtvi, gate, orch = build()

    down, _ = await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER, language="en-IN"),
            SleepFrame(sleep=0.05),
            # The question has finished playing out of the speaker.
            BotStoppedSpeakingFrame(),
            SleepFrame(sleep=0.05),
            said("Photosynthesis is the process"),
            said("by which plants make food"),
            SleepFrame(sleep=0.05),
            VADUserStoppedSpeakingFrame(stop_secs=0.8),
            SleepFrame(sleep=SILENCE + 0.2),  # let the capture timer fire
            client(CLIENT_NEXT, index=0),
            SleepFrame(sleep=0.05),
        ],
    )

    assert rtvi.types()[:4] == ["question", "speaking", "listening", "transcript"], rtvi.types()

    q1 = rtvi.sent[0]
    assert q1["questionId"] == 1 and q1["index"] == 0 and q1["total"] == 2, q1

    captured = rtvi.last("captured")
    assert captured is not None, "answer was never captured"
    assert captured["text"] == "Photosynthesis is the process by which plants make food", captured

    # Advancing re-asks, so a second question announcement must follow.
    assert rtvi.types().count("question") == 2, rtvi.types()
    assert rtvi.last("question")["questionId"] == 2, rtvi.last("question")

    spoken = [f.text for f in down if isinstance(f, TTSSpeakFrame)]
    assert spoken == [PAPER[0]["text"], PAPER[1]["text"]], spoken
    print("PASS  full paper: ask → listen → transcript → capture → advance")


async def test_mic_is_gated_while_examiner_speaks():
    """Murf's own voice must never reach the transcriber."""
    _, gate, orch = build()

    await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER),
            SleepFrame(sleep=0.05),
        ],
    )
    assert gate.open is False, "mic was open while the question was being read"

    # The gate itself drops audio when closed and passes it when open.
    gate_only = InputAudioGate()
    audio = InputAudioRawFrame(audio=b"\x00\x00", sample_rate=16000, num_channels=1)
    down, _ = await run_test(gate_only, frames_to_send=[audio])
    assert not any(isinstance(f, InputAudioRawFrame) for f in down), "closed gate leaked audio"

    gate_only2 = InputAudioGate()
    gate_only2.open = True
    down2, _ = await run_test(gate_only2, frames_to_send=[audio])
    assert any(isinstance(f, InputAudioRawFrame) for f in down2), "open gate dropped audio"
    print("PASS  mic gate: closed while asking, drops audio when closed")


async def test_thinking_pause_does_not_capture_early():
    """Speaking again after a pause must cancel the pending capture."""
    rtvi, _, orch = build()

    await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER),
            SleepFrame(sleep=0.05),
            BotStoppedSpeakingFrame(),
            SleepFrame(sleep=0.05),
            said("Photosynthesis is"),
            VADUserStoppedSpeakingFrame(stop_secs=0.8),
            SleepFrame(sleep=SILENCE * 0.5),      # half-way through the grace period
            VADUserStartedSpeakingFrame(start_secs=0.2),  # ...they carry on
            said("the process plants use"),
            SleepFrame(sleep=SILENCE * 0.8),      # would have fired by now
        ],
    )

    assert rtvi.last("captured") is None, "captured mid-answer during a thinking pause"
    assert rtvi.last("transcript")["text"] == "Photosynthesis is the process plants use"
    print("PASS  thinking pause: resuming speech cancels the capture timer")


async def test_cannot_go_back():
    """A viva is one-way, and the server is what enforces it."""
    rtvi, _, orch = build()

    await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER),
            SleepFrame(sleep=0.05),
            client(CLIENT_NEXT, index=0),   # legitimate: 0 → 1
            SleepFrame(sleep=0.05),
            client(CLIENT_NEXT, index=0),   # stale/forged: would rewind to 0
            SleepFrame(sleep=0.05),
        ],
    )

    err = rtvi.last("error")
    assert err is not None, "backwards jump was accepted"
    assert "does not go back" in err["message"], err
    # Still exactly two questions asked — the rewind changed nothing.
    assert rtvi.types().count("question") == 2, rtvi.types()
    print("PASS  irreversibility: a backwards next is rejected server-side")


async def test_repeat_keeps_the_answer():
    """Re-reading the question must not discard what was already said."""
    rtvi, _, orch = build()

    down, _ = await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER),
            SleepFrame(sleep=0.05),
            BotStoppedSpeakingFrame(),
            SleepFrame(sleep=0.05),
            said("Something about plants"),
            SleepFrame(sleep=0.05),
            client(CLIENT_REPEAT, index=0),
            SleepFrame(sleep=0.05),
            BotStoppedSpeakingFrame(),
            SleepFrame(sleep=0.05),
            said("and sunlight"),
            SleepFrame(sleep=0.05),
        ],
    )

    assert rtvi.last("transcript")["text"] == "Something about plants and sunlight"
    spoken = [f.text for f in down if isinstance(f, TTSSpeakFrame)]
    assert spoken == [PAPER[0]["text"], PAPER[0]["text"]], spoken
    print("PASS  repeat: question re-read, existing answer preserved")


async def test_last_question_completes():
    """Advancing past the final question ends the paper."""
    rtvi, gate, orch = build()

    await run_test(
        orch,
        frames_to_send=[
            client(CLIENT_START, questions=PAPER),
            SleepFrame(sleep=0.05),
            client(CLIENT_NEXT, index=0),
            SleepFrame(sleep=0.05),
            client(CLIENT_NEXT, index=1),
            SleepFrame(sleep=0.05),
        ],
    )

    assert rtvi.last("complete") is not None, rtvi.types()
    assert gate.open is False, "mic left open after the paper finished"
    print("PASS  completion: advancing past the last question ends the paper")


async def test_oversized_paper_is_refused():
    """The 25-question cap the frontend enforces is also enforced here."""
    rtvi, _, orch = build()
    big = [{"id": i, "text": f"Q{i}", "marks": 1} for i in range(1, 30)]

    await run_test(
        orch,
        frames_to_send=[client(CLIENT_START, questions=big), SleepFrame(sleep=0.05)],
    )

    err = rtvi.last("error")
    assert err is not None and "limit is 25" in err["message"], rtvi.sent
    assert rtvi.last("question") is None, "started an oversized paper anyway"
    print("PASS  limits: a 29-question paper is refused, nothing is spoken")


TESTS = [
    test_full_paper,
    test_mic_is_gated_while_examiner_speaks,
    test_thinking_pause_does_not_capture_early,
    test_cannot_go_back,
    test_repeat_keeps_the_answer,
    test_last_question_completes,
    test_oversized_paper_is_refused,
]


async def main() -> int:
    failures = 0
    for test in TESTS:
        try:
            await test()
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {test.__name__}: {e}")
        except Exception as e:
            failures += 1
            print(f"ERROR {test.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
