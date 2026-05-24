from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from app.ai.chatbot_answer import answer_question
from app.ai.embeddings import EmbeddingService
from app.ai.vector_store import VectorStoreService
from app.core.config import Settings
from app.models.chat import ChatMessage
from app.models.document import Document


class ChatbotService:
    def __init__(self, db: Session, settings: Settings, embeddings: EmbeddingService, vector_store: VectorStoreService):
        self.db = db
        self.settings = settings
        self.embeddings = embeddings
        self.vector_store = vector_store

    def ask(self, *, user_id: str, document_id: str, question: str, language: str) -> tuple[str, list[str], list[str]]:
        document = self.db.query(Document).filter(Document.id == document_id, Document.user_id == user_id).one_or_none()
        if document is None:
            raise ValueError("Document not found")

        query_embedding = self.embeddings.embed_text(question)
        matches = self.vector_store.query(
            user_id=user_id,
            document_id=document_id,
            query_text=question,
            query_embedding=query_embedding,
            top_k=5,
        )
        source_ids: list[str] = []
        context_parts: list[str] = []
        for match in matches:
            source_ids.append(str(match.get("id", "")))
            text = str(match.get("text", ""))
            context_parts.append(text)

        context = "\n\n".join(context_parts) or document.text
        answer = answer_question(self.settings, question, context, language)

        chat = ChatMessage(
            id=str(uuid4()),
            document_id=document_id,
            user_id=user_id,
            role="assistant",
            question=question,
            answer=answer,
            sources_json=json.dumps(source_ids),
            created_at=datetime.utcnow(),
        )
        self.db.add(chat)
        self.db.commit()

        return answer, source_ids, [question]

    def history(self, *, user_id: str, document_id: str) -> list[ChatMessage]:
        return (
            self.db.query(ChatMessage)
            .filter(ChatMessage.user_id == user_id, ChatMessage.document_id == document_id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )
