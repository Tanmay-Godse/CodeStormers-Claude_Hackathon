# Team Setup

This guide is the teammate-focused version of setup for an open repository.

Use it when:

- multiple collaborators need to run the app
- the repo is public or will be pushed to a public remote
- you want a clean rule for API keys, SQLite account data, and browser-local session data

## What Is Shared vs Local

Current persistence is split across two places:

- workspace accounts are stored in backend SQLite at `backend/app/data/auth.db`
- training sessions, calibration, cached debriefs, and offline logs stay in browser `localStorage`

That means:

- if teammates share the same backend, they share the same account database
- if teammates use different browsers or machines, they do not automatically share training session history
- pushing to GitHub should never include `backend/.env` or `backend/app/data/auth.db`

## Secret Handling for an Open Repo

Do not commit real API keys to tracked files.

Recommended pattern:

1. Keep `backend/.env` in placeholder mode:

```env
AI_API_KEY=SET_IN_ENV_MANAGER
```

2. Store the real key outside the repo with your environment manager.

With micromamba:

```bash
micromamba env config vars set -n hackathon AI_API_KEY='your_real_key_here'
micromamba deactivate
micromamba activate hackathon
```

With a one-off shell export:

```bash
export AI_API_KEY='your_real_key_here'
```

If your backend is already running, restart it after changing the environment variable.

## Setup Pattern A: Each Collaborator Runs Their Own Backend

Recommended when:

- each teammate can get their own Z.AI key
- you want isolated account databases
- you do not want one shared backend machine

Each collaborator should:

1. Pull the repo.
2. Copy `backend/.env.example` to `backend/.env`.
3. Set the backend model config with placeholders only:

```env
AI_PROVIDER=auto
AI_API_BASE_URL=https://api.z.ai/api/paas/v4
AI_API_KEY=SET_IN_ENV_MANAGER
AI_ANALYSIS_MODEL=glm-4.6v-flash
AI_DEBRIEF_MODEL=glm-4.6v-flash
AI_COACH_MODEL=glm-4.6v-flash
```

4. Store the real `AI_API_KEY` in their own shell or micromamba env.
5. Run the backend locally.
6. Run the frontend locally.

Result:

- each teammate has their own accounts in their own SQLite database
- each teammate has their own browser-local training sessions

## Setup Pattern B: One Shared Backend for the Team

Recommended when:

- only one teammate has or manages the Z.AI key
- you want all account creation and sign-in to hit the same backend
- you want the team to avoid local backend setup

One teammate or a private host should run:

- the FastAPI backend
- the SQLite account database
- the Z.AI-backed model configuration

Other collaborators only need:

```env
NEXT_PUBLIC_API_BASE_URL=http://your-shared-backend:8001/api/v1
```

Result:

- all collaborators use the same account database
- each collaborator still keeps their own training sessions in browser storage

## Shared Backend Notes

If you use one shared backend:

- back up `backend/app/data/auth.db` if account continuity matters
- do not commit `auth.db`
- expect users on different browsers to have different local session histories even when they share one backend

## Push Checklist

Before pushing to GitHub, verify:

- `backend/.env` contains no real key
- `backend/app/data/auth.db` is not tracked
- no secret appears in `git diff`

Useful checks:

```bash
git check-ignore -v backend/.env backend/app/data/auth.db
rg -uuu -n "sk-|api_key|AI_API_KEY|your_real_key_here" .
git status --short
```

## Current Limits

- this is still demo-oriented auth, not production identity management
- password resets, email verification, and multi-device session sync are not implemented
- training sessions are still local to the browser profile that created them
