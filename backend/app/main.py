from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from app.auth.router import router as auth_router
from app.chatbot.router import router as chatbot_router
from app.core.config import get_settings
from app.core.database import init_db
from app.core.exceptions import generic_exception_handler, http_exception_handler
from app.core.logging import configure_logging
from app.core.rate_limit import limiter
from app.documents.router import router as documents_router
from app.health.router import router as health_router
from app.users.router import router as users_router

configure_logging()
settings = get_settings()

app = FastAPI(title=settings.app_name, version="2.0.0")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(documents_router)
app.include_router(chatbot_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Legalese API is running"}
