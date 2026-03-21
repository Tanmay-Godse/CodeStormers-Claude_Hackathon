# Local Setup Guide

This guide walks through the full local setup for AI Clinical Skills Coach, including OpenAI-compatible and Anthropic-style AI backends.

## 1. Prerequisites

Recommended local tooling:

- `Node.js` 20 or newer
- `npm` 10 or newer
- `Python` 3.10 or newer
- a webcam if you want to test the live trainer flow

Notes:

- the backend test run in this workspace is passing on Python `3.10.11`
- the frontend uses Next `16.x`, React `19.x`, and TypeScript `5.x`

## 2. Open the Repository

If you already have the repo locally:

```bash
cd CodeStormers-Claude_Hackathon
```

If you are cloning it fresh:

```bash
git clone <your-repo-url>
cd CodeStormers-Claude_Hackathon
```

## 3. Start or Choose an AI Endpoint

The backend now supports two AI endpoint styles:

- OpenAI-compatible endpoints such as local vLLM
- Anthropic-style Messages endpoints

The backend auto-detects which one to use from `AI_API_BASE_URL` unless you override it with `AI_PROVIDER`.

### Option A: OpenAI-Compatible Example with vLLM

Recommended when you want to run local Qwen models.

Example server:

```bash
vllm serve Qwen/Qwen2.5-Omni-7B --api-key EMPTY
```

Good model choices:

- `Qwen/Qwen2.5-VL-3B-Instruct`: lighter vision-capable option
- `Qwen/Qwen2.5-Omni-7B`: stronger multimodal option for both analysis and debrief

Do not use:

- `Qwen3-4B` for `/api/v1/analyze-frame`, because it is text-only

### Option B: Anthropic-Style Endpoint

Use an Anthropic-compatible `/messages` endpoint if you want to run against Anthropic directly or through a compatible proxy.

Example base URL:

```text
https://api.anthropic.com/v1/messages
```

If your proxy URL does not obviously look like Anthropic, set `AI_PROVIDER=anthropic` explicitly.

## 4. Backend Setup

### PowerShell

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

### Bash

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### Backend Environment

Open `backend/.env` and choose one of these patterns.

#### OpenAI-Compatible or vLLM

```env
FRONTEND_ORIGIN=http://localhost:3000
SIMULATION_ONLY=true
AI_PROVIDER=auto
AI_API_BASE_URL=http://localhost:8000/v1
AI_API_KEY=EMPTY
AI_ANALYSIS_MODEL=Qwen/Qwen2.5-Omni-7B
AI_DEBRIEF_MODEL=Qwen/Qwen2.5-Omni-7B
AI_TIMEOUT_SECONDS=60
AI_ANALYSIS_MAX_TOKENS=1400
AI_DEBRIEF_MAX_TOKENS=1200
```

#### Anthropic-Style

```env
FRONTEND_ORIGIN=http://localhost:3000
SIMULATION_ONLY=true
AI_PROVIDER=auto
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=your_api_key_here
AI_ANALYSIS_MODEL=your_vision_capable_model
AI_DEBRIEF_MODEL=your_text_or_multimodal_model
AI_TIMEOUT_SECONDS=60
AI_ANALYSIS_MAX_TOKENS=1400
AI_DEBRIEF_MAX_TOKENS=1200
ANTHROPIC_VERSION=2023-06-01
```

### Auto-Detection Rules

With `AI_PROVIDER=auto`:

- `anthropic.com` URLs are treated as Anthropic
- URLs ending in `/messages` are treated as Anthropic
- everything else is treated as OpenAI-compatible

Older environment names such as `OPENAI_API_BASE_URL` and `ANTHROPIC_API_KEY` still work as aliases, but `AI_*` is the preferred format.

### Start the Backend

```bash
uvicorn app.main:app --reload --port 8000
```

Expected result:

```text
Uvicorn running on http://127.0.0.1:8000
```

## 5. Frontend Setup

### PowerShell

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

### Bash

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Default frontend environment:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

This should point at the backend API, not at your model server.

## 6. Open the App

Visit:

```text
http://localhost:3000
```

You should see the landing page for AI Clinical Skills Coach.

## 7. First-Run Verification

Before testing the trainer UI, verify the backend from another terminal.

### Health Check

```bash
curl http://localhost:8000/api/v1/health
```

Expected result:

```json
{"status":"ok","simulation_only":true}
```

### Procedure Metadata

```bash
curl http://localhost:8000/api/v1/procedures/simple-interrupted-suture
```

This should return:

- the procedure id and title
- simulation-only metadata
- 7 stages
- 8 named overlay targets

### Analyze Endpoint

```bash
curl -X POST http://localhost:8000/api/v1/analyze-frame \
  -H 'Content-Type: application/json' \
  -d '{"procedure_id":"simple-interrupted-suture","stage_id":"needle_entry","skill_level":"beginner","image_base64":"ZmFrZQ=="}'
```

With a valid AI endpoint and a vision-capable model, this should return a response containing:

- `step_status`
- `confidence`
- `visible_observations`
- `issues`
- `coaching_message`
- `next_action`
- `overlay_target_ids`
- `score_delta`

Without `AI_API_BASE_URL`, this route returns `503`.

If the upstream model request fails or returns invalid JSON, this route returns `502`.

### Debrief Endpoint

```bash
curl -X POST http://localhost:8000/api/v1/debrief \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo-session","procedure_id":"simple-interrupted-suture","skill_level":"beginner","events":[]}'
```

This route always returns a structured debrief shape:

- with empty `events`, it returns a simple default study summary
- with non-empty `events`, it prefers model-backed output
- if the debrief AI path fails or returns a partial shape, the backend falls back to deterministic content

## 8. Trainer Flow

Once both servers are running:

1. Open `http://localhost:3000`
2. Click `Start Training`
3. Allow camera access when prompted
4. Place an orange, banana, or foam pad in view
5. Choose a calibration mode
6. Capture a frame with `Check My Step`
7. Review the returned overlays, observations, and coaching
8. Retry or advance through the stages
9. Open the review page at the end of the session

## 9. Quality Checks

### Frontend

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

### Backend

```bash
cd backend
source .venv/bin/activate
pytest
```

## 10. Troubleshooting

### The landing page loads but analysis returns `503`

Usually `AI_API_BASE_URL` is missing or empty in `backend/.env`.

Check the file and restart `uvicorn` after updating it.

### Analysis returns `502`

Common reasons:

- the upstream AI server is down
- the configured model is not vision-capable
- the model returned invalid or partial JSON
- the provider type was auto-detected incorrectly for a custom proxy

If you are using a custom Anthropic-compatible proxy, try setting:

```env
AI_PROVIDER=anthropic
```

### The review page shows local history but fallback debrief text

This means the review page loaded the session correctly, but fresh debrief generation was unavailable or invalid. The app now falls back to a deterministic study summary so the flow still works.

### The review page says no local session found

The review page depends on browser `localStorage`.

Use the same:

- browser profile
- machine
- localStorage state

that created the session during training.

### Port `3000` or `8000` is already in use

Run the service on a different port and update the dependent environment variable.

Example backend:

```bash
uvicorn app.main:app --reload --port 8001
```

Then update:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

### `npm` or `node` is missing

Install a current Node.js release, then rerun `npm install` in `frontend/`.

## 11. Current Limitations

- one supported procedure
- browser-local persistence only
- no auth or multi-user storage
- simulation-only educational framing
- live analysis quality depends on image quality and model choice
