from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from loguru import logger
from supabase import Client, create_client

from app.core.config import Settings


@dataclass
class StorageObject:
    bucket: str
    path: str


class StorageService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client: Client | None = None
        # Local storage root (for development fallback)
        self.local_storage_root = Path("./storage")
        try:
            self.local_storage_root.mkdir(parents=True, exist_ok=True)
        except Exception:
            logger.warning("Could not create local storage directory {}", self.local_storage_root)
        if settings.supabase_url and settings.supabase_key:
            try:
                self.client = create_client(settings.supabase_url, settings.supabase_key)
            except Exception as exc:
                logger.warning("Supabase storage client initialization failed: {}", exc)

    def ensure_ready(self) -> None:
        # In production require Supabase client; allow local filesystem fallback only in non-production.
        env = getattr(self.settings, "app_env", "development")
        if not self.client and env == "production":
            raise RuntimeError("Supabase storage is not configured")

        # If client not present, ensure local storage directory exists and is writable
        if not self.client:
            if not self.local_storage_root or not self.local_storage_root.exists():
                raise RuntimeError("Local storage is not available")

    def upload_pdf(self, *, user_id: str, document_id: str, pdf_bytes: bytes) -> str:
        self.ensure_ready()
        storage_path = f"users/{user_id}/documents/{document_id}.pdf"
        # Prefer Supabase when configured
        if self.client:
            self.client.storage.from_(self.settings.supabase_storage_bucket).upload(
                path=storage_path,
                file=pdf_bytes,
                file_options={"content-type": "application/pdf"},
            )
            return storage_path

        # Fallback to local filesystem
        local_bucket_dir = self.local_storage_root / self.settings.supabase_storage_bucket
        local_file_path = local_bucket_dir / storage_path
        local_file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_file_path, "wb") as f:
            f.write(pdf_bytes)
        return str(local_file_path)

    def download_pdf(self, storage_path: str) -> bytes:
        self.ensure_ready()
        if self.client:
            payload = self.client.storage.from_(self.settings.supabase_storage_bucket).download(storage_path)
            return payload

        # Local filesystem fallback
        local_path = Path(storage_path)
        if not local_path.exists():
            # If storage_path was returned as a str path from upload, try resolving under local storage root
            local_path = self.local_storage_root / storage_path
        with open(local_path, "rb") as f:
            return f.read()

    def delete_pdf(self, storage_path: str) -> None:
        self.ensure_ready()
        if self.client:
            self.client.storage.from_(self.settings.supabase_storage_bucket).remove([storage_path])
            return

        # Local filesystem fallback
        local_path = Path(storage_path)
        if not local_path.exists():
            local_path = self.local_storage_root / storage_path
        try:
            if local_path.exists():
                local_path.unlink()
        except Exception:
            logger.warning("Failed to delete local file {}", local_path)
