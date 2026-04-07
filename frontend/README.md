# Frontend

This package contains the Next.js frontend for Clinical Curator AI.

## Responsibilities

- shared app shell and navigation
- login and legacy access-required flows
- dashboard and profile surfaces
- live trainer UI
- review page and debrief rendering
- Knowledge Lab
- library guide
- admin review queue
- developer approval queue
- browser cache and sync layer for backend learning state

## Local Commands

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Frontend Environment

Local development:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

Hosted frontend on Vercel:

```env
API_BASE_URL=https://your-backend.example.com/api/v1
```

The frontend should only talk to the FastAPI backend, not directly to Anthropic
or OpenAI.

## Route Surface

- `/login`
- `/access-required` legacy fallback route
- `/dashboard`
- `/train/[procedure]`
- `/review/[sessionId]`
- `/knowledge`
- `/library`
- `/profile`
- `/admin/reviews`
- `/developer/approvals`

## Storage Notes

- the backend owns the auth account record, session token, live-session quota, synced session history, and Knowledge Lab progress
- the browser keeps a local cache for fast hydration plus cached debriefs and offline-friendly logs
- the production app proxies backend calls through `/api/proxy/*`

## Read Next

- [../docs/how-to-run.md](../docs/how-to-run.md)
- [../docs/local-setup.md](../docs/local-setup.md)
- [../docs/vercel-deployment.md](../docs/vercel-deployment.md)
