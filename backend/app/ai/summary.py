from __future__ import annotations

import json

from loguru import logger

from app.ai.groq_client import get_groq_client
from app.core.config import Settings


SUMMARY_PROMPT = """You are a legal document assistant.
Summarize the supplied clause or document in concise bullet style.
Return JSON with keys: english, hindi.
Use only the supplied text.
"""


def generate_summary(settings: Settings, text: str, language: str = "English") -> dict[str, str]:
    client = get_groq_client(settings)
    if not client:
        return {
            "english": text[:1200] or "Summary unavailable.",
            "hindi": "सारांश उपलब्ध नहीं है।",
        }

    try:
        completion = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0.1,
            messages=[
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": f"Language: {language}\nText:\n{text}"},
            ],
        )
        content = completion.choices[0].message.content or "{}"
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
    except Exception as exc:
        logger.warning("Summary generation failed: {}", exc)

    return {
        "english": text[:1200] or "Summary unavailable.",
        "hindi": "सारांश उपलब्ध नहीं है।",
    }
