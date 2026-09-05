"""Local development entrypoint.

Run with ``python run.py`` from the ``python/`` directory — python-dotenv
searches upward from the working directory, so starting it elsewhere silently
skips ``.env``.
"""

import os

import uvicorn

from app.config import settings

if __name__ == "__main__":
    # Uvicorn auto-reload is known to hang on Windows with background asyncio
    # websockets, which is the entire workload here.
    reload_default = "false" if os.name == "nt" else "true"
    reload_flag = os.getenv("RELOAD", reload_default).lower() == "true"

    if not settings.voice_configured:
        print("WARNING: SARVAM_API_KEY / MURF_API_KEY are not set — /ws/viva will refuse connections.")

    print(f"Viva voice service on {settings.HOST}:{settings.PORT} (reload={reload_flag})")
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=reload_flag)
