# Legalese Backend

Development notes and required environment variables.

Required environment variables (copy `./.env` or use `docker-compose` env):

- `APP_ENV` - set to `production` in production. Defaults to `development`.
- `APP_CORS_ORIGINS` - comma-separated list of frontend origins (e.g. `http://localhost:3000`).
- `DATABASE_URL` - SQLAlchemy DB URL (optional for quick dev; uses local sqlite if unset).
- `SUPABASE_URL` - (optional) Supabase project URL for object storage.
- `SUPABASE_KEY` - (optional) Supabase service key for object storage.
- `SUPABASE_STORAGE_BUCKET` - bucket name used for PDF storage (default: `legalese-pdfs`).
- `JWT_SECRET_KEY` - secret for signing access tokens.
-- `FRONTEND_URL` - frontend app URL (used for redirects).

Notes
- For local development the app supports a local filesystem fallback for PDF storage under `./storage/` when Supabase is not configured. This fallback is disabled when `APP_ENV=production`.
- Demo authentication is enabled by `ALLOW_DEMO_AUTH=true` but is limited to non-production environments. In production, requests must include a valid JWT.

Running with Docker

1. Build and run the stack:

```bash
docker-compose up --build -d
```

2. View backend logs:

```bash
docker-compose logs -f backend
```

3. Test health:

```bash
curl http://127.0.0.1:8000/
```

Security
- Set `JWT_SECRET_KEY` to a strong secret in production, and configure Supabase or another object storage provider to avoid local filesystem use.
