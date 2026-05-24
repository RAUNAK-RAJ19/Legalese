from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str | None = None
    avatar_url: str | None = None
    provider: str = "email"
    created_at: datetime
    last_login: datetime | None = None
