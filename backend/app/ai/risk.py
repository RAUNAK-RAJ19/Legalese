from __future__ import annotations

import json
import re

from loguru import logger

from app.ai.groq_client import get_groq_client
from app.core.config import Settings


RISK_PROMPT = """You are a legal risk analyst.
Extract risks from the supplied clause.
Return JSON with keys: severity, summary, category, mitigation.
Severity must be one of Low, Medium, High, Critical, Warning.
Use only the supplied text.
"""


def _fallback_risk(text: str) -> dict[str, str]:
    lowered = text.lower()
    if any(word in lowered for word in ["terminate", "liability", "indemnify", "penalty", "auto-renew"]):
        severity = "High"
    elif any(word in lowered for word in ["fees", "payment", "credit", "refund"]):
        severity = "Warning"
    else:
        severity = "Low"
    return {
        "severity": severity,
        "summary": text[:220] or "No explicit risk detected.",
        "category": "Legal",
        "mitigation": "Review with legal counsel before signing.",
    }


def analyze_risk(settings: Settings, text: str) -> dict[str, str]:
    client = get_groq_client(settings)
    if not client:
        return _fallback_risk(text)

    try:
        completion = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0.0,
            messages=[
                {"role": "system", "content": RISK_PROMPT},
                {"role": "user", "content": f"Clause:\n{text}"},
            ],
        )
        content = completion.choices[0].message.content or "{}"
        match = re.search(r"\{.*\}", content, re.S)
        if match:
            payload = json.loads(match.group(0))
            return {
                "severity": payload.get("severity", "Low"),
                "summary": payload.get("summary", text[:220]),
                "category": payload.get("category", "Legal"),
                "mitigation": payload.get("mitigation", "Review with legal counsel before signing."),
            }
    except Exception as exc:
        logger.warning("Risk analysis failed: {}", exc)
    return _fallback_risk(text)
