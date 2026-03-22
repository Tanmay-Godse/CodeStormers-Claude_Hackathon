# Backend

This package contains the FastAPI backend for Clinical Curator AI.

## Responsibilities

- serve procedure metadata
- run the simulation-only safety gate
- analyze captured frames with `claude-sonnet-4-6`
- generate live coach turns with `claude-sonnet-4-6`
- generate review debriefs with `claude-sonnet-4-6`
- generate Knowledge Lab packs with `claude-haiku-4-5`
- transcribe learner voice with `gpt-4o-mini-transcribe`
- generate fallback coach audio when browser speech is not used
- manage review tickets
- persist seeded accounts and live-session quotas in SQLite

## Local Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

## Recommended Environment

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

## Deployment Note

The current recommended deployment is:

- frontend on `Vercel`
- backend on a separate persistent Python host

Set backend CORS to the exact frontend URL:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
```

Because the backend stores auth and quota state in SQLite, it is better suited
to a persistent host than an ephemeral serverless setup.

## Seeded Account Model

The backend seeds:

- four public student demo accounts shown on `/login`
- private internal admin accounts for the team
- one private developer account for approvals

Public student behavior:

- shared public password is `CODESTORMERS`
- each student account has `10` live sessions
- admin and developer accounts can reset those limits

## Routes

- `GET /api/v1/health`
- `GET /api/v1/procedures/{id}`
- `GET /api/v1/auth/accounts/preview`
- `POST /api/v1/auth/sign-in`
- `POST /api/v1/auth/accounts` currently returns `403` in the public demo
- `PUT /api/v1/auth/accounts/{account_id}`
- `GET /api/v1/auth/demo-accounts`
- `POST /api/v1/auth/live-sessions/consume`
- `POST /api/v1/auth/accounts/{account_id}/reset-live-sessions`
- `GET /api/v1/auth/admin-requests`
- `POST /api/v1/auth/admin-requests/{account_id}/approve`
- `POST /api/v1/auth/admin-requests/{account_id}/reject`
- `POST /api/v1/knowledge-pack`
- `POST /api/v1/analyze-frame`
- `POST /api/v1/coach-chat`
- `POST /api/v1/tts`
- `POST /api/v1/debrief`
- `GET /api/v1/review-cases`
- `POST /api/v1/review-cases/{case_id}/resolve`

## Testing

```bash
source .venv/bin/activate
pytest
```

Focused runs used most often:

```bash
./.venv/bin/pytest tests/test_services.py tests/test_api.py -q
```

For full app setup, see [../docs/local-setup.md](../docs/local-setup.md).
