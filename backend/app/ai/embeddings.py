from __future__ import annotations

import hashlib
import math
import re

from loguru import logger
from sentence_transformers import SentenceTransformer

from app.core.config import Settings


class EmbeddingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._model: SentenceTransformer | None = None

    def _load_model(self) -> SentenceTransformer | None:
        if self._model is not None:
            return self._model
        for model_name in (self.settings.embedding_model_name, "BAAI/bge-large-en-v1.5", "all-MiniLM-L6-v2"):
            try:
                self._model = SentenceTransformer(model_name)
                return self._model
            except Exception as exc:
                logger.warning("Failed to load embedding model {}: {}", model_name, exc)
        self._model = None
        return None

    def embed_text(self, text: str) -> list[float]:
        model = self._load_model()
        if model is not None:
            vector = model.encode([text], normalize_embeddings=True)[0]
            return [float(value) for value in vector]
        return self._fallback_embedding(text)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        model = self._load_model()
        if model is not None:
            vectors = model.encode(texts, normalize_embeddings=True)
            return [[float(value) for value in row] for row in vectors]
        return [self._fallback_embedding(text) for text in texts]

    def _fallback_embedding(self, text: str, dimensions: int = 384) -> list[float]:
        tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
        vector = [0.0] * dimensions
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % dimensions
            vector[index] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]
