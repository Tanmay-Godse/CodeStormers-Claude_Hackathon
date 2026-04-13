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
micromamba run -n <your env> pip install -r requirements.txt
cp .env.example .env
micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001
```

Testing:

```bash
micromamba run -n <your env> pytest
```

Focused runs used most often:

```bash
micromamba run -n <your env> pytest tests/test_services.py tests/test_api.py -q
```

## Runtime Notes

- persistent runtime data lives under `backend/app/data`
- public student demo accounts are seeded from code and normal self-service accounts are also supported
- usernames are normalized to lowercase and remain globally unique across self-service and seeded accounts
- optional private admin and developer accounts come from `PRIVATE_SEED_ACCOUNTS_JSON`
- the backend should run on a persistent host in production, not Vercel serverless
- Anthropic and OpenAI secrets belong on the backend only; use [../docs/cloud-keys.md](../docs/cloud-keys.md) for the exact setup steps
- `GET /health` exposes AI and transcription readiness for the trainer setup tab
- `POST /transcription/test` is the backend speech-diagnostic endpoint used by the trainer setup flow

## Main Route Groups

- `health`
- `procedures`
- `auth`
- `learning-state`
- `analyze-frame`
- `coach-chat`
- `debrief`
- `knowledge-pack`
- `transcription`
- `tts`
- `review-cases`

## Read Next

- [../docs/local-setup.md](../docs/local-setup.md)
- [../docs/backend-deployment.md](../docs/backend-deployment.md)
- [../docs/api-reference.md](../docs/api-reference.md)
