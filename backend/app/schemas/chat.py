from datetime import datetime

from pydantic import BaseModel


class ChatHistoryItem(BaseModel):
    id: str
    role: str
    question: str
    answer: str
    sources: list[str] = []
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    document_id: str
    items: list[ChatHistoryItem]
