# AI Clinical Skills Coach

AI Clinical Skills Coach is a simulation-only trainer for practicing a simple interrupted suture on a safe surface such as an orange, banana, or foam pad. The app is split into a Next.js frontend and a FastAPI backend. The frontend owns camera capture, calibration, overlays, and review UX. The backend owns procedure rubrics, AI prompting, response validation, scoring, and debrief generation.

## Current Scope

- One procedure: `simple-interrupted-suture`
- One core flow: landing -> train -> analyze -> review
- Browser-local session storage
- Deterministic scoring in Python
- AI-backed frame analysis and session debriefing
- Human-in-the-loop validation queue for flagged sessions
- Hard simulation-only safety gate before analysis
- Student and admin login entry points
- Equity mode with multilingual feedback selection, audio coaching, low-bandwidth capture, cheap-phone compatibility, and offline-first practice logging
- Open learning-library assets for rubrics and benchmark starters
- Safer-skills roadmap for broader, lower-risk module expansion
- Auto-detected support for OpenAI-compatible and Anthropic-style AI endpoints
- Fallback review generation when the debrief AI path is unavailable

## Documentation

- `docs/local-setup.md`: full setup, run, verification, and troubleshooting guide
- `docs/api-reference.md`: backend contract, request and response shapes, and error behavior
- `docs/safer-skills-roadmap.md`: recommended next modules with a safer-skills-first expansion order
- `backend/README.md`: backend-specific setup, environment, and testing notes
- `frontend/README.md`: frontend-specific setup, environment, and data-flow notes
- `open-library/README.md`: public rubric and benchmark starter assets

## Repository Layout

```text
.
|-- backend/       FastAPI API, procedure contract, AI transport, scoring, tests
|-- docs/          setup guide, API reference, and roadmap notes
|-- frontend/      Next.js landing, trainer, review, and library UI
`-- open-library/  public rubric and benchmark starter assets
```

## AI Provider Support

The backend now uses one generic AI configuration surface:

- `AI_PROVIDER`
- `AI_API_BASE_URL`
- `AI_API_KEY`
- `AI_ANALYSIS_MODEL`
- `AI_DEBRIEF_MODEL`

`AI_PROVIDER=auto` is the default. In that mode:

- Anthropic-style `/messages` endpoints are treated as Anthropic
- everything else is treated as OpenAI-compatible
- older `OPENAI_*` and `ANTHROPIC_*` env names still work as aliases

This means you can point the same backend at:

- a local vLLM server that exposes `/v1/chat/completions`
- a hosted OpenAI-compatible model server
- Anthropic's Messages API

If you use a custom proxy with a nonstandard URL, set `AI_PROVIDER=openai` or `AI_PROVIDER=anthropic` explicitly.

## Model Guidance

- `chaitnya26/Qwen2.5-Omni-3B-Fork` is the local single-model example used in this repo for both `/api/v1/analyze-frame` and `/api/v1/debrief`
- `Qwen/Qwen2.5-VL-3B-Instruct` is still a good lighter vision-capable alternative
- text-only models will not work for `/api/v1/analyze-frame`
- Anthropic-backed analysis also requires a vision-capable model on the provider side

## Quick Start

### 1. Start a model endpoint

Example local OpenAI-compatible server:

```bash
vllm serve chaitnya26/Qwen2.5-Omni-3B-Fork --port 8000 --api-key EMPTY
```

### 2. Start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

Set `backend/.env` to point at your AI endpoint before starting the trainer.
The examples in this repo use `http://localhost:8000/v1` for the model server and `http://localhost:8001` for the backend.

### 3. Start the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

### 4. Open the app

Visit `http://localhost:3000`.

## Verification

Backend smoke checks:

```bash
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
curl -X POST http://localhost:8001/api/v1/analyze-frame \
  -H 'Content-Type: application/json' \
  -d '{"procedure_id":"simple-interrupted-suture","stage_id":"needle_entry","skill_level":"beginner","image_base64":"ZmFrZQ=="}'
curl -X POST http://localhost:8001/api/v1/debrief \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo-session","procedure_id":"simple-interrupted-suture","skill_level":"beginner","events":[]}'
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

## Reliability Notes

- The frontend stores session records and cached debriefs in browser `localStorage`
- Offline-first practice logs are also stored in browser `localStorage` when equity mode is enabled
- The review page still renders local session history even if fresh debrief generation fails
- The trainer requires simulation-only confirmation before analysis
- Flagged sessions can be escalated into the admin review queue for human validation
- Equity mode can request multilingual AI feedback and debriefs in English, Spanish, French, or Hindi
- `POST /api/v1/analyze-frame` returns `503` when live AI analysis is not configured
- `POST /api/v1/analyze-frame` returns `502` when the upstream AI call fails or returns invalid JSON
- `POST /api/v1/debrief` falls back to a deterministic study summary when the AI path is unavailable or partial

## Limitations

- Simulation-only; not for real clinical care or diagnosis
- One procedure only in the current build
- Login is browser-local and demo-friendly, not production auth
- No database-backed persistence
- AI output quality still depends on the model and image quality
- Review history is tied to the browser profile that created the session
