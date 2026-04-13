# Team Setup

This guide is for collaborators working on a public repo while the demo is live.

## Public vs Private

Safe to document publicly:

- the four judge student accounts shown on `/login`
- the shared student password `Qwerty@123`
- the fact that each public student account has `10` live sessions
- the current `2-minute` live camera window for the hackathon demo
- the public routes and demo flow

Keep private:

- seeded internal admin accounts
- the seeded developer account
- real Anthropic and OpenAI keys
- any backend database copied from a live environment
- any private `PRIVATE_SEED_ACCOUNTS_JSON` payload
- local-only notes such as `docs/static-accounts-local.md` and `docs/demo-speaker-notes.md`

Do not publish private account credentials in docs, screenshots, issue
comments, or commits.

## Secret Handling

Never commit real keys into tracked files.

When a new teammate needs cloud access, send them
[cloud-keys.md](cloud-keys.md). Do not send them your personal Anthropic or
OpenAI key.

Tracked config should keep placeholders such as:

```env
AI_API_KEY=SET_IN_ENV_MANAGER
TRANSCRIPTION_API_KEY=SET_IN_ENV_MANAGER
```

Use your own local `backend/.env`, your shell, or the backend host secret
manager for real values:

```bash
export AI_API_KEY='your_own_main_provider_key_here'
export TRANSCRIPTION_API_KEY='your_openai_key_here'
```

Restart the backend after changing them.

Key ownership rules:

- each developer keeps their own local keys private
- shared deployment keys live in the backend host secret manager
- no Anthropic or OpenAI keys should ever be added to frontend Vercel settings
- if a secret is exposed, rotate it before continuing

If you need private internal admin or developer accounts in a live environment,
set them through:

```env
PRIVATE_SEED_ACCOUNTS_JSON=[{"id":"account-developer-team","name":"Developer Team","username":"developer@example.com","password":"SET_IN_ENV_MANAGER","role":"admin","is_developer":true,"live_session_limit":null}]
```

## Repo Hygiene

Before pushing:

- keep `backend/.env` and `frontend/.env.local` out of Git
- keep `backend/app/data/auth.db` and `backend/app/data/review_cases.json` out of Git
- keep local-only notes ignored and uncommitted unless you intentionally want to share them
- do not paste private credentials into docs or source files
- review `git status --short` before committing

Useful checks:

```bash
git check-ignore -v backend/.env frontend/.env.local backend/app/data/auth.db backend/app/data/review_cases.json
rg -uuu -n "sk-|api_key|AI_API_KEY|TRANSCRIPTION_API_KEY|PRIVATE_SEED_ACCOUNTS_JSON" .
git status --short
```

## Team Workflow

- do not push directly to `main`; use `development` or a feature branch and merge intentionally
- pull and sync before large edits on the shared branch you are using
- treat `docs/local-setup.md` as the canonical local-development guide
- treat `docs/how-to-run.md` as the canonical demo smoke-flow guide
- treat `docs/vercel-deployment.md` and `docs/backend-deployment.md` as deployment ownership docs
- prefer updating one canonical doc and linking to it, rather than duplicating the same instructions across several files

## Release Smoke Checklist

1. Open `/login`.
2. Sign in with one judge account.
3. Confirm `/dashboard`, `/knowledge`, and `/library` load.
4. Open `/train/simple-interrupted-suture`.
5. In `Setup`, confirm the preflight checks load and `Check Audio` can report Browser STT and backend transcription results.
6. Run `Check My Step` once on `Setup` and confirm the local preflight finishes without starting a counted live session.
7. Start preview and then run `Check My Step` on the first real non-setup stage.
8. Confirm the backend receives analysis calls and live-session quota updates at that point, not when preview starts.
9. Open the generated review.
10. If using admin or developer accounts, confirm review queue and approval pages still load.

## Deployment Pointers

- Frontend on Vercel: [vercel-deployment.md](vercel-deployment.md)
- Backend on a persistent host: [backend-deployment.md](backend-deployment.md)
- Cloud key setup: [cloud-keys.md](cloud-keys.md)
- Full local development guide: [local-setup.md](local-setup.md)
