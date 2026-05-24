from __future__ import annotations

import re

from loguru import logger

from app.ai.groq_client import get_groq_client
from app.core.config import Settings


CHAT_PROMPT = """You are Legalese AI.
Answer only using the supplied document context.
If the answer is not in the context, say you cannot find it in the document.
Do not talk about outside world you can use outside knowledge to explain about the topic but from document only.
Return concise, grounded answers.
"""


def answer_question(settings: Settings, question: str, context: str, language: str) -> str:
    client = get_groq_client(settings)
    if not client:
        return "I cannot find that in the Document."

    try:
        completion = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0.1,
            messages=[
                {"role": "system", "content": CHAT_PROMPT},
                {"role": "user", "content": f"Language: {language}\nContext:\n{context}\nQuestion: {question}"},
            ],
        )
        return completion.choices[0].message.content or "I cannot find that in the Document."
    except Exception as exc:
        logger.warning("Chat answer generation failed: {}", exc)
        return "I cannot find that in the Document."
