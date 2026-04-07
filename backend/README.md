# Backend

This package contains the FastAPI backend for Clinical Curator AI.

## Responsibilities

- serve procedure metadata
- run the simulation-only safety gate
- analyze captured frames
- generate live coach turns
- generate review debriefs
- generate Knowledge Lab packs
- transcribe learner voice
- generate fallback coach audio
- manage review tickets
- persist self-service accounts, seeded accounts, live-session quotas, and synced learning state in SQLite

## Local Commands

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

Testing:

```bash
source .venv/bin/activate
pytest
```

Focused runs used most often:

```bash
./.venv/bin/pytest tests/test_services.py tests/test_api.py -q
```

## Runtime Notes

- persistent runtime data lives under `backend/app/data`
- public student demo accounts are seeded from code and normal self-service accounts are also supported
- optional private admin and developer accounts come from `PRIVATE_SEED_ACCOUNTS_JSON`
- the backend should run on a persistent host in production, not Vercel serverless
- Anthropic and OpenAI secrets belong on the backend only; use [../docs/cloud-keys.md](../docs/cloud-keys.md) for the exact setup steps

## Main Route Groups

- `health`
- `procedures`
- `auth`
- `learning-state`
- `analyze-frame`
- `coach-chat`
- `debrief`
- `knowledge-pack`
- `tts`
- `review-cases`

## Read Next

- [../docs/local-setup.md](../docs/local-setup.md)
- [../docs/backend-deployment.md](../docs/backend-deployment.md)
- [../docs/api-reference.md](../docs/api-reference.md)
