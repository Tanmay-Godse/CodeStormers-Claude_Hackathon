# Backend

This package contains the FastAPI service for the AI Clinical Skills Coach backend.

## Responsibilities

- serve procedure metadata to the frontend
- validate analyze and debrief request payloads
- run a simulation-only safety gate before coaching
- route AI requests to either an OpenAI-compatible or Anthropic-style endpoint
- validate and normalize AI responses
- compute `score_delta` deterministically in Python
- honor multilingual and equity-mode debrief settings
- return stable fallback debrief content when the debrief AI path is unavailable
- persist a lightweight human-review queue for flagged sessions

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

## Environment Reference

Core settings:

```env
FRONTEND_ORIGIN=http://localhost:3000
SIMULATION_ONLY=true
AI_PROVIDER=auto
AI_API_BASE_URL=http://localhost:8000/v1
AI_API_KEY=EMPTY
AI_ANALYSIS_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
AI_DEBRIEF_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
AI_TIMEOUT_SECONDS=60
AI_ANALYSIS_MAX_TOKENS=1400
AI_DEBRIEF_MAX_TOKENS=1200
AI_SAFETY_MAX_TOKENS=600
HUMAN_REVIEW_CONFIDENCE_THRESHOLD=0.78
ANTHROPIC_VERSION=2023-06-01
```

What each setting does:

- `FRONTEND_ORIGIN`: allowed browser origin for CORS
- `SIMULATION_ONLY`: keeps the backend in training-only mode
- `AI_PROVIDER`: `auto`, `openai`, or `anthropic`
- `AI_API_BASE_URL`: base URL for the upstream AI endpoint
- `AI_API_KEY`: bearer key for OpenAI-compatible endpoints or key header for Anthropic
- `AI_ANALYSIS_MODEL`: model used by `/api/v1/analyze-frame`
- `AI_DEBRIEF_MODEL`: model used by `/api/v1/debrief`
- `AI_TIMEOUT_SECONDS`: outbound request timeout
- `AI_ANALYSIS_MAX_TOKENS`: max tokens for analysis responses
- `AI_DEBRIEF_MAX_TOKENS`: max tokens for debrief responses
- `AI_SAFETY_MAX_TOKENS`: max tokens for safety-gate classification
- `HUMAN_REVIEW_CONFIDENCE_THRESHOLD`: confidence cutoff for automatic human escalation
- `ANTHROPIC_VERSION`: only used for Anthropic-style requests

Backward compatibility:

- `OPENAI_*` and `ANTHROPIC_*` environment variables still work as aliases
- `AI_PROVIDER=auto` is the preferred default going forward

## Provider Auto-Detection

When `AI_PROVIDER=auto`, the backend uses these rules:

- if `AI_API_BASE_URL` points to `anthropic.com`, use Anthropic mode
- if `AI_API_BASE_URL` ends with `/messages`, use Anthropic mode
- otherwise, use OpenAI-compatible mode

Use an explicit `AI_PROVIDER` override if your proxy URL is ambiguous.

## Example Configurations

### OpenAI-Compatible or vLLM

```env
AI_PROVIDER=auto
AI_API_BASE_URL=http://localhost:8000/v1
AI_API_KEY=EMPTY
AI_ANALYSIS_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
AI_DEBRIEF_MODEL=chaitnya26/Qwen2.5-Omni-3B-Fork
```

Example local server:

```bash
vllm serve chaitnya26/Qwen2.5-Omni-3B-Fork --port 8000 --api-key EMPTY
```

The local docs assume vLLM stays on port `8000` and this FastAPI backend runs on port `8001`.
Use a vision-capable model for `AI_ANALYSIS_MODEL`. Text-only models will not work for the analyze route.

### Anthropic-Style

```env
AI_PROVIDER=auto
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=your_api_key_here
AI_ANALYSIS_MODEL=your_vision_capable_model
AI_DEBRIEF_MODEL=your_text_or_multimodal_model
ANTHROPIC_VERSION=2023-06-01
```

## Endpoints

- `GET /api/v1/health`
- `GET /api/v1/procedures/{id}`
- `POST /api/v1/analyze-frame`
- `POST /api/v1/debrief`
- `GET /api/v1/review-cases`
- `POST /api/v1/review-cases/{case_id}/resolve`

## Route Behavior

`POST /api/v1/analyze-frame`:

- returns `200` with validated analysis output
- may return `analysis_mode="blocked"` when the safety gate refuses the image
- accepts `feedback_language` and `equity_mode` so the AI can tailor coaching for lower-resource practice settings
- returns `404` for unknown procedures or stages
- returns `503` when live AI analysis is not configured
- returns `502` when the upstream AI request fails or returns invalid JSON

`POST /api/v1/debrief`:

- returns `200` for both AI-backed and fallback debriefs
- returns `feedback_language`, `equity_support_plan`, and `audio_script` in addition to the core study summary fields
- returns `404` for unknown procedures
- never requires the frontend to send provider-specific auth

## Testing

```bash
source .venv/bin/activate
pytest
```

The backend test suite covers:

- API status-code mapping
- provider auto-detection
- overlay-target validation
- fallback debrief behavior
- partial debrief backfilling
- localized fallback debrief behavior

For full app setup and troubleshooting, use `../docs/local-setup.md`.
