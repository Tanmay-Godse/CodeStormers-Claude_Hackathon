# How To Run Locally

This is the fastest path to run the current demo stack on one machine.
It assumes you are starting from the repo root.

## What You Will Run

- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- first page to open: `http://localhost:3000/login`

## Prerequisites

- `Node.js 20+`
- `npm 10+`
- `Python 3.10+`
- `micromamba` with the `hackathon` environment available
- a browser with camera and microphone support

The commands below use `micromamba run -n hackathon` so the backend always uses
the intended Python environment. If you already ran `micromamba activate
hackathon`, the same commands also work without that prefix.

## 1. Start The Backend

```bash
cd backend
micromamba run -n hackathon pip install -r requirements.txt
cp .env.example .env
```

Before launching the backend, update `backend/.env` with real secrets:

- choose one main AI provider setup in [cloud-keys.md](cloud-keys.md)
- `AI_API_KEY`: real key for the selected main AI provider
- `TRANSCRIPTION_API_KEY`: real OpenAI key for learner speech transcription
- `FRONTEND_ORIGIN`: keep as `http://localhost:3000` for local development
- `PRIVATE_SEED_ACCOUNTS_JSON`: optional private admin or developer accounts for internal use only

The checked-in `.env.example` already contains the current demo defaults for the
Anthropic-main setup plus a commented OpenAI-main example. Use
[cloud-keys.md](cloud-keys.md) for the exact copy-paste blocks.

For local development, the simplest path is now the recommended one: put your
real keys in `backend/.env` and run the backend. Real key values in that file
take priority over stale shell-exported secrets. If you change a key, restart
the backend.

Run the backend:

```bash
micromamba run -n hackathon uvicorn app.main:app --reload --reload-dir app --port 8001
```

On first startup, the backend creates or refreshes the seeded public demo
accounts and initializes the local runtime data files under
`backend/app/data/`.

Using `--reload-dir app` keeps Uvicorn watching only the backend source folder.
That avoids file-watch permission issues that can happen when reload mode tries
to scan your whole home directory.

## 2. Start The Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

Run the frontend:

```bash
npm run dev
```

If you change `NEXT_PUBLIC_API_BASE_URL`, restart the frontend dev server.

## 3. Sign In To The Demo

Open:

```text
http://localhost:3000/login
```

You can either create a normal account on `/login` or use one of the seeded
demo accounts below.

Seeded public student demo accounts:

- `student_1@gmail.com`
- `student_2@gmail.com`
- `student_3@gmail.com`
- `student_4@gmail.com`
- shared password: `Qwerty@123`

Public demo behavior:

- self-service signup is enabled for normal student accounts
- self-service student accounts also start with the standard `10` live sessions
- new admin reviewer accounts start in the student workspace with a pending admin access request
- each seeded public student account has `10` live sessions
- the live-session allowance is consumed when the first real non-setup training step begins
- only admin or developer accounts can reset seeded-account limits

## 4. Understand The Trainer Setup Flow

Before you run a graded step, the live trainer now separates setup,
audio-diagnostic, and image-analysis actions:

- `Setup` tab:
  checks backend/API reachability, AI readiness, secure browser context, camera
  and mic permission state, browser speech-to-text availability, backend
  transcription readiness, network state, and live-session quota state.
- `Check Audio`:
  runs an audio-only diagnostic. It does not send a camera frame and does not
  consume image-analysis calls.
- `Check Audio` speech path:
  tries Browser STT first. If backend transcription is ready, it also captures
  one backend comparison sample and shows both result cards in the footer.
- `Check My Step`:
  runs the current stage check. On `Setup`, it runs a local preflight that can
  briefly open camera and microphone permissions without starting a counted
  live session. On later stages, it runs frame analysis.
- session controls:
  `Pause Session` keeps the current run state and remaining time, while
  `End Session` closes the current run cleanly.
