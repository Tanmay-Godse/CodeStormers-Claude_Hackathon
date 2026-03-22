# How To Run Locally

This quickstart shows how to run AI Clinical Skills Coach on Windows, Ubuntu, and macOS.

The local vLLM examples in this repo assume:

- vLLM runs on `http://localhost:8000`
- the FastAPI backend runs on `http://localhost:8001`
- the Next.js frontend runs on `http://localhost:3000`
- the local model is `chaitnya26/Qwen2.5-Omni-3B-Fork`

With local vLLM, you will usually need 3 terminals:

1. model server
2. backend
3. frontend

If you use a hosted OpenAI-compatible vision endpoint such as Z.AI instead, you only need 2 terminals:

1. backend
2. frontend

## Before You Start

Install these tools first:

- Git
- Node.js `20+`
- npm `10+`
- Python `3.10+`
- vLLM only if you plan to use the local model-server path
If you prefer `micromamba` for the backend, you can use it instead of `venv`. The app works fine with separate environments for vLLM and FastAPI.

If you use local vLLM, verify the model server manually with the same bearer key the backend uses:

```bash
curl -H 'Authorization: Bearer EMPTY' http://localhost:8000/v1/models
```

## Hosted Alternative: Z.AI

If you want shared hosted inference instead of running vLLM on one laptop, configure the backend like this and skip the model-server terminal:

```env
AI_PROVIDER=auto
AI_API_BASE_URL=https://api.z.ai/api/paas/v4
AI_API_KEY=SET_IN_ENV_MANAGER
AI_ANALYSIS_MODEL=glm-4.6v-flash
AI_DEBRIEF_MODEL=glm-4.6v-flash
AI_COACH_MODEL=glm-4.6v-flash
```

This is a good fit for image analysis, typed coach turns, and debrief generation. Voice transcription can stay separate for now.

Recommended open-repo secret handling:

```bash
micromamba env config vars set -n hackathon AI_API_KEY='your_real_key_here'
micromamba deactivate
micromamba activate hackathon
```

Keep `backend/.env` on a placeholder value such as `AI_API_KEY=SET_IN_ENV_MANAGER`.

### Hosted Z.AI Quickstart

If you are using Z.AI instead of local vLLM, the shortest path is:

1. Copy `backend/.env.example` to `backend/.env`.
2. Set:

```env
AI_PROVIDER=auto
AI_API_BASE_URL=https://api.z.ai/api/paas/v4
AI_API_KEY=SET_IN_ENV_MANAGER
AI_ANALYSIS_MODEL=glm-4.6v-flash
AI_DEBRIEF_MODEL=glm-4.6v-flash
AI_COACH_MODEL=glm-4.6v-flash
```

3. Inject the real `AI_API_KEY` through your shell or micromamba env.
4. Start the backend.
5. Start the frontend.

This path uses 2 terminals, not 3.

## Windows

These commands use PowerShell.

### Terminal 1: Start the model server

```powershell
vllm serve chaitnya26/Qwen2.5-Omni-3B-Fork --port 8000 --api-key EMPTY
```

### Terminal 2: Start the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8001
```

The backend env should point to the local model server:

```env
AI_API_BASE_URL=http://localhost:8000/v1
AI_ANALYSIS_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
AI_DEBRIEF_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
```

### Terminal 3: Start the frontend

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

`npm run dev` is already configured to use a Webpack-backed Next.js dev server in this workspace.

The frontend env should point to the backend:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

### Open the app

Visit:

```text
http://localhost:3000
```

### Quick verification

```powershell
curl.exe -H "Authorization: Bearer EMPTY" http://localhost:8000/v1/models
curl.exe http://localhost:8001/api/v1/health
curl.exe http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

## Ubuntu

These commands use the default terminal and `bash`.

### Terminal 1: Start the model server

```bash
vllm serve chaitnya26/Qwen2.5-Omni-3B-Fork --port 8000 --api-key EMPTY
```

### Terminal 2: Start the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

### Terminal 3: Start the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

`npm run dev` is already configured to use a Webpack-backed Next.js dev server in this workspace.

### Open the app

Visit:

```text
http://localhost:3000
```

### Quick verification

```bash
curl -H 'Authorization: Bearer EMPTY' http://localhost:8000/v1/models
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

## macOS

These commands work in Terminal with `zsh` or `bash`.

### Terminal 1: Start the model server

```bash
vllm serve chaitnya26/Qwen2.5-Omni-3B-Fork --port 8000 --api-key EMPTY
```

### Terminal 2: Start the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

### Terminal 3: Start the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

`npm run dev` is already configured to use a Webpack-backed Next.js dev server in this workspace.

### Open the app

Visit:

```text
http://localhost:3000
```

### Quick verification

```bash
curl -H 'Authorization: Bearer EMPTY' http://localhost:8000/v1/models
curl http://localhost:8001/api/v1/health
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

## Optional: Backend With Micromamba

If you want to use `micromamba` instead of `venv` for the backend:

```bash
cd backend
micromamba create -n clinical-coach python=3.10 -y
micromamba activate clinical-coach
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

## Need More Detail?

Use these docs next:

- `docs/local-setup.md` for the full setup and troubleshooting flow
- `docs/team-setup.md` for collaborator setup and open-repo secret handling
- `docs/api-reference.md` for backend routes and request/response examples
- `backend/README.md` for backend-only setup notes
- `frontend/README.md` for frontend-only setup notes
