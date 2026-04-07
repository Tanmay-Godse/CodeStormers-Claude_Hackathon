# Clinical Curator AI

Clinical Curator AI is a simulation-only clinical skills trainer designed for
safe, guided procedural practice. Learners work on surfaces such as an orange,
banana, or foam pad while the system delivers camera-based feedback, live voice
coaching, review debriefs, human-review escalation, and short knowledge rounds.

This project was built as a hackathon-ready demo, but the product direction is
clear: make procedural training more accessible, more repeatable, and more
supportive for learners practicing outside a high-resource lab.

## What The Demo Does

- live trainer with camera-based step checking
- voice-guided coaching during practice
- review and debrief workflow after each run
- Knowledge Lab with rapidfire, quiz, and flashcards
- admin review queue for low-confidence or escalated cases
- self-service accounts plus quota-managed public demo accounts for judging

## Core Experience

1. Sign in or create an account.
2. Start a live session from the dashboard.
3. Practice on a safe simulated surface.
4. Receive coaching and step-level feedback during the run.
5. Open the generated review and debrief.
6. Reinforce weak spots through the Knowledge Lab and procedure library.

## Why It Feels Different

- simulation-only by design, with safe surfaces built into the flow
- combines live feedback, reflection, and follow-up learning in one system
- supports low-bandwidth and offline-friendly practice patterns
- supports self-service accounts while keeping seeded demo accounts for controlled judging

## Stack

- `frontend`: Next.js 16
- `backend`: FastAPI
- `analysis / coach / debrief / knowledge`: Anthropic by default, with OpenAI-compatible provider support
- `speech-to-text`: OpenAI `gpt-4o-mini-transcribe`
- `speech output`: browser speech first, backend TTS fallback
- `auth, quota, and learning-state persistence`: SQLite in the backend
- `client cache and offline logs`: browser `localStorage`

## Architecture

```text
Learner Browser
   -> Next.js frontend
   -> FastAPI backend
   -> AI providers + persistent runtime data
```

Recommended hosted shape:

- `frontend` on Vercel
- `backend` on a separate persistent Python host

## Quick Start

If you want the app running quickly:

- [docs/how-to-run.md](docs/how-to-run.md)

If you want the full developer setup and architecture notes:

- [docs/local-setup.md](docs/local-setup.md)

If you are preparing deployment:

- [docs/vercel-deployment.md](docs/vercel-deployment.md)
- [docs/backend-deployment.md](docs/backend-deployment.md)

## Repository Layout

```text
.
|-- backend/       FastAPI API, auth, scoring, AI transport, review queue, tests
|-- docs/          setup, deployment, team process, and API documentation
|-- frontend/      Next.js UI for trainer, dashboard, review, knowledge, and profile
`-- open-library/  rubric and benchmark reference assets
```

## Documentation

- [docs/README.md](docs/README.md): documentation hub
- [docs/how-to-run.md](docs/how-to-run.md): fastest local run path
- [docs/cloud-keys.md](docs/cloud-keys.md): exact Anthropic and OpenAI key setup steps
- [docs/local-setup.md](docs/local-setup.md): full local development guide
- [docs/api-reference.md](docs/api-reference.md): backend route reference
- [docs/team-setup.md](docs/team-setup.md): secret handling and release hygiene
- [backend/README.md](backend/README.md): backend package guide
- [frontend/README.md](frontend/README.md): frontend package guide

## Verification

```bash
cd frontend
npm run lint
npm run typecheck
npm run build

cd ../backend
source .venv/bin/activate
pytest
```

## Public Demo Notes

The public demo still includes fixed student accounts with limited live-session
access so judging stays stable and usage stays controlled, but self-service
accounts are also enabled. The detailed login flow, demo behavior, and setup
notes live in [docs/how-to-run.md](docs/how-to-run.md).
