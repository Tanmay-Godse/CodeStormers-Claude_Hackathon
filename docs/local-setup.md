# Local Setup Guide

This is the fuller developer-oriented setup and behavior reference for the
current demo build.

## Use This Guide When

- you are developing features locally
- you need the canonical local environment setup
- you are debugging auth, quotas, review state, or persistence behavior
- you want the architecture and troubleshooting notes in one place

## Architecture At A Glance

- `frontend`: Next.js app with dashboard, trainer, review, knowledge, library, profile, admin, and developer flows
- `backend`: FastAPI app with auth, AI routing, safety gate, review queue, and TTS
- `main AI model`: Anthropic by default, with OpenAI-compatible main-provider support
- `transcription`: OpenAI `gpt-4o-mini-transcribe`
- `auth persistence`: SQLite at `backend/app/data/auth.db`
- `learning-state persistence`: SQLite at `backend/app/data/learning_state.db`
- `review queue persistence`: `backend/app/data/review_cases.json`
- `browser cache`: `localStorage` for fast hydration, cached debriefs, and offline-friendly logs
- `recommended hosted shape`: frontend on Vercel, backend on a separate persistent Python host

## Local URLs

- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- backend API base: `http://localhost:8001/api/v1`

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

The recommended defaults already live in `backend/.env.example`. After copying
it, make sure these values are correct for your machine:

- `FRONTEND_ORIGIN=http://localhost:3000`
- choose one main-provider setup from [cloud-keys.md](cloud-keys.md)
- `AI_API_KEY`: real key for the selected main provider
- `TRANSCRIPTION_API_KEY`: real OpenAI key for learner speech transcription
- `PRIVATE_SEED_ACCOUNTS_JSON`: optional team-only private admin or developer accounts

Use [cloud-keys.md](cloud-keys.md) for the exact local `backend/.env` blocks for:

- Anthropic main AI plus OpenAI transcription
- OpenAI main AI plus OpenAI transcription
- shell-exported secrets instead of storing keys in `backend/.env`

For the least confusing local setup, add your real keys directly to
`backend/.env` and start the server. Real keys in that file take priority over
old shell-exported values. If you update a key, restart the backend.

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

Set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

Run it:

```bash
npm run dev
```

## Account Model

The current build supports normal self-service account creation from `/login`.

Default account behavior:

- new student accounts can sign up directly from `/login`
- new admin reviewer accounts are created as student accounts first and marked with a pending admin access request
- the fixed developer account can approve or reject those admin requests

Seeded public student accounts still exist for judging and smoke testing:

- `Student_1@gmail.com`
- `Student_2@gmail.com`
- `Student_3@gmail.com`
- `Student_4@gmail.com`
- shared password: `CODESTORMERS`

Public demo rules:

- each student account has `10` live sessions
- consuming a live session happens when a camera run starts
- only admin or developer accounts can reset seeded-account limits

Private internal admin and developer accounts can be seeded through
`PRIVATE_SEED_ACCOUNTS_JSON`, but those credentials should never be copied into
public docs or screenshots.

## Persistence Model

Two storage layers exist:

- backend runtime data:
  - auth accounts
  - admin approval state
  - live-session quotas
  - session tokens
  - persisted session history
  - active session pointers per procedure
  - knowledge progress
  - review queue state
- browser `localStorage`:
  - cached debriefs
  - cached learning-state snapshot for quick page loads
  - local profile snapshot derived from synced sessions
  - offline-first logs

That means:

- changing browsers still preserves session history and Knowledge Lab progress if the same account signs in against the same persistent backend
- clearing browser storage removes the local cache, but synced learning state can rehydrate from the backend
- deleting `backend/app/data/auth.db` resets self-service accounts, seeded-account quota state, and approval/session-token state
- deleting `backend/app/data/learning_state.db` resets synced session history and Knowledge Lab progress
- deleting `backend/app/data/review_cases.json` clears persisted review queue state
- restarting the backend reapplies the latest seeded-account definitions from code and environment

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
- `/access-required` legacy fallback route for older links

## Live Trainer Behavior

Current demo constraints:

- one core procedure: `simple-interrupted-suture`
- each camera run is limited to `2 minutes`
- setup analysis can auto-run after the camera starts
- live analysis continues during the active run
- setup accepts clearly visible simulated surfaces such as an orange, banana, or foam pad

Fixed defaults in the demo build:

- `Simulation-only confirmation`: on
- `Audio coaching`: on
- `Offline-first logging`: on

Still configurable:

- `Skill level`
- `Feedback language`
- `Practice surface`
- `Learner focus`
- `Low-bandwidth capture`

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

- Login or account behavior still looks stale:
  restart both frontend and backend so the latest auth flow and seeded-account sync load together.
- A newly created admin reviewer account cannot enter `/admin/reviews` yet:
  that account is still pending developer approval and should use the student workspace until approval lands.
- Live preview fails immediately with an Anthropic credential error:
  `AI_API_KEY` is missing, placeholder-only, revoked, or wrong.
- Live preview fails immediately with an OpenAI-compatible provider error:
  verify `AI_PROVIDER`, `AI_API_BASE_URL`, `AI_API_KEY`, and the selected OpenAI model id.
- Frontend is deployed on a different origin:
  update `FRONTEND_ORIGIN` in the backend and restart it.
- Learner voice is not transcribed:
  verify both browser microphone permission and `TRANSCRIPTION_API_KEY`.
- Review page cannot find a session:
  verify the backend is using persistent storage and the same signed-in account; the browser cache can be rebuilt from backend SQLite, but ephemeral backend storage will lose synced session history.

## Related Docs

- [how-to-run.md](how-to-run.md)
- [cloud-keys.md](cloud-keys.md)
- [team-setup.md](team-setup.md)
- [vercel-deployment.md](vercel-deployment.md)
- [backend-deployment.md](backend-deployment.md)
- [api-reference.md](api-reference.md)
