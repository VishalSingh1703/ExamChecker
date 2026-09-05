"""Pipecat pipeline for one viva session.

Ported from Guardian's ``run_agent_sarvam_gemini_murf_twilio``
(``Guardian-Server/app/telephony/service.py:578``). Same Pipecat 1.6.0, same
Sarvam STT, same Murf TTS, same Silero VAD. What changed:

1. ``ProtobufFrameSerializer`` replaces ``TwilioFrameSerializer`` — the audio
   comes from a browser, not a phone call.
2. 16 kHz in / 24 kHz out replaces 8 kHz both ways, which existed only because
   Twilio media streams are µ-law 8 kHz.
3. The LLM is gone. Guardian's conversation is open-ended; a viva reads a
   fixed, ordered paper, so ``VivaOrchestrator`` is the whole turn logic and
   the context aggregators, turn strategies and ``terminate_call`` tool all
   drop out.
4. Two Guardian bugs are deliberately not carried over — see the comments on
   ``multi_native_locale`` and on the VAD sample rate below.
"""

import asyncio

from fastapi import WebSocket
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frameworks.rtvi import RTVIObserver, RTVIProcessor
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat_murf_tts import MurfTTSService

from app.config import settings
from app.viva.session import InputAudioGate, VivaOrchestrator

# Guardian carries a 31-entry map for every Indian language Sarvam supports.
# This service ships English only by decision, so the map is the seam where
# more languages get added rather than a table of unused entries.
LANGUAGE_MAP: dict[str, Language] = {
    "en-IN": Language.EN_IN,
    "hi-IN": Language.HI_IN,
}


def build_vad() -> VADProcessor:
    """Silero VAD, the single source of truth for turn detection.

    Note the absent ``sample_rate``. Guardian pins ``SileroVADAnalyzer(
    sample_rate=8000)`` while its serializer feeds the pipeline at 16 kHz, and
    ``VADAnalyzer.set_sample_rate`` honours the constructor value first — so its
    VAD analyses at the wrong rate. Leaving it off lets the ``StartFrame`` set
    it correctly.
    """
    return VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(
                confidence=settings.VAD_CONFIDENCE,
                start_secs=settings.VAD_START_SECS,
                stop_secs=settings.VAD_STOP_SECS,
            )
        )
    )


def build_tts() -> MurfTTSService:
    """Murf streaming TTS, configured for browser playback."""
    murf = settings.murf_params()
    logger.info(f"[viva] murf voice: {murf}")
    return MurfTTSService(
        api_key=settings.MURF_API_KEY,
        params=MurfTTSService.InputParams(
            voice_id=murf["voice_id"],
            style=murf["style"],
            rate=murf["rate"],
            pitch=murf["pitch"],
            variation=murf["variation"],
            model=murf["model"],
            # The field is `multi_native_locale`. Guardian passes `locale=`,
            # which InputParams does not declare, so pydantic drops it and its
            # language never reaches Murf.
            multi_native_locale=murf["multi_native_locale"],
            sample_rate=settings.AUDIO_OUT_SAMPLE_RATE,
            format="PCM",
            channel_type="MONO",
        ),
    )


def build_stt(language: str) -> SarvamSTTService:
    """Sarvam streaming STT.

    ``vad_signals`` stays off so Silero above is the only thing deciding when a
    turn ends — two VADs disagreeing is worse than either alone. ``saarika:v2.5``
    emits one ``TranscriptionFrame`` per finalized utterance and no interim
    frames, so the browser sees an answer grow chunk by chunk rather than word
    by word.
    """
    return SarvamSTTService(
        api_key=settings.SARVAM_API_KEY,
        settings=SarvamSTTService.Settings(
            model=settings.SARVAM_STT_MODEL,
            language=LANGUAGE_MAP.get(language, Language.EN_IN),
            vad_signals=False,
            high_vad_sensitivity=False,
        ),
        keepalive_timeout=10.0,
        ttfs_p99_latency=0.35,
    )


async def run_viva_agent(websocket: WebSocket, language: str | None = None) -> None:
    """Run one viva session until the paper ends or the browser disconnects."""
    if not settings.SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY is required")
    if not settings.MURF_API_KEY:
        raise ValueError("MURF_API_KEY is required")

    lang = language or settings.LANGUAGE

    transport = FastAPIWebsocketTransport(
        websocket,
        params=FastAPIWebsocketParams(
            serializer=ProtobufFrameSerializer(),
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            audio_in_sample_rate=settings.AUDIO_IN_SAMPLE_RATE,
            audio_out_sample_rate=settings.AUDIO_OUT_SAMPLE_RATE,
            allowed_origins=settings.ALLOWED_ORIGINS,
        ),
    )

    rtvi = RTVIProcessor()
    gate = InputAudioGate()
    orchestrator = VivaOrchestrator(
        rtvi=rtvi,
        gate=gate,
        silence_secs=settings.ANSWER_SILENCE_SECS,
        max_questions=settings.MAX_QUESTIONS,
    )

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,           # control messages, both directions
            gate,           # mic muted unless the student should be answering
            build_vad(),    # VADUser{Started,Stopped}SpeakingFrame
            build_stt(lang),
            orchestrator,   # the state machine; emits TTSSpeakFrame
            build_tts(),
            transport.output(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=settings.AUDIO_IN_SAMPLE_RATE,
            audio_out_sample_rate=settings.AUDIO_OUT_SAMPLE_RATE,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[RTVIObserver(rtvi)],
    )

    async def _enforce_hard_limit() -> None:
        """Never leave a forgotten browser tab holding a metered voice session."""
        await asyncio.sleep(settings.MAX_SESSION_SECS)
        logger.info(f"[viva] session hit the {settings.MAX_SESSION_SECS}s cap")
        await task.cancel()

    timeout_handle = asyncio.create_task(_enforce_hard_limit())

    @rtvi.event_handler("on_client_ready")
    async def _on_client_ready(processor: RTVIProcessor):
        # The browser is set up and listening. Nothing is spoken until it sends
        # viva:start with the paper.
        await processor.set_bot_ready()
        await processor.send_server_message({"t": "ready"})

    @transport.event_handler("on_client_connected")
    async def _on_connected(_transport, _client):
        logger.info("[viva] browser connected")

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_transport, _client):
        logger.info("[viva] browser disconnected")
        await task.cancel()

    try:
        await PipelineRunner(handle_sigint=False).run(task)
    finally:
        timeout_handle.cancel()
