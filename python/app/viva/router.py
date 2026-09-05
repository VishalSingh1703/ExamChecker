"""HTTP and websocket surface for the viva service."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger

from app.config import settings
from app.viva.service import run_viva_agent

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Liveness plus a straight answer on whether the voice keys are present.

    The frontend uses this to decide whether to offer Viva at all, so a missing
    key surfaces as a disabled option rather than a websocket that opens and
    then dies.
    """
    return {
        "status": "ok",
        "voice_configured": settings.voice_configured,
        "language": settings.LANGUAGE,
    }


@router.websocket("/ws/viva")
async def viva_websocket(websocket: WebSocket) -> None:
    """One browser, one viva session.

    Guardian's ``/ws`` has to hand-read two JSON frames before Pipecat can take
    over, because Twilio opens with a ``connected``/``start`` handshake carrying
    the stream and call ids. A browser has no such preamble: the transport owns
    the socket from ``accept()`` onward, and the paper arrives later as a
    ``viva:start`` control message.
    """
    await websocket.accept()

    if not settings.voice_configured:
        logger.error("[viva] refused: SARVAM_API_KEY / MURF_API_KEY not set")
        await websocket.close(code=1011, reason="Voice service is not configured")
        return

    try:
        await run_viva_agent(websocket)
    except WebSocketDisconnect:
        logger.info("[viva] websocket closed by the browser")
    except Exception as e:
        logger.exception(f"[viva] session failed: {e}")
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            # Already closed by the transport's own teardown.
            pass
