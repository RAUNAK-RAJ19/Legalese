from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class TokenData(BaseModel):
    sub: str
    email: str | None = None
    provider: str | None = None


class AuthResponse(BaseModel):
    message: str
    access_token: str
    token_type: str = "bearer"


class OAuthResponse(BaseModel):
    message: str
    access_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
