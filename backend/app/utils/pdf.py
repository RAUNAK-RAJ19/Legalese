from __future__ import annotations

import fitz


def extract_text_and_pages(pdf_bytes: bytes) -> tuple[str, int]:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = document.page_count
    text_parts = []
    for page in document:
        text_parts.append(page.get_text("text"))
    return "\n".join(text_parts).strip(), pages
