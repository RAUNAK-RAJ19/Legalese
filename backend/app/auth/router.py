from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.service import AuthService
from app.core.deps import get_auth_service, get_current_user
from app.models.user import User
from app.schemas.auth import AuthResponse, ForgotPasswordRequest, LoginRequest, RegisterRequest
from app.schemas.users import UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, auth: AuthService = Depends(get_auth_service)) -> AuthResponse:
    token, user = auth.login(email=payload.email, password=payload.password)
    return AuthResponse(message="Signed in successfully.", access_token=token)


@router.post("/forgot-password", response_model=AuthResponse)
def forgot_password(payload: ForgotPasswordRequest, auth: AuthService = Depends(get_auth_service)) -> AuthResponse:
    auth.forgot_password(payload.email)
    return AuthResponse(message="Password reset instructions requested.", access_token="")


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, auth: AuthService = Depends(get_auth_service)) -> AuthResponse:
    token, user = auth.register(email=payload.email, password=payload.password, full_name=payload.full_name)
    return AuthResponse(message="Account created.", access_token=token)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return current_user
