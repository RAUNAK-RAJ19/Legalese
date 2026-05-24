Docs — Legalese

Overview
- Short: Documentation hub for the Legalese app (frontend + backend + docs).
- Purpose: centralize run instructions, architecture notes, and operational credentials guidance.

Quick links
- Product Requirements: [prd.me](prd.me)
- Repo root README: ../README.md

Getting started
- Frontend (dev):
  ```bash
  cd frontend
  npm install
  npm run dev
  ```
- Backend (Windows/Powershell):
  ```powershell
  cd backend
  python -m venv .venv
  .venv\Scripts\activate
  pip install -r requirements.txt
  uvicorn app.main:app --reload --port 8000
  ```
- Docker (full stack):
  ```bash
  docker compose up --build
  ```

Credentials & secrets (do NOT commit)
- Create `backend/.env` with the runtime secrets. Example keys to set (placeholders):
  - SUPABASE_URL=
  - SUPABASE_KEY=
  - GROQ_API_KEY=
  - PINECONE_API_KEY=
  - PINECONE_INDEX=legalese-documents
  - PINECONE_NAMESPACE=default
  - VITE_API_BASE_URL=http://localhost:8000/api
- Recommendation: use a secrets manager or CI secret variables for production. Add `.env` to `.gitignore`.

Docs structure
- `docs/prd.me` — Product Requirements Document
- `docs/README.md` — This file (docs index)

Contributing docs
- Edit files under `docs/` and open a PR. Keep docs concise; link to code locations when possible.

Contact
- Open an issue or contact the maintainer for credential access and environment setup questions.
