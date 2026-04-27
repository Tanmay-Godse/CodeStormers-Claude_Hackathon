# Backend Deployment

This backend is intended for a persistent Python host, not Vercel serverless.

## Recommended Host Shape

- build from `backend/Dockerfile` or run the app directly with Uvicorn
- mount persistent storage at `/app/app/data`
- inject secrets through the host environment manager
- point the Vercel frontend at the backend through `API_BASE_URL`

Why persistence matters:

- auth accounts and live-session quotas are stored in SQLite
- synced session history, active-session state, and Knowledge Lab progress are stored in SQLite
- review queue state is stored on disk
- ephemeral storage can reset demo quota, learning history, and review state

## Required Runtime Configuration

For the exact local and hosted key flow, use [cloud-keys.md](cloud-keys.md).
This section shows the recommended Anthropic-main deployment shape for the
current demo.

Minimum backend environment:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
SIMULATION_ONLY=true

AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=SET_IN_HOST_SECRET_MANAGER
AI_ANALYSIS_MODEL=claude-sonnet-4-6
AI_DEBRIEF_MODEL=claude-sonnet-4-6
AI_COACH_MODEL=claude-sonnet-4-6
AI_LEARNING_MODEL=claude-haiku-4-5

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=SET_IN_HOST_SECRET_MANAGER
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

Optional private team-only seeded accounts:

```env
PRIVATE_SEED_ACCOUNTS_JSON=[{"id":"account-developer-team","name":"Developer Team","username":"developer@example.com","password":"SET_IN_HOST_SECRET_MANAGER","role":"admin","is_developer":true,"live_session_limit":null}]
```

Keep placeholder values in tracked files and inject real values through the host
dashboard or shell at runtime.

Deployment steps for other teammates:

1. Open the backend host's environment-variable or secrets page.
2. Add the backend variables shown above there.
3. Keep Anthropic and OpenAI secrets off the frontend deployment.
4. Redeploy or restart the backend.
5. Confirm the frontend only has `API_BASE_URL`, not provider keys.

## Docker Commands

Build:

```bash
docker build -t clinical-curator-backend ./backend
```

Run locally with a persistent volume:

```bash
docker run \
  --rm \
  -p 8001:8001 \
  -v clinical-curator-data:/app/app/data \
  --env-file backend/.env \
  clinical-curator-backend
```

## Frontend Wiring

In the Vercel project for `frontend`, set:

```env
API_BASE_URL=https://your-backend.example.com/api/v1
```

The production frontend proxies browser requests through `/api/proxy/*`, so the
backend URL stays server-side.

## Smoke Checks

After deployment:

```bash
curl https://your-backend.example.com/api/v1/health
curl https://your-backend.example.com/api/v1/procedures/simple-interrupted-suture
```

The `/health` response should show `ai_ready=true` and, if backend speech
fallback is configured, `transcription_ready=true`.

Manual checks:

1. Sign in from the deployed frontend.
2. Open the trainer `Setup` tab and confirm the preflight checks load.
3. Click `Run Preflight` and confirm backend transcription can be measured when configured.
4. Start a live session.
5. Confirm the backend writes quota and learning-state files under the persistent data mount.
6. Refresh the browser and confirm the session history rehydrates.
7. Confirm review cases still exist after a backend restart.

## Common Failure Modes

- `invalid x-api-key` or another Anthropic credential error:
  `AI_API_KEY` is missing, placeholder-only, revoked, or wrong.
- Quota appears to reset after restart:
  the backend data directory is not on persistent storage.
- Session history or Knowledge Lab progress disappears after restart:
  the backend data directory is not on persistent storage.
- Frontend loads but API calls fail:
  `FRONTEND_ORIGIN` does not match the exact deployed frontend origin.

## Related Docs

- [cloud-keys.md](cloud-keys.md)
- [vercel-deployment.md](vercel-deployment.md)
- [team-setup.md](team-setup.md)
- [local-setup.md](local-setup.md)
