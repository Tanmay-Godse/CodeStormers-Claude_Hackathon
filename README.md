# AI Clinical Skills Coach

AI Clinical Skills Coach is a simulation-only trainer for practicing a simple interrupted suture on a safe surface such as an orange, banana, or foam pad. The app is split into a Next.js frontend and a FastAPI backend. The frontend owns camera capture, calibration, overlays, and review UX. The backend owns procedure rubrics, AI prompting, response validation, scoring, and debrief generation.

## Current Scope

- One procedure: `simple-interrupted-suture`
- One core flow: landing -> train -> analyze -> review
- Browser-local session storage
- Deterministic scoring in Python
- AI-backed frame analysis and session debriefing
- Auto-detected support for OpenAI-compatible and Anthropic-style AI endpoints
- Fallback review generation when the debrief AI path is unavailable

## Documentation

- `docs/local-setup.md`: full setup, run, verification, and troubleshooting guide
- `docs/api-reference.md`: backend contract, request and response shapes, and error behavior
- `backend/README.md`: backend-specific setup, environment, and testing notes
- `frontend/README.md`: frontend-specific setup, environment, and data-flow notes

## Repository Layout

```text
.
|-- backend/   FastAPI API, procedure contract, AI transport, scoring, tests
|-- docs/      setup guide and API reference
`-- frontend/  Next.js landing, trainer, and review UI
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

- `Qwen3-4B` is text-only, so it is not suitable for `/api/v1/analyze-frame`
- `Qwen/Qwen2.5-VL-3B-Instruct` is a good lightweight vision-capable option
- `Qwen/Qwen2.5-Omni-7B` is a stronger multimodal choice if you want one model for both image analysis and debrief generation
- Anthropic-backed analysis also requires a vision-capable model on the provider side

## Quick Start

### 1. Start a model endpoint

Example local OpenAI-compatible server:

```bash
vllm serve Qwen/Qwen2.5-Omni-7B --api-key EMPTY
```

### 2. Start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Set `backend/.env` to point at your AI endpoint before starting the trainer.

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
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/procedures/simple-interrupted-suture
curl -X POST http://localhost:8000/api/v1/analyze-frame \
  -H 'Content-Type: application/json' \
  -d '{"procedure_id":"simple-interrupted-suture","stage_id":"needle_entry","skill_level":"beginner","image_base64":"ZmFrZQ=="}'
curl -X POST http://localhost:8000/api/v1/debrief \
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
- The review page still renders local session history even if fresh debrief generation fails
- `POST /api/v1/analyze-frame` returns `503` when live AI analysis is not configured
- `POST /api/v1/analyze-frame` returns `502` when the upstream AI call fails or returns invalid JSON
- `POST /api/v1/debrief` falls back to a deterministic study summary when the AI path is unavailable or partial

## Limitations

- Simulation-only; not for real clinical care or diagnosis
- One procedure only in the current build
- No auth and no database-backed persistence
- AI output quality still depends on the model and image quality
- Review history is tied to the browser profile that created the session
