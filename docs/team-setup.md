# Team Setup

This guide is for collaborators working on a public repo while the demo is live.

## What Is Public vs Private

Publicly documented:

- the four judge student accounts shown on `/login`
- the shared student password `CODESTORMERS`
- the fact that each student account has `10` live sessions

Private team-only items:

- seeded internal admin accounts
- the seeded developer account
- real Anthropic and OpenAI keys
- any backend database copied from a live environment

Do not publish private account credentials in docs, screenshots, or issue
comments.

## Open Repo Secret Handling

Never commit real keys into tracked files.

Keep placeholders in `backend/.env`:

```env
AI_API_KEY=SET_IN_ENV_MANAGER
TRANSCRIPTION_API_KEY=SET_IN_ENV_MANAGER
```

Use your shell or environment manager for the real values:

```bash
export AI_API_KEY='your_claude_key_here'
export TRANSCRIPTION_API_KEY='your_openai_key_here'
```

Restart the backend after changing them.

## Recommended Deployment Shape

Use:

- `Vercel` for the `frontend`
- one separate persistent Python host for the `backend`

Reasons:

- the frontend is a normal Next.js project
- the backend needs persistent SQLite storage for auth quotas and review state
- the backend currently accepts one `FRONTEND_ORIGIN` value for CORS

## Frontend On Vercel

In Vercel:

1. Import the GitHub repo.
2. Set the project root directory to `frontend`.
3. Add `NEXT_PUBLIC_API_BASE_URL` pointing to the deployed backend API.
4. Deploy.

Example:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.example.com/api/v1
```

## Backend Deployment Checklist

The backend host needs:

- Python 3.10+
- persistent filesystem or volume for `backend/app/data/auth.db`
- real `AI_API_KEY`
- real `TRANSCRIPTION_API_KEY`
- `FRONTEND_ORIGIN` set to the exact deployed frontend origin

Example:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
```

## Preview Deployment Caveat

The backend CORS configuration currently allows one exact frontend origin.

That means:

- a single stable Vercel production URL is the safest demo setup
- Vercel preview URLs will not work automatically unless you widen backend CORS behavior in code

## Git Push Checklist

Before pushing:

- `backend/.env` has placeholders only
- `backend/app/data/auth.db` is not tracked
- no private account credential is added to docs
- `git status --short` is clean or intentionally staged

Useful checks:

```bash
git check-ignore -v backend/.env backend/app/data/auth.db
rg -uuu -n "sk-|api_key|AI_API_KEY|TRANSCRIPTION_API_KEY" .
git status --short
```
