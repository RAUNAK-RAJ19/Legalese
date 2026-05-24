from functools import lru_cache

from pydantic import Field
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Legalese API"
    app_env: str = "development"
    app_cors_origins: str = "http://localhost:5173,http://localhost:3000"

    database_url: str | None = None

    supabase_url: str | None = None
    supabase_key: str | None = None
    supabase_storage_bucket: str = "legalese-pdfs"

    chroma_persist_directory: str = "./chroma_data"
    chroma_collection_name: str = "legalese_chunks"

    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"

    embedding_model_name: str = "bge-large-en-v1.5"
    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120

    max_upload_mb: int = 10
    allow_demo_auth: bool = True

    frontend_url: str = "http://localhost:3000"

    rate_limit_default: str = Field(default="60/minute")

    @field_validator("database_url", mode="before")
    @classmethod
    def _clean_database_url(cls, value):
        if isinstance(value, str) and value.startswith("DATABASE_URL="):
            return value.split("=", 1)[1]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.app_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
