import io
import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from loguru import logger

from app.ai.vector_store import VectorStoreService
from app.core.deps import get_chatbot_service, get_current_user, get_document_processor, get_storage_service, get_vector_store
from app.core.rate_limit import limiter
from app.documents.processor import DocumentProcessor, process_document_background
from app.models.chat import ChatMessage
from app.models.document import Document, DocumentChunk
from app.models.user import User
from app.schemas.documents import (
    ChatRequest,
    ChatResponse,
    ChunkOut,
    DocumentOut,
    QAResponse,
    RiskItem,
    SimplifyRequest,
    SummaryResponse,
    UploadResponse,
)
from app.utils.pdf import extract_text_and_pages
from app.utils.storage import StorageService

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _serialize_chunk(chunk: DocumentChunk) -> ChunkOut:
    risks = []
    if chunk.risk_payload:
        try:
            risks = [json.loads(chunk.risk_payload)] if isinstance(json.loads(chunk.risk_payload), dict) else json.loads(chunk.risk_payload)
        except Exception:
            risks = []
    return ChunkOut(
        id=chunk.id,
        title=chunk.title,
        original=chunk.original,
        english=chunk.english,
        hindi=chunk.hindi,
        risk=chunk.risk,
        category=chunk.category,
        mitigation=chunk.mitigation,
        detected_risks=risks if isinstance(risks, list) else [],
    )


@router.get("/")
def list_documents(current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor)) -> dict[str, object]:
    docs = processor.db.query(Document).filter(Document.user_id == current_user.id).order_by(Document.created_at.desc()).all()
    return {"documents": [_document_to_dict(doc) for doc in docs]}


def _document_to_dict(document: Document) -> dict[str, object]:
    return {
        "id": document.id,
        "name": document.name,
        "pages": document.pages,
        "risk_score": document.risk_score,
        "status": document.status,
        "chunks": [_serialize_chunk(chunk).model_dump() for chunk in document.chunks],
    }


@router.post("/upload", response_model=UploadResponse)
@limiter.limit("5/minute")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    processor: DocumentProcessor = Depends(get_document_processor),
    storage: StorageService = Depends(get_storage_service),
) -> UploadResponse:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB.")

    document_id = str(uuid4())
    storage_path = storage.upload_pdf(user_id=current_user.id, document_id=document_id, pdf_bytes=content)
    text, pages = extract_text_and_pages(content)

    document = Document(
        id=document_id,
        user_id=current_user.id,
        name=file.filename or "uploaded.pdf",
        original_filename=file.filename or "uploaded.pdf",
        mime_type=file.content_type,
        pages=pages,
        text=text,
        pdf_storage_path=storage_path,
        status="processing",
        risk_score=0,
    )
    processor.db.add(document)
    processor.db.commit()
    processor.db.refresh(document)

    background_tasks.add_task(process_document_background, document_id)

    return UploadResponse(
        document=DocumentOut(
            id=document.id,
            name=document.name,
            pages=document.pages,
            risk_score=document.risk_score,
            status=document.status,
            chunks=[],
        )
    )


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor)) -> DocumentOut:
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentOut(
        id=document.id,
        name=document.name,
        pages=document.pages,
        risk_score=document.risk_score,
        status=document.status,
        chunks=[_serialize_chunk(chunk) for chunk in document.chunks],
    )


@router.get("/{document_id}/pdf")
def get_document_pdf(document_id: str, current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor), storage: StorageService = Depends(get_storage_service)):
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None or not document.pdf_storage_path:
        raise HTTPException(status_code=404, detail="PDF not found")
    payload = storage.download_pdf(document.pdf_storage_path)
    return StreamingResponse(io.BytesIO(payload), media_type="application/pdf")


@router.get("/{document_id}/summary", response_model=SummaryResponse)
def summary(document_id: str, current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor)) -> SummaryResponse:
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return SummaryResponse(
        document_id=document_id,
        english=document.summary_english or "Summary not ready.",
        hindi=document.summary_hindi or "सारांश तैयार नहीं है।",
    )


@router.post("/{document_id}/simplify")
def simplify_document(document_id: str, payload: SimplifyRequest = Body(...), current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor)) -> dict[str, object]:
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    simplified = [
        {
            "id": chunk.id,
            "title": chunk.title,
            "text": chunk.english if payload.language.lower() == "english" else chunk.hindi,
        }
        for chunk in document.chunks
    ]
    return {"document_id": document_id, "language": payload.language, "chunks": simplified}


@router.get("/{document_id}/risks")
def risks(document_id: str, current_user: User = Depends(get_current_user), processor: DocumentProcessor = Depends(get_document_processor)) -> dict[str, object]:
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    items: list[dict[str, str]] = []
    for chunk in document.chunks:
        payload = {}
        if chunk.risk_payload:
            try:
                payload = json.loads(chunk.risk_payload)
            except Exception:
                payload = {}
        if chunk.risk != "Low":
            items.append(
                {
                    "id": f"{chunk.id}-{chunk.risk.lower()}",
                    "clause_text": chunk.original,
                    "title": chunk.title,
                    "severity": chunk.risk,
                    "summary": payload.get("summary", chunk.english),
                    "category": payload.get("category", chunk.category or "Legal"),
                    "mitigation": payload.get("mitigation", chunk.mitigation or "Review with legal counsel."),
                }
            )
    return {"document_id": document_id, "items": items}


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    processor: DocumentProcessor = Depends(get_document_processor),
    storage: StorageService = Depends(get_storage_service),
    vector_store: VectorStoreService = Depends(get_vector_store),
) -> dict[str, str]:
    document = processor.db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.pdf_storage_path:
        try:
            storage.delete_pdf(document.pdf_storage_path)
        except Exception:
            logger.warning("PDF delete failed for {}", document_id)
    processor.db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
    processor.db.query(ChatMessage).filter(ChatMessage.document_id == document_id).delete()
    processor.db.delete(document)
    processor.db.commit()
    vector_store.delete_document(user_id=current_user.id, document_id=document_id)
    return {"detail": "Document deleted"}


@router.post("/qa")
def qa(payload: ChatRequest, current_user: User = Depends(get_current_user), chatbot = Depends(get_chatbot_service)) -> QAResponse:
    try:
        answer, sources, queries = chatbot.ask(user_id=current_user.id, document_id=payload.document_id, question=payload.question, language=payload.language)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return QAResponse(answer=answer, sources=sources, retrieval_queries=queries)


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, current_user: User = Depends(get_current_user), chatbot = Depends(get_chatbot_service)) -> ChatResponse:
    try:
        answer, sources, _ = chatbot.ask(user_id=current_user.id, document_id=payload.document_id, question=payload.question, language=payload.language)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ChatResponse(answer=answer, sources=sources)
