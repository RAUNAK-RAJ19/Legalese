from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User


class AuthService:
    def __init__(self, db: Session, settings: Settings):
        self.db = db
        self.settings = settings

    def _build_user(self, *, email: str, password: str | None = None, provider: str = "email") -> User:
        return User(
            id=str(uuid4()),
            email=email.strip().lower(),
            password_hash=hash_password(password) if password else None,
            full_name=email.split("@")[0].replace(".", " ").title(),
            provider=provider,
            last_login=datetime.utcnow(),
        )

    def login(self, *, email: str, password: str) -> tuple[str, User]:
        user = self.db.query(User).filter(User.email == email.strip().lower()).one_or_none()
        if user is None:
            user = self._build_user(email=email, password=password)
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        else:
            if user.password_hash and not verify_password(password, user.password_hash):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
            if not user.password_hash and password:
                user.password_hash = hash_password(password)
            user.last_login = datetime.utcnow()
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)

        token = create_access_token({"sub": user.id, "email": user.email, "provider": user.provider})
        return token, user

    def oauth_login(self, provider: str) -> tuple[str, User]:
        email = f"{provider}.user@local"
        user = self.db.query(User).filter(User.email == email).one_or_none()
        if user is None:
            user = self._build_user(email=email, provider=provider)
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        else:
            user.last_login = datetime.utcnow()
            user.provider = provider
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        token = create_access_token({"sub": user.id, "email": user.email, "provider": provider})
        return token, user

    def forgot_password(self, email: str) -> None:
        # Replace with a real password reset mailer when email infrastructure is configured.
        return None

    def register(self, *, email: str, password: str, full_name: str | None = None) -> tuple[str, User]:
        existing = self.db.query(User).filter(User.email == email.strip().lower()).one_or_none()
        if existing is not None and existing.password_hash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account already exists for this email")

        if existing is None:
            user = User(
                id=str(uuid4()),
                email=email.strip().lower(),
                password_hash=hash_password(password),
                full_name=(full_name or email.split("@")[0]).strip(),
                provider="email",
                last_login=datetime.utcnow(),
            )
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        else:
            # If user exists but no password (e.g., created by a previous flow), set password
            existing.password_hash = hash_password(password)
            if full_name:
                existing.full_name = full_name
            existing.last_login = datetime.utcnow()
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            user = existing

        token = create_access_token({"sub": user.id, "email": user.email, "provider": user.provider})
        return token, user
