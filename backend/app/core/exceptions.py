from fastapi import Request
from fastapi.responses import JSONResponse
from loguru import logger


async def http_exception_handler(request: Request, exc: Exception):
    status_code = getattr(exc, "status_code", 500)
    detail = getattr(exc, "detail", "An unexpected error occurred")
    return JSONResponse(status_code=status_code, content={"detail": detail})


async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error during request {}", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
