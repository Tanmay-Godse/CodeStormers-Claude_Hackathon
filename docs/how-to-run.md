# How To Run Locally

This is the fastest path to run the current demo stack on one machine.

## What You Will Run

- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- first page to open: `http://localhost:3000/login`

## Prerequisites

- `Node.js 20+`
- `npm 10+`
- `Python 3.10+`
- a browser with camera and microphone support

## 1. Start The Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Before launching the backend, update `backend/.env` with real secrets:

- choose one main AI provider setup in [cloud-keys.md](cloud-keys.md)
- `AI_API_KEY`: real key for the selected main AI provider
- `TRANSCRIPTION_API_KEY`: real OpenAI key for learner speech transcription
- `FRONTEND_ORIGIN`: keep as `http://localhost:3000` for local development

The checked-in `.env.example` already contains the current demo defaults for the
Anthropic-main setup plus a commented OpenAI-main example. Use
[cloud-keys.md](cloud-keys.md) for the exact copy-paste blocks.

For local development, the simplest path is now the recommended one: put your
real keys in `backend/.env` and run the backend. Real key values in that file
take priority over stale shell-exported secrets. If you change a key, restart
the backend.

Run the backend:

```bash
uvicorn app.main:app --reload --port 8001
```

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

## 3. Sign In To The Demo

Open:

```text
http://localhost:3000/login
```

You can either create a normal account on `/login` or use one of the seeded
demo accounts below.

Seeded public student demo accounts:

- `Student_1@gmail.com`
- `Student_2@gmail.com`
- `Student_3@gmail.com`
- `Student_4@gmail.com`
- shared password: `CODESTORMERS`

Public demo behavior:

- self-service signup is enabled for normal student accounts
- new admin reviewer accounts start in the student workspace with a pending admin access request
- each public student account has `10` live sessions
- the live-session allowance is consumed when a camera run starts
- only admin or developer accounts can reset seeded-account limits

## 4. Run The Main Smoke Flow

1. Sign in from `/login`.
2. Open `/dashboard`.
3. Open `/train/simple-interrupted-suture`.
4. Start the camera.
5. Let setup pass on a clearly visible simulated surface such as an orange, banana, or foam pad.
6. Use `Check My Step` for grading and coaching.
7. Open the generated review from the session flow.
8. Visit `/knowledge` and `/library` to confirm the supporting surfaces load.
9. Refresh `/dashboard` or `/review/[sessionId]` and confirm the session history rehydrates from the backend.

## 5. Quick Checks

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
source .venv/bin/activate
pytest
```

## Common Issues

- Account creation works but admin login is denied:
  that account is still pending developer approval, so sign in through the
  student workspace until the request is approved.
- `invalid x-api-key` or an Anthropic credential error when the live preview starts:
  the backend `AI_API_KEY` is missing, placeholder-only, revoked, or wrong.
- OpenAI-backed analysis fails as soon as the live preview starts:
  `AI_API_BASE_URL`, `AI_API_KEY`, or the selected OpenAI main model is wrong.
- Learner voice is not transcribed:
  the backend `TRANSCRIPTION_API_KEY` is missing, placeholder-only, revoked, or wrong.
- Frontend loads but API calls fail:
  `NEXT_PUBLIC_API_BASE_URL` does not match the running backend.
- Deployed frontend cannot call the backend:
  `FRONTEND_ORIGIN` does not match the exact frontend origin allowed by the backend.
- Camera or microphone does not start:
  use `localhost` or `https`, and confirm browser permissions.

## Next Docs

- [local-setup.md](local-setup.md)
- [cloud-keys.md](cloud-keys.md)
- [team-setup.md](team-setup.md)
- [vercel-deployment.md](vercel-deployment.md)
- [api-reference.md](api-reference.md)
