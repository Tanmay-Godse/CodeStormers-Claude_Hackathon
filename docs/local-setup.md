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
- `main AI model`: local vLLM by default, with optional Anthropic fallback
- `speech input`: browser STT first in the trainer, with OpenAI `gpt-4o-mini-transcribe` backend transcription available for diagnostics and fallback
- `speech output`: browser speech first, with backend TTS fallback
- `auth persistence`: SQLite at `backend/app/data/auth.db`
- `learning-state persistence`: SQLite at `backend/app/data/learning_state.db`
- `review queue persistence`: `backend/app/data/review_cases.json`
- `browser cache`: `localStorage` for fast hydration, cached debriefs, and offline-friendly logs
- `recommended hosted shape`: frontend on Vercel, backend on a separate persistent Python host

## Local URLs

- local model server: `http://localhost:8000`
- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- backend API base: `http://localhost:8001/api/v1`

## Local Model Server

```bash
cd backend
LOCAL_VLLM_KEY=$(/home/tanmay-godse/micromamba/envs/hackathon/bin/python - <<'PY'
from dotenv import dotenv_values
print(dotenv_values('.env').get('AI_API_KEY', 'local-vllm-key'))
PY
)

micromamba run -n capstone vllm serve \
  /home/tanmay-godse/.cache/huggingface/hub/models--Qwen--Qwen2.5-VL-3B-Instruct/snapshots/66285546d2b821cf421d4f5eb2576359d3770cd3 \
  --served-model-name Qwen/Qwen2.5-VL-3B-Instruct \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key "$LOCAL_VLLM_KEY" \
  --gpu-memory-utilization 0.85 \
  --max-model-len 4096 \
  --limit-mm-per-prompt '{"image":1}'
```

## Backend Setup

```bash
cd backend
micromamba run -n <your env> pip install -r requirements.txt
cp .env.example .env
```

If your shell already has `micromamba activate <your env>`, the same commands
work without the prefix. The docs keep `micromamba run -n <your env>` so the
backend environment stays explicit.

The recommended defaults already live in `backend/.env.example`. After copying
it, make sure these values are correct for your machine:

- `FRONTEND_ORIGIN=http://localhost:3000`
- `AI_API_KEY`: bearer token the backend will send to the local vLLM server
- `AI_FALLBACK_API_KEY`: optional real Anthropic key if you want cloud fallback
- `TRANSCRIPTION_API_KEY`: real OpenAI key for learner speech transcription
- `PRIVATE_SEED_ACCOUNTS_JSON`: optional team-only private admin or developer accounts

Use [cloud-keys.md](cloud-keys.md) if you want to swap the repo back to a
cloud-first provider layout. The checked-in local defaults are now:

- local vLLM on `localhost:8000` as the primary model path
- optional Anthropic fallback if the local model is unavailable
- OpenAI transcription for learner speech diagnostics

Run it:

```bash
micromamba run -n hackathon uvicorn app.main:app --reload --reload-dir app --port 8001
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

- `student_1@gmail.com`
- `student_2@gmail.com`
- `student_3@gmail.com`
- `student_4@gmail.com`
- shared password: `Qwerty@123`

Public demo rules:

- each student account has `10` live sessions
- consuming a live session happens when the first real non-setup training step begins
- only admin or developer accounts can reset seeded-account limits
- usernames are normalized to lowercase and trimmed before create/sign-in, so
  duplicates are rejected even if the casing or spaces differ

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
- setup accepts clearly visible simulated surfaces such as any fruit or foam pad
- student accounts default to `10` live sessions unless a different limit is seeded

Setup and audio flow:

- `Setup` tab runs a preflight for backend/API reachability, AI readiness,
  secure context, camera and mic permissions, browser STT availability, backend
  transcription readiness, network state, and live-session quota state
- `Check Audio` is audio-only and does not send a camera frame or consume
  image-analysis calls
- `Check Audio` tries Browser STT first and, when backend transcription is
  ready, also captures one backend comparison sample so both result cards can be
  shown together
- browser speech playback is attempted first for coach audio, with backend TTS
  fallback if browser playback does not start

Session behavior and controls:

- starting the camera opens local preview first and does not consume quota by itself
- setup does not auto-pass when the camera starts
- on the setup stage, `Check My Step` runs a local preflight, can briefly open
  camera and mic permissions, and then closes the preview again
- the counted live session begins on the first real non-setup `Check My Step`
- `Pause Session` stops live capture while preserving the current run state and
  remaining time
- `End Session` closes the current run cleanly
- the coach loop becomes active after setup is confirmed

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
- `Coach voice` (`Guide voice (US male)`, `Guide voice (US)`, `Mentor voice (US)`, `System default (US)`)

## Verification

```bash
cd frontend
npm run lint
npm run typecheck
npm run build

cd ../backend
micromamba run -n <your env> pytest
```

Useful smoke checks:

```bash
curl -H "Authorization: Bearer $(/home/tanmay-godse/micromamba/envs/hackathon/bin/python - <<'PY'
from dotenv import dotenv_values
print(dotenv_values('backend/.env').get('AI_API_KEY', 'local-vllm-key'))
PY
)" http://localhost:8000/v1/models
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

## Troubleshooting

- Login or account behavior still looks stale:
  restart both frontend and backend so the latest auth flow and seeded-account sync load together.
- A newly created admin reviewer account cannot enter `/admin/reviews` yet:
  that account is still pending developer approval and should use the student workspace until approval lands.
- Browser STT works inconsistently across browsers:
  use the trainer `Setup` tab and the dedicated `Mic and speech test` area to
  confirm whether browser speech recognition is usable in the current browser.
- Local vLLM returns `401 Unauthorized`:
  the model server `--api-key` does not match `AI_API_KEY` in `backend/.env`.
- Live preview fails immediately with a local OpenAI-compatible provider error:
  verify `AI_PROVIDER`, `AI_API_BASE_URL`, `AI_API_KEY`, and the selected local model id.
- Anthropic fallback never engages:
  `AI_FALLBACK_API_KEY` or the `AI_FALLBACK_*_MODEL` values are missing.
- Frontend is deployed on a different origin:
  update `FRONTEND_ORIGIN` in the backend and restart it.
- Learner voice is not transcribed:
  verify browser microphone permission, Browser STT availability, and
  `TRANSCRIPTION_API_KEY`. The setup diagnostics now show which path is active.
- Review page cannot find a session:
  verify the backend is using persistent storage and the same signed-in account; the browser cache can be rebuilt from backend SQLite, but ephemeral backend storage will lose synced session history.
- Uvicorn reload hits a watchfiles permission error:
  start the backend from `backend/` with
  `micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001`
  so reload only watches `app/`.

## Related Docs

- [how-to-run.md](how-to-run.md)
- [cloud-keys.md](cloud-keys.md)
- [team-setup.md](team-setup.md)
- [vercel-deployment.md](vercel-deployment.md)
- [backend-deployment.md](backend-deployment.md)
- [api-reference.md](api-reference.md)
