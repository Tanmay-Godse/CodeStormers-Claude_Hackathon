# Local Setup Guide

This guide is the fuller developer-oriented setup for the current demo build.

## Current Architecture

- `frontend`: Next.js app with dashboard, trainer, knowledge, library, profile, review, admin, and developer flows
- `backend`: FastAPI app with auth, AI routing, safety gate, review queue, and TTS
- `main AI model`: `claude-sonnet-4-6`
- `learning model`: `claude-haiku-4-5`
- `transcription`: `gpt-4o-mini-transcribe`
- `auth persistence`: SQLite at `backend/app/data/auth.db`
- `session persistence`: browser `localStorage`

## Service URLs

- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- frontend API target: `http://localhost:8001/api/v1`

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Recommended `backend/.env`:

```env
FRONTEND_ORIGIN=http://localhost:3000
SIMULATION_ONLY=true

AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=SET_IN_ENV_MANAGER
AI_ANALYSIS_MODEL=claude-sonnet-4-6
AI_DEBRIEF_MODEL=claude-sonnet-4-6
AI_COACH_MODEL=claude-sonnet-4-6
AI_LEARNING_MODEL=claude-haiku-4-5

AI_TIMEOUT_SECONDS=60
AI_ANALYSIS_MAX_TOKENS=1400
AI_DEBRIEF_MAX_TOKENS=1200
AI_COACH_MAX_TOKENS=450
AI_SAFETY_MAX_TOKENS=600
AI_LEARNING_MAX_TOKENS=1800
HUMAN_REVIEW_CONFIDENCE_THRESHOLD=0.78
GRADING_CONFIDENCE_THRESHOLD=0.80
ANTHROPIC_VERSION=2023-06-01

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=SET_IN_ENV_MANAGER
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
TRANSCRIPTION_TIMEOUT_SECONDS=60
```

Run it:

```bash
uvicorn app.main:app --reload --port 8001
```

## Frontend Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Frontend env:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

Run it:

```bash
npm run dev
```

## Account Model

The current public demo does not allow open signup.

Public seeded student accounts:

- `Student_1@gmail.com`
- `Student_2@gmail.com`
- `Student_3@gmail.com`
- `Student_4@gmail.com`
- shared password: `CODESTORMERS`

Public demo rules:

- each student account has `10` live sessions
- consuming a live session happens when a camera run starts
- only admin or developer accounts can reset the limit
- unknown usernames are redirected to `/access-required`

Private internal admin and developer accounts are also seeded in the backend for
team operations, but they are intentionally not shown on the public login page
and should not be copied into public-facing docs or judge instructions.

## Persistence Model

Two storage layers exist:

- backend SQLite:
  - auth accounts
  - admin approval state
  - live-session quotas
  - session tokens
- browser `localStorage`:
  - live session history
  - cached debriefs
  - local profile snapshot
  - knowledge progress
  - offline-first logs

That means:

- changing browsers does not carry over student session history
- changing or deleting `auth.db` resets seeded-account quota state
- restarting the backend reapplies the latest seeded-account definitions from code

## Main Routes

- `/login`
- `/dashboard`
- `/train/simple-interrupted-suture`
- `/review/[sessionId]`
- `/knowledge`
- `/library`
- `/profile`
- `/admin/reviews`
- `/developer/approvals`
- `/access-required`

## Live Trainer Behavior

Current demo constraints:

- one core procedure: `simple-interrupted-suture`
- each camera run is limited to `2 minutes`
- proactive live analysis runs every `1 second`
- setup accepts clearly visible simulated surfaces such as an orange, banana, or foam pad

Fixed defaults:

- `Simulation-only confirmation`: on
- `Audio coaching`: on
- `Offline-first logging`: on

Still configurable:

- `Skill level`
- `Feedback language`
- `Practice surface`
- `Learner focus`
- `Low-bandwidth capture`

## Review And Admin Flow

- low-confidence or blocked attempts can create review cases
- `/admin/reviews` is for resolved and pending human-review tickets
- developer-only approvals live at `/developer/approvals`
- admin and developer accounts can reset demo account live-session limits

## Verification

```bash
cd frontend
npm run lint
npm run typecheck
npm run build

cd ../backend
source .venv/bin/activate
pytest
```

Useful smoke checks:

```bash
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

## Troubleshooting

- If the login page still shows old seeded-account behavior after code changes, restart the backend.
- If the frontend is deployed on a different origin, update `FRONTEND_ORIGIN` in the backend and restart it.
- If live voice replies are missing, verify both browser microphone permission and `TRANSCRIPTION_API_KEY`.
- If learner history seems missing, confirm you are in the same browser profile that created the session.

## Related Docs

- [docs/how-to-run.md](how-to-run.md)
- [docs/vercel-deployment.md](vercel-deployment.md)
- [docs/api-reference.md](api-reference.md)
- [docs/team-setup.md](team-setup.md)
