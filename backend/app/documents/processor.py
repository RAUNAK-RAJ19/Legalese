from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from loguru import logger
from sqlalchemy.orm import Session

from app.ai.embeddings import EmbeddingService
from app.ai.risk import analyze_risk
from app.ai.summary import generate_summary
from app.ai.vector_store import VectorStoreService
from app.core.config import Settings
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.document import Document, DocumentChunk
from app.utils.pdf import extract_text_and_pages
from app.utils.text import chunk_text
from app.utils.storage import StorageService


class DocumentProcessor:
    def __init__(self, db: Session, settings: Settings, storage: StorageService, embeddings: EmbeddingService, vector_store: VectorStoreService):
        self.db = db
        self.settings = settings
        self.storage = storage
        self.embeddings = embeddings
        self.vector_store = vector_store

    def process(self, document_id: str) -> None:
        document = self.db.query(Document).filter(Document.id == document_id).one_or_none()
        if document is None:
            return

        try:
            pdf_bytes = self.storage.download_pdf(document.pdf_storage_path or "")
            text, pages = extract_text_and_pages(pdf_bytes)
            document.text = text
            document.pages = pages

            chunks = chunk_text(text)
            db_chunks: list[DocumentChunk] = []
            vector_chunks: list[dict[str, object]] = []
            risk_score = 0
            summaries_en: list[str] = []
            summaries_hi: list[str] = []

            for index, chunk_text_value in enumerate(chunks):
                chunk_id = f"{document_id}-{index}"
                summary = generate_summary(self.settings, chunk_text_value)
                risk = analyze_risk(self.settings, chunk_text_value)
                severity = risk.get("severity", "Low")
                severity_weight = {"Critical": 35, "High": 25, "Warning": 15, "Medium": 10, "Low": 0}.get(severity, 0)
                risk_score += severity_weight

                english = summary.get("english") or chunk_text_value[:500]
                hindi = summary.get("hindi") or "सारांश उपलब्ध नहीं है।"
                summaries_en.append(english)
                summaries_hi.append(hindi)

                db_chunks.append(
                    DocumentChunk(
                        id=chunk_id,
                        document_id=document_id,
                        user_id=document.user_id,
                        title=f"Section {index + 1}",
                        original=chunk_text_value,
                        english=english,
                        hindi=hindi,
                        risk=severity,
                        category=risk.get("category"),
                        mitigation=risk.get("mitigation"),
                        risk_payload=json.dumps(risk),
                    )
                )

                vector_chunks.append(
                    {
                        "id": chunk_id,
                        "text": chunk_text_value,
                        "embedding": self.embeddings.embed_text(chunk_text_value),
                        "metadata": {
                            "document_id": document_id,
                            "user_id": document.user_id,
                            "chunk_id": chunk_id,
                            "title": f"Section {index + 1}",
                        },
                    }
                )

            self.db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
            for chunk in db_chunks:
                self.db.add(chunk)

            self.vector_store.upsert_chunks(vector_chunks)
            document.summary_english = "\n\n".join(summaries_en) if summaries_en else "Summary unavailable."
            document.summary_hindi = "\n\n".join(summaries_hi) if summaries_hi else "सारांश उपलब्ध नहीं है।"
            document.risk_score = min(100, risk_score)
            document.status = "completed"
            document.processed_at = datetime.utcnow()
            document.updated_at = datetime.utcnow()
            self.db.add(document)
            self.db.commit()
        except Exception as exc:
            logger.exception("Document processing failed for {}", document_id)
            document.status = "failed"
            document.updated_at = datetime.utcnow()
            self.db.add(document)
            self.db.commit()
            raise exc


def process_document_background(document_id: str) -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        storage = StorageService(settings)
        embeddings = EmbeddingService(settings)
        vector_store = VectorStoreService(settings)
        DocumentProcessor(db, settings, storage, embeddings, vector_store).process(document_id)
    finally:
        db.close()
