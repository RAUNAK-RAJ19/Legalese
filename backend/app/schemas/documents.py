from pydantic import BaseModel, ConfigDict, Field


class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    original: str
    english: str
    hindi: str
    risk: str
    category: str | None = None
    mitigation: str | None = None
    detected_risks: list[dict[str, str]] = []


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    pages: int
    risk_score: int = Field(ge=0, le=100)
    status: str = "processing"
    chunks: list[ChunkOut]


class UploadResponse(BaseModel):
    document: DocumentOut


class SimplifyRequest(BaseModel):
    language: str = Field(default="English", max_length=50)


class ChatRequest(BaseModel):
    document_id: str
    question: str = Field(..., max_length=1000)
    language: str = Field(default="English", max_length=50)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = []


class QAResponse(BaseModel):
    answer: str
    sources: list[str] = []
    retrieval_queries: list[str] = []


class RiskItem(BaseModel):
    id: str
    clause_text: str
    title: str
    severity: str
    summary: str
    category: str
    mitigation: str


class SummaryResponse(BaseModel):
    document_id: str
    english: str
    hindi: str
