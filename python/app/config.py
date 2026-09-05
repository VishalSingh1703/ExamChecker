"""Centralized configuration for the viva voice service.

Single source of truth for every environment-driven value. Other modules read
from ``settings`` rather than calling ``os.getenv`` directly, so each env key
and its default is declared exactly once.

Guardian splits this: ``app/config.py`` holds the documented keys while
``app/telephony/service.py`` reaches for ``os.getenv`` on a dozen more (the
VAD_* and MURF_* knobs), which is why they never made it into its
``.env.example``. Everything lives here instead.
"""

import json
import os

from dotenv import load_dotenv

# Load a local .env once, at import time, for the whole app. dotenv searches
# upward from the CWD, so start the server from the `python/` directory.
load_dotenv(override=True)


def _int(name: str, default: int) -> int:
    """Read an int env var, falling back to the default on anything unparseable."""
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    """Read a float env var, falling back to the default on anything unparseable."""
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


class Settings:
    """Typed accessors for the service's environment configuration."""

    # --- Server ---
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = _int("PORT", 8080)
    ALLOWED_ORIGINS: list[str] = [
        o.strip()
        for o in os.getenv(
            "VIVA_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o.strip()
    ]

    # --- Voice providers ---
    SARVAM_API_KEY: str = os.getenv("SARVAM_API_KEY", "")
    MURF_API_KEY: str = os.getenv("MURF_API_KEY", "")

    # --- Language ---
    LANGUAGE: str = os.getenv("VIVA_LANGUAGE", "en-IN")

    # --- Sarvam STT ---
    SARVAM_STT_MODEL: str = os.getenv("SARVAM_STT_MODEL", "saarika:v2.5")

    # --- Silero VAD ---
    VAD_CONFIDENCE: float = _float("VAD_CONFIDENCE", 0.7)
    VAD_START_SECS: float = _float("VAD_START_SECS", 0.2)
    VAD_STOP_SECS: float = _float("VAD_STOP_SECS", 0.8)

    # --- Viva pacing ---
    ANSWER_SILENCE_SECS: float = _float("VIVA_ANSWER_SILENCE_SECS", 2.5)
    MAX_SESSION_SECS: int = _int("VIVA_MAX_SESSION_SECS", 1800)
    MAX_QUESTIONS: int = _int("VIVA_MAX_QUESTIONS", 25)

    # --- Audio rates ---
    # 16 kHz in / 24 kHz out are the pipecat defaults and what the browser
    # transport speaks. Guardian ran 8 kHz both ways only because Twilio's
    # media stream is µ-law 8 kHz — that constraint is gone.
    AUDIO_IN_SAMPLE_RATE: int = _int("VIVA_AUDIO_IN_SAMPLE_RATE", 16000)
    AUDIO_OUT_SAMPLE_RATE: int = _int("VIVA_AUDIO_OUT_SAMPLE_RATE", 24000)

    @property
    def voice_configured(self) -> bool:
        """True when both provider keys are present."""
        return bool(self.SARVAM_API_KEY and self.MURF_API_KEY)

    def murf_params(self) -> dict:
        """Resolve the Murf voice configuration from the environment.

        ``MURF_VOICE_ID`` accepts either a bare voice id or a JSON object that
        overrides several fields at once, matching how Guardian's live .env is
        written.
        """
        res = {
            "voice_id": "en-IN-arohi",
            "style": os.getenv("MURF_STYLE", "Conversational"),
            "model": os.getenv("MURF_MODEL", "falcon-2"),
            "rate": _int("MURF_RATE", 0),
            "pitch": _int("MURF_PITCH", 0),
            "variation": _int("MURF_VARIATION", 1),
        }

        raw_voice = os.getenv("MURF_VOICE_ID", "").strip()
        if raw_voice:
            try:
                parsed = json.loads(raw_voice)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                for key in ("voice_id", "style", "model", "rate", "pitch", "variation"):
                    if key in parsed:
                        res[key] = parsed[key]
                # A JSON blob may carry the locale under Murf's own field name.
                if "multi_native_locale" in parsed:
                    res["multi_native_locale"] = parsed["multi_native_locale"]
            else:
                res["voice_id"] = raw_voice

        # Murf accepts exactly these three model identifiers.
        model = str(res["model"]).strip()
        if model.upper() in ("FALCON-2", "FALCON_2"):
            res["model"] = "falcon-2"
        elif model.upper() == "GEN2":
            res["model"] = "GEN2"
        elif model.upper() == "FALCON":
            res["model"] = "FALCON"
        else:
            res["model"] = "falcon-2"

        # NOTE: the field is `multi_native_locale`, NOT `locale`. Guardian sets
        # `locale` and passes it through; MurfTTSService.InputParams has no such
        # field, so pydantic drops it and its configured language never reaches
        # Murf at all. Do not copy that.
        res.setdefault("multi_native_locale", self.LANGUAGE)
        return res


settings = Settings()