- coach speech:
  the trainer tries browser speech playback first and falls back to backend TTS
  when browser playback does not actually start.

## 5. Run The Main Smoke Flow

1. Sign in from `/login`.
2. Open `/dashboard`.
3. Open `/train/simple-interrupted-suture`.
4. Stay on the `Setup` tab and confirm the preflight checks load.
5. Run `Check Audio`, speak one short sentence, and confirm the footer shows Browser STT plus Backend Transcribe results when backend transcription is configured.
6. Run `Check My Step` once on `Setup` and confirm the local preflight finishes quickly.
7. If prompted, allow camera and microphone permissions.
8. Confirm the setup check closes the preview again and does not consume a live-session allowance.
9. Start camera preview for the first real non-setup stage.
10. Frame a clearly visible simulated surface such as any fruit or foam pad.
11. Use `Check My Step` on a non-setup stage and confirm the trainer starts the counted live session, analysis, and timer there.
12. Optionally test `Pause Session` and `End Session` so the live controls are confirmed before a demo.
13. Open the generated review from the session flow.
14. Visit `/knowledge` and `/library` to confirm the supporting surfaces load.
15. Refresh `/dashboard` or `/review/[sessionId]` and confirm the session history rehydrates from the backend.

## 6. Quick Checks

Backend:

```bash
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

Quality checks:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build

cd ../backend
micromamba run -n hackathon pytest
```

Optional clean-state reset for local demos:

```bash
rm -f backend/app/data/auth.db
rm -f backend/app/data/learning_state.db
rm -f backend/app/data/review_cases.json
```

Run that only if you intentionally want to clear local accounts, session
history, Knowledge Lab progress, and persisted review cases before restarting
the backend.

## 7. Common Issues

- Account creation works but admin login is denied:
  that account is still pending developer approval, so sign in through the
  student workspace until the request is approved.
- Login state or demo quotas look stale after changing auth code or local data:
  restart the backend so seeded accounts and runtime state reinitialize cleanly.
- `ModuleNotFoundError: No module named 'app'` when starting the backend:
  you are probably not inside the `backend/` folder. Run the Uvicorn command
  from `backend/`.
- `invalid x-api-key` or an Anthropic credential error when the live preview starts:
  the backend `AI_API_KEY` is missing, placeholder-only, revoked, or wrong.
- OpenAI-backed analysis fails as soon as the live preview starts:
  `AI_API_BASE_URL`, `AI_API_KEY`, or the selected OpenAI main model is wrong.
- Learner voice is not transcribed:
  browser STT may be unavailable in that browser, or the backend
  `TRANSCRIPTION_API_KEY` is missing, placeholder-only, revoked, or wrong. Use
  the trainer `Setup` tab and `Check Audio` to see which speech path is active.
- `Check Audio` shows both browser and backend result cards:
  that is expected when backend transcription is configured. The shortcut now
  compares both paths in one run so you can see transcript and timing side by
  side.
- The live session starts but stops quickly:
  each camera run is intentionally capped at `2 minutes` in the current demo build.
- Uvicorn reload fails with a watchfiles permission error:
  use `micromamba run -n hackathon uvicorn app.main:app --reload --reload-dir app --port 8001`
  from the `backend/` folder so file watching stays scoped to `app/`.
- Frontend loads but API calls fail:
  `NEXT_PUBLIC_API_BASE_URL` does not match the running backend.
- Deployed frontend cannot call the backend:
  `FRONTEND_ORIGIN` does not match the exact frontend origin allowed by the backend.
- Camera or microphone does not start:
  use `localhost` or `https`, confirm browser permissions, and refresh the
  trainer if the tab was already open before permissions changed.

## 8. Next Docs

- [local-setup.md](local-setup.md)
- [cloud-keys.md](cloud-keys.md)
- [team-setup.md](team-setup.md)
- [vercel-deployment.md](vercel-deployment.md)
- [api-reference.md](api-reference.md)
