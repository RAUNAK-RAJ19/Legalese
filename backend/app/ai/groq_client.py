from __future__ import annotations

from groq import Groq

from app.core.config import Settings


def get_groq_client(settings: Settings) -> Groq | None:
    if not settings.groq_api_key:
        return None
    return Groq(api_key=settings.groq_api_key)
