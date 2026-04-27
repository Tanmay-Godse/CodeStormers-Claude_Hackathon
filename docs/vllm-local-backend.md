# vLLM Local Backend With Micromamba

This guide explains the generic local pattern for running the FastAPI backend
against a local vLLM server with micromamba-managed environments.

Use this when you want:

- a local OpenAI-compatible model server instead of a cloud-first backend
- a clean split between your app environment and your model-serving environment
- reproducible local testing for the live trainer

## Recommended Shape

The cleanest local setup uses two micromamba environments:

- `<backend-env>`: FastAPI app, tests, and local backend utilities
- `<vllm-env>`: vLLM, CUDA-compatible serving stack, and model-download tools

You can also use a single environment if you prefer, but the split keeps model
serving dependencies isolated from day-to-day backend work.

## Prerequisites

- `micromamba`
- Python `3.10+`
- an NVIDIA GPU that vLLM supports on your machine
- current GPU drivers and CUDA runtime for your chosen vLLM build
- enough VRAM for the model you plan to serve
- optional Hugging Face access token if you need gated or rate-limited downloads

## Install The Environments

Create the environments if you do not already have them:

```bash
micromamba create -n <backend-env> python=3.10 -y
micromamba create -n <vllm-env> python=3.10 -y
```

Install the repo backend dependencies:

```bash
cd backend
micromamba run -n <backend-env> pip install -r requirements.txt
```

Install the local-serving tools in the vLLM environment:

```bash
micromamba run -n <vllm-env> pip install vllm==0.17.0 huggingface_hub==0.36.2
```

If you prefer one shared environment, installing `backend/requirements.txt`
already pulls in the same pinned `vllm` and `huggingface_hub` versions.

## Pick A Model

Good starting points for this repo:

| Use case | Suggested model | Notes |
| --- | --- | --- |
| Lowest-friction vision checks | `Qwen/Qwen2.5-VL-3B-Instruct` | Best first local model for the trainer |
| Higher-quality vision checks | `Qwen/Qwen2.5-VL-7B-Instruct` | Better accuracy, more VRAM pressure |
| Text-only experiments | `Qwen/Qwen2.5-3B-Instruct` | Useful for non-vision debrief or chat experiments |

The live trainer currently benefits most from a vision-language model, so start
with a VL model before trying a text-only model.

## Download A Model

You can either let vLLM download from Hugging Face on first launch, or
pre-download the model yourself.

Optional login for gated downloads:

```bash
micromamba run -n <vllm-env> huggingface-cli login
```

Optional pre-download:

```bash
micromamba run -n <vllm-env> huggingface-cli download \
  Qwen/Qwen2.5-VL-3B-Instruct \
  --local-dir <model-dir>/Qwen2.5-VL-3B-Instruct
```

Model weights are not Python packages, so they are documented here rather than
being added to `requirements.txt`.

## Start The Local vLLM Server

Serve by model id:

```bash
micromamba run -n <vllm-env> vllm serve \
  Qwen/Qwen2.5-VL-3B-Instruct \
  --served-model-name Qwen/Qwen2.5-VL-3B-Instruct \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key <shared-local-key> \
  --gpu-memory-utilization 0.85 \
  --max-model-len 4096 \
  --limit-mm-per-prompt '{"image":1}'
```

If you already pre-downloaded the model, replace the model id with the local
path to that snapshot or directory.

Notes:

- keep `--served-model-name` aligned with the model id you want the backend to request
- keep `--api-key` aligned with the backend `AI_API_KEY`
- keep `--limit-mm-per-prompt '{"image":1}'` for the current trainer flow, which sends one image per analysis request

## Point The Backend At Local vLLM

In `backend/.env`, use an OpenAI-compatible primary provider:

```env
AI_PROVIDER=openai
AI_API_BASE_URL=http://127.0.0.1:8000/v1
AI_API_KEY=<shared-local-key>

AI_ANALYSIS_MODEL=Qwen/Qwen2.5-VL-3B-Instruct
AI_COACH_MODEL=Qwen/Qwen2.5-VL-3B-Instruct
AI_DEBRIEF_MODEL=Qwen/Qwen2.5-VL-3B-Instruct
AI_LEARNING_MODEL=Qwen/Qwen2.5-VL-3B-Instruct
```

Optional cloud fallback:

```env
AI_FALLBACK_PROVIDER=anthropic
AI_FALLBACK_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_FALLBACK_API_KEY=<optional-anthropic-key>
AI_FALLBACK_ANALYSIS_MODEL=claude-sonnet-4-6
AI_FALLBACK_COACH_MODEL=claude-sonnet-4-6
AI_FALLBACK_DEBRIEF_MODEL=claude-sonnet-4-6
AI_FALLBACK_LEARNING_MODEL=claude-haiku-4-5
```

For a local-vLLM-only run, leave `AI_FALLBACK_API_KEY` as `EMPTY` or
`SET_IN_ENV_MANAGER`. The fallback key is intentionally separate from
`AI_API_KEY`, so the local vLLM bearer token does not silently enable Anthropic
fallback.

Local browser/backend alignment:

```env
FRONTEND_ORIGIN=http://127.0.0.1:3000
```

If you are also running the frontend in this repo, set:

```env
# frontend/.env.local
API_BASE_URL=http://127.0.0.1:8001/api/v1
```

## Start The Backend

```bash
cd backend
micromamba run -n <backend-env> uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8001
```

## Verify The Stack

Check the model server:

```bash
curl -H "Authorization: Bearer <shared-local-key>" http://127.0.0.1:8000/v1/models
```

Check backend health:

```bash
curl http://127.0.0.1:8001/api/v1/health
```

Optional repo smoke test:

```bash
LIVE_BACKEND_BASE_URL=http://127.0.0.1:8001/api/v1 \
LIVE_VLLM_BASE_URL=http://127.0.0.1:8000 \
LIVE_VLLM_API_KEY=<shared-local-key> \
micromamba run -n <backend-env> pytest backend/tests/test_live_vllm_smoke.py -q -s
```

## Troubleshooting

- `401 Unauthorized` from vLLM:
  `AI_API_KEY` in the backend does not match the `--api-key` used when starting vLLM.
- Frontend login or trainer calls fail from `127.0.0.1`:
  keep the frontend on the repo proxy path and set `API_BASE_URL` in
  `frontend/.env.local` so the browser does not bypass the frontend server.
- vLLM starts but requests stall or OOM:
  lower `--gpu-memory-utilization`, use a smaller model, or reduce the model
  context/window settings.
- The backend stays `ai_ready=false`:
  verify `AI_PROVIDER`, `AI_API_BASE_URL`, `AI_API_KEY`, and the selected
  `AI_*_MODEL` values.
- Anthropic fallback never engages:
  verify the `AI_FALLBACK_*` values are set and the fallback API key is real.
- Local-vLLM-only mode still tries Anthropic:
  clear `AI_FALLBACK_API_KEY` and any exported `ANTHROPIC_API_KEY`, then restart
  the backend.
- Model download fails:
  log in with `huggingface-cli login`, confirm network access, and make sure the
  model id is spelled exactly as published on Hugging Face.

## Related Docs

- [how-to-run.md](how-to-run.md)
- [local-setup.md](local-setup.md)
- [cloud-keys.md](cloud-keys.md)
- [../backend/README.md](../backend/README.md)
