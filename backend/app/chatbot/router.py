from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from app.chatbot.service import ChatbotService
from app.core.deps import get_chatbot_service, get_current_user
from app.models.user import User
from app.schemas.chat import ChatHistoryItem, ChatHistoryResponse
from app.schemas.documents import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/chat", tags=["chatbot"])


@router.get("/history/{document_id}", response_model=ChatHistoryResponse)
def history(document_id: str, current_user: User = Depends(get_current_user), chatbot: ChatbotService = Depends(get_chatbot_service)) -> ChatHistoryResponse:
    items = []
    for message in chatbot.history(user_id=current_user.id, document_id=document_id):
        items.append(
            ChatHistoryItem(
                id=message.id,
                role=message.role,
                question=message.question,
                answer=message.answer,
                sources=json.loads(message.sources_json or "[]"),
                created_at=message.created_at,
            )
        )
    return ChatHistoryResponse(document_id=document_id, items=items)


@router.post("/ask", response_model=ChatResponse)
def ask(payload: ChatRequest, current_user: User = Depends(get_current_user), chatbot: ChatbotService = Depends(get_chatbot_service)) -> ChatResponse:
    try:
        answer, sources, _ = chatbot.ask(user_id=current_user.id, document_id=payload.document_id, question=payload.question, language=payload.language)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ChatResponse(answer=answer, sources=sources)
