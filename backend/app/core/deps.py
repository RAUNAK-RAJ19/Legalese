from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.ai.embeddings import EmbeddingService
from app.ai.vector_store import VectorStoreService
from app.auth.service import AuthService
from app.chatbot.service import ChatbotService
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.documents.processor import DocumentProcessor
from app.models.user import User
from app.utils.storage import StorageService

bearer_scheme = HTTPBearer(auto_error=False)


def get_settings_dep() -> Settings:
    return get_settings()


def get_storage_service(settings: Settings = Depends(get_settings_dep)) -> StorageService:
    return StorageService(settings)


def get_embedding_service(settings: Settings = Depends(get_settings_dep)) -> EmbeddingService:
    return EmbeddingService(settings)


def get_vector_store(settings: Settings = Depends(get_settings_dep)) -> VectorStoreService:
    return VectorStoreService(settings)


def get_auth_service(db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)) -> AuthService:
    return AuthService(db, settings)


def get_document_processor(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    storage: StorageService = Depends(get_storage_service),
    embeddings: EmbeddingService = Depends(get_embedding_service),
    vector_store: VectorStoreService = Depends(get_vector_store),
) -> DocumentProcessor:
    return DocumentProcessor(db, settings, storage, embeddings, vector_store)


def get_chatbot_service(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    embeddings: EmbeddingService = Depends(get_embedding_service),
    vector_store: VectorStoreService = Depends(get_vector_store),
) -> ChatbotService:
    return ChatbotService(db, settings, embeddings, vector_store)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    auth_header: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    token = credentials.credentials if credentials else None
    if not token and auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.query_params.get("access_token")

    # If no token provided but demo auth is allowed and we're not in production,
    # return/create a demo user for development convenience.
    if not token and settings.allow_demo_auth and settings.app_env != "production":
        demo_email = "demo@local"
        user = db.query(User).filter(User.email == demo_email).one_or_none()
        if user is None:
            user = User(
                id=f"demo:{demo_email}",
                email=demo_email,
                full_name="Demo User",
                provider="demo",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authentication token")

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication token")

    user_id = str(payload.get("sub") or "")
    email = (payload.get("email") or "").lower()

    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None and email:
        user = db.query(User).filter(User.email == email).one_or_none()

    if user is None:
        user = User(
            id=user_id or f"demo:{email}",
            email=email or "user@local",
            full_name=(email.split("@")[0] if email else "User").replace(".", " ").title(),
            provider=str(payload.get("provider") or "email"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user
