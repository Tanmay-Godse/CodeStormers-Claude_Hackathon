# How To Run Locally

This is the fastest way to run the current demo stack on one machine.

## Services

- frontend: `http://localhost:3000`
- backend: `http://localhost:8001`
- frontend route to start with: `/login`

## Prerequisites

- `Node.js 20+`
- `npm 10+`
- `Python 3.10+`
- a browser with camera and microphone support

## 1. Start the Backend

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

Then run:

```bash
uvicorn app.main:app --reload --port 8001
```

## 2. Start the Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

Then run:

```bash
npm run dev
```

## 3. Sign In With Demo Accounts

Open:

```text
http://localhost:3000/login
```

Public student demo accounts:

- `Student_1@gmail.com`
- `Student_2@gmail.com`
- `Student_3@gmail.com`
- `Student_4@gmail.com`
- shared password: `CODESTORMERS`

Important behavior:

- self-service signup is disabled in the public demo flow
- unknown usernames are redirected to `/access-required`
- each public student account has `10` live sessions
- only admin or developer accounts can reset those limits

## 4. Run the Main Demo Flow

1. Sign in from `/login`.
2. Open `/dashboard`.
3. Open `/train/simple-interrupted-suture`.
4. Start the camera.
5. Let setup pass on a visible simulated surface such as an orange, banana, or foam pad.
6. Use `Check My Step` for grading and coaching.
7. Open the generated review from the session flow.
8. Use `/knowledge` and `/library` as supporting study surfaces.

## Trainer Notes

Current demo behavior:

- each live camera run is limited to `2 minutes`
- background live analysis runs every `1 second`
- `Simulation-only confirmation`, `Audio coaching`, and `Offline-first logging` are fixed on
- learners can still change `Skill level`, `Feedback language`, `Practice surface`, `Learner focus`, and `Low-bandwidth capture`
- setup can pass automatically once a safe practice surface is clearly visible

## Quick Checks

Backend:

```bash
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

Frontend and backend quality checks:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build

cd ../backend
source .venv/bin/activate
pytest
```

## Troubleshooting

- Camera and microphone require `localhost` or `https`.
- If you changed seeded demo passwords or account rules in code, restart the backend so the seeded-account sync reruns.
- If learner speech is not transcribed, confirm `TRANSCRIPTION_API_KEY` is configured.
- If the frontend can load but API calls fail, verify `NEXT_PUBLIC_API_BASE_URL` matches the running backend.
- If the deployed frontend cannot call the backend, check that `FRONTEND_ORIGIN` matches the exact frontend origin.

## More Detail

- [docs/local-setup.md](local-setup.md)
- [docs/vercel-deployment.md](vercel-deployment.md)
- [docs/api-reference.md](api-reference.md)
- [backend/README.md](../backend/README.md)
- [frontend/README.md](../frontend/README.md)
