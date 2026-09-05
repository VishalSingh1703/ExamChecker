"""Application factory and FastAPI instance.

Mirrors Guardian's ``app/main.py``: each capability package owns its own
``router.py``, so adding a feature is a package plus one ``include_router``
line rather than an edit to a handler in here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.viva import router as viva


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title="ExamChecker Viva Voice Service",
        description="Pipecat + Sarvam STT + Murf TTS oral-exam agent for the ExamChecker practice paper",
        version="0.1.0",
    )

    # The SPA runs on a different origin (Vite dev server, or Vercel later).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=False,  # no cookies; nothing here is authenticated yet
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(viva.router)

    return app


app = create_app()
