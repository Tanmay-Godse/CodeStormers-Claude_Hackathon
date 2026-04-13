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
- setup preflight with camera, mic, browser STT, and backend transcription checks
- voice-guided coaching during practice
- review and debrief workflow after each run
- Knowledge Lab with rapidfire, quiz, and flashcards
- admin review queue for low-confidence or escalated cases
- self-service accounts plus quota-managed public demo accounts for judging

## Core Experience

1. Sign in or create an account.
2. Start a live session from the dashboard.
3. Use the `Setup` tab to verify camera, mic, speech, and backend readiness.
4. Practice on a safe simulated surface and use `Check My Step` when the frame is ready.
5. Receive coaching and step-level feedback during the run.
6. Open the generated review and debrief.
7. Reinforce weak spots through the Knowledge Lab and procedure library.

## Why It Feels Different

- simulation-only by design, with safe surfaces built into the flow
- combines live feedback, reflection, and follow-up learning in one system
- supports low-bandwidth and offline-friendly practice patterns
- supports self-service accounts while keeping seeded demo accounts for controlled judging
- can compare browser speech recognition with backend transcription before the coached loop starts

## Stack

- `frontend`: Next.js 16
- `backend`: FastAPI
- `analysis / coach / debrief / knowledge`: Anthropic by default, with OpenAI-compatible provider support
- `speech-to-text`: browser STT first in the trainer, with OpenAI `gpt-4o-mini-transcribe` backend transcription available for fallback and diagnostics
- `speech output`: browser speech first, backend TTS fallback (`edge-tts`, then `pyttsx3`)
- `auth, quota, and learning-state persistence`: SQLite in the backend
- `client cache and offline logs`: browser `localStorage`

## Architecture

```text
Learner Browser
   -> Next.js frontend
   -> FastAPI backend
   -> AI providers + persistent runtime data
```

## Quick Start

If you want the app running quickly:

- [docs/how-to-run.md](docs/how-to-run.md)

If you want the full developer setup and architecture notes:

- [docs/local-setup.md](docs/local-setup.md)
- [docs/project-index.md](docs/project-index.md)

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
- [docs/project-index.md](docs/project-index.md): deep codebase map and ownership guide
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
micromamba run -n <your env> pytest
```

## Public Demo Notes

The public demo still includes fixed student accounts with limited live-session
access so judging stays stable and usage stays controlled, but self-service
accounts are also enabled. The detailed login flow, seeded student accounts,
current `2-minute` trainer window, setup/audio checks, and smoke flow live in
[docs/how-to-run.md](docs/how-to-run.md).
