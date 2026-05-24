from __future__ import annotations

import math
from collections import defaultdict

from loguru import logger

from app.core.config import Settings


class VectorStoreService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = None
        self.collection = None
        self._memory_index: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)

        try:
            import chromadb  # type: ignore

            self.client = chromadb.PersistentClient(path=settings.chroma_persist_directory)
            self.collection = self.client.get_or_create_collection(name=settings.chroma_collection_name)
        except Exception as exc:
            if getattr(self.settings, "app_env", "development") == "production":
                raise RuntimeError("ChromaDB is required in production") from exc
            logger.warning("ChromaDB unavailable, using in-memory vector store fallback: {}", exc)

    def upsert_chunks(self, chunks: list[dict[str, object]]) -> None:
        if not chunks:
            return
        if self.collection is None:
            for chunk in chunks:
                metadata = dict(chunk.get("metadata", {}))
                key = (str(metadata.get("user_id", "")), str(metadata.get("document_id", "")))
                chunk_id = str(chunk["id"])
                entries = [entry for entry in self._memory_index[key] if str(entry.get("id", "")) != chunk_id]
                entries.append(
                    {
                        "id": chunk_id,
                        "text": str(chunk.get("text", "")),
                        "embedding": list(chunk.get("embedding", [])),
                        "metadata": metadata,
                    }
                )
                self._memory_index[key] = entries
            return

        ids = [str(chunk["id"]) for chunk in chunks]
        documents = [str(chunk["text"]) for chunk in chunks]
        embeddings = [chunk["embedding"] for chunk in chunks]
        metadatas = [chunk["metadata"] for chunk in chunks]
        self.collection.upsert(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)

    def query(self, *, user_id: str, document_id: str, query_text: str, query_embedding: list[float], top_k: int = 5) -> list[dict[str, object]]:
        if self.collection is None:
            matches: list[dict[str, object]] = []
            key = (user_id, document_id)
            query_terms = {term for term in query_text.lower().split() if term}
            for entry in self._memory_index.get(key, []):
                text = str(entry.get("text", ""))
                text_terms = {term for term in text.lower().split() if term}
                lexical_score = len(query_terms.intersection(text_terms))
                embedding = entry.get("embedding", [])
                semantic_score = self._cosine_similarity(query_embedding, embedding if isinstance(embedding, list) else [])
                score = lexical_score + semantic_score
                matches.append(
                    {
                        "id": entry.get("id", ""),
                        "text": text,
                        "metadata": entry.get("metadata", {}),
                        "distance": 1.0 - semantic_score,
                        "score": score,
                    }
                )
            matches.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
            return matches[:top_k]

        result = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"$and": [{"user_id": user_id}, {"document_id": document_id}]},
            include=["documents", "metadatas", "distances"],
        )
        matches: list[dict[str, object]] = []
        ids = result.get("ids", [[]])[0]
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        for idx, chunk_id in enumerate(ids):
            matches.append(
                {
                    "id": chunk_id,
                    "text": docs[idx] if idx < len(docs) else "",
                    "metadata": metas[idx] if idx < len(metas) else {},
                    "distance": distances[idx] if idx < len(distances) else None,
                }
            )
        return matches

    def delete_document(self, *, user_id: str, document_id: str) -> None:
        if self.collection is None:
            self._memory_index.pop((user_id, document_id), None)
            return
        try:
            self.collection.delete(where={"$and": [{"user_id": user_id}, {"document_id": document_id}]})
        except Exception as exc:
            logger.warning("Vector delete failed for {}: {}", document_id, exc)

    @staticmethod
    def _cosine_similarity(lhs: list[float], rhs: list[float]) -> float:
        if not lhs or not rhs or len(lhs) != len(rhs):
            return 0.0
        numerator = sum(left * right for left, right in zip(lhs, rhs))
        lhs_norm = math.sqrt(sum(value * value for value in lhs))
        rhs_norm = math.sqrt(sum(value * value for value in rhs))
        denominator = lhs_norm * rhs_norm
        if denominator == 0:
            return 0.0
        return numerator / denominator
