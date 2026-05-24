from __future__ import annotations

from contextlib import contextmanager
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models.base import Base

settings = get_settings()

def _sanitize_database_url(raw_url: str) -> str:
    """Remove DSN options that psycopg2 does not recognize."""
    if not raw_url.startswith(("postgresql://", "postgres://")):
        return raw_url

    split = urlsplit(raw_url)
    if not split.query:
        return raw_url

    blocked = {"pgbouncer"}
    filtered_pairs = [(key, value) for key, value in parse_qsl(split.query, keep_blank_values=True) if key.lower() not in blocked]
    rebuilt_query = urlencode(filtered_pairs, doseq=True)
    return urlunsplit((split.scheme, split.netloc, split.path, rebuilt_query, split.fragment))


database_url = _sanitize_database_url(settings.database_url or "sqlite:///./legalese.db")
engine_kwargs = {"future": True}
if database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
