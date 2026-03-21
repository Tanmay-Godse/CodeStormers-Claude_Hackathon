# How To Run Locally

This quickstart shows how to run AI Clinical Skills Coach on Windows, Ubuntu, and macOS.

All examples in this repo assume:

- vLLM runs on `http://localhost:8000`
- the FastAPI backend runs on `http://localhost:8001`
- the Next.js frontend runs on `http://localhost:3000`
- the local model is `chaitnya26/Qwen2.5-Omni-3B-Fork`

You will usually need 3 terminals:

1. model server
2. backend
3. frontend

## Before You Start

Install these tools first:

- Git
- Node.js `20+`
- npm `10+`
- Python `3.10+`
- vLLM in the environment where you serve the model

If you prefer `micromamba` for the backend, you can use it instead of `venv`. The app works fine with separate environments for vLLM and FastAPI.

To verify the local model server manually, include the same bearer key the backend uses:

```bash
curl -H 'Authorization: Bearer EMPTY' http://localhost:8000/v1/models
```

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
- `docs/api-reference.md` for backend routes and request/response examples
- `backend/README.md` for backend-only setup notes
- `frontend/README.md` for frontend-only setup notes
