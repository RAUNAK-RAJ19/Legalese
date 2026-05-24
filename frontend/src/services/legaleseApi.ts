import { type DocumentRecord } from '../data/mock';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';
const AUTH_TOKEN_KEY = 'legalese.authToken';

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...authHeaders()
    }
  });
}

async function extractApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail || payload.message || `Request failed (${response.status})`;
  } catch {
    const text = await response.text();
    return text?.trim() || `Request failed (${response.status})`;
  }
}

type ApiChunk = {
  id: string;
  title: string;
  original: string;
  english: string;
  hindi: string;
  risk: 'Low' | 'Medium' | 'High' | 'Critical' | 'Warning';
};

type ApiDocument = {
  id: string;
  name: string;
  pages: number;
  risk_score: number;
  chunks: ApiChunk[];
  status: 'processing' | 'completed' | 'failed';
};

type RiskItem = {
  id: string;
  clause_text: string;
  title: string;
  severity: string;
  summary: string;
  category: string;
  mitigation: string;
};
type SummaryPayload = { english: string; hindi: string };
type QAResponse = { answer: string; sources: string[]; retrieval_queries?: string[] };
type AuthResponse = { message: string; access_token?: string; token_type?: string };

const mapDocument = (document: ApiDocument): DocumentRecord => ({
  id: document.id,
  name: document.name,
  pages: document.pages,
  uploadedAt: 'Just now',
  riskScore: document.risk_score,
  chunks: document.chunks || [],
  status: document.status
});

export async function listDocuments(): Promise<DocumentRecord[]> {
  const response = await authedFetch(`${API_BASE_URL}/api/documents/`);
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { documents?: ApiDocument[] };
  return (payload.documents ?? []).map(mapDocument);
}

export async function getDocument(documentId: string): Promise<DocumentRecord | null> {
  const response = await authedFetch(`${API_BASE_URL}/api/documents/${documentId}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as ApiDocument;
  return mapDocument(payload);
}

export async function uploadDocument(file: File): Promise<DocumentRecord> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await authedFetch(`${API_BASE_URL}/api/documents/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  const payload = (await response.json()) as { document: ApiDocument };
  return mapDocument(payload.document);
}

export async function getDocumentRisks(documentId: string): Promise<RiskItem[]> {
  const response = await authedFetch(`${API_BASE_URL}/api/documents/${documentId}/risks`);
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { items?: RiskItem[] };
  return payload.items ?? [];
}

export async function getDocumentSummary(documentId: string): Promise<SummaryPayload> {
  const response = await authedFetch(`${API_BASE_URL}/api/documents/${documentId}/summary`);
  if (!response.ok) {
    return { english: 'Summary unavailable.', hindi: 'सारांश उपलब्ध नहीं है।' };
  }

  const payload = (await response.json()) as Partial<SummaryPayload>;
  return {
    english: payload.english?.trim() || 'Summary unavailable.',
    hindi: payload.hindi?.trim() || 'सारांश उपलब्ध नहीं है।'
  };
}

export async function deleteDocument(documentId: string): Promise<void> {
  const primaryBase = API_BASE_URL.replace(/\/$/, '');
  const altHostBase = primaryBase.includes('localhost')
    ? primaryBase.replace('localhost', '127.0.0.1')
    : primaryBase.includes('127.0.0.1')
      ? primaryBase.replace('127.0.0.1', 'localhost')
      : primaryBase;
  const altPortBase = /:8000\b/.test(primaryBase) ? primaryBase.replace(':8000', ':8001') : primaryBase;
  const altHostAltPortBase = /:8000\b/.test(altHostBase) ? altHostBase.replace(':8000', ':8001') : altHostBase;

  const candidateUrls = Array.from(
    new Set([
      `${primaryBase}/api/documents/${documentId}`,
      `${altHostBase}/api/documents/${documentId}`,
      `${altPortBase}/api/documents/${documentId}`,
      `${altHostAltPortBase}/api/documents/${documentId}`
    ])
  );

  let lastHttpError: string | null = null;
  for (const url of candidateUrls) {
    try {
      const response = await authedFetch(url, { method: 'DELETE' });
      if (response.ok) {
        return;
      }
      const errorMessage = await extractApiError(response);
      lastHttpError = `Delete failed (${response.status}): ${errorMessage}`;
    } catch {
      // Continue trying other local candidates.
    }
  }

  throw new Error(lastHttpError || 'Backend is unreachable. Start API server on port 8000 or 8001.');
}

export function getDocumentPdfUrl(documentId: string): string {
  const token = getAuthToken();
  return token
    ? `${API_BASE_URL}/api/documents/${documentId}/pdf?access_token=${encodeURIComponent(token)}`
    : `${API_BASE_URL}/api/documents/${documentId}/pdf`;
}

export async function askQuestion(documentId: string, question: string, language: 'English' | 'Hindi'): Promise<QAResponse> {
  const response = await authedFetch(`${API_BASE_URL}/api/documents/qa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      document_id: documentId,
      question,
      language
    })
  });

  if (!response.ok) {
    throw new Error('QA request failed');
  }

  return (await response.json()) as QAResponse;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
  } catch (err: any) {
    throw new Error(`Network error: ${err?.message || 'Failed to reach backend'}`);
  }

  let payload = {} as Partial<AuthResponse>;
  try {
    payload = (await response.json()) as Partial<AuthResponse>;
  } catch {
    // Ignore JSON parse errors; we'll fall back to status-based message
  }

  if (!response.ok) {
    throw new Error(payload.message || `Sign in failed (${response.status})`);
  }

  if (payload.access_token) {
    setAuthToken(payload.access_token);
  }

  return { message: payload.message || 'Signed in successfully.' };
}

export async function registerWithEmail(email: string, password: string, full_name?: string): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, full_name })
    });
  } catch (err: any) {
    throw new Error(`Network error: ${err?.message || 'Failed to reach backend'}`);
  }

  let payload = {} as Partial<AuthResponse>;
  try {
    payload = (await response.json()) as Partial<AuthResponse>;
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(payload.message || `Registration failed (${response.status})`);
  }

  if (payload.access_token) {
    setAuthToken(payload.access_token);
  }

  return { message: payload.message || 'Account created.' };
}

export async function forgotPassword(email: string): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
  } catch (err: any) {
    throw new Error(`Network error: ${err?.message || 'Failed to reach backend'}`);
  }

  let payload = {} as Partial<AuthResponse>;
  try {
    payload = (await response.json()) as Partial<AuthResponse>;
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(payload.message || `Password reset failed (${response.status})`);
  }

  return { message: payload.message || 'Password reset link sent.' };
}
