# Clinical Curator AI

Clinical Curator AI is a simulation-only clinical skills trainer built around a
live suturing demo. Learners practice on safe surfaces such as an orange,
banana, or foam pad while the system handles camera-based feedback, voice
coaching, debriefs, review tickets, and short knowledge rounds.

## Current Demo Shape

- `/dashboard`: main starting point
- `/train/simple-interrupted-suture`: live trainer
- `/review/[sessionId]`: debrief and replay
- `/knowledge`: rapidfire, quiz, and flashcards
- `/library`: procedure guide and practice references
- `/admin/reviews`: human review queue
- `/developer/approvals`: developer-only approval queue

## Stack

- `frontend`: Next.js 16
- `backend`: FastAPI
- `analysis / coach / debrief`: `claude-sonnet-4-6`
- `knowledge packs`: `claude-haiku-4-5`
- `speech-to-text`: `gpt-4o-mini-transcribe`
- `speech output`: browser speech synthesis first, backend TTS fallback
- `auth persistence`: SQLite in the backend
- `session history`: browser `localStorage`

## Public Demo Accounts

The public login flow is fixed-account-only so the deployed demo does not allow
unlimited self-service usage.

Judge accounts shown on the login page:

- `Student_1@gmail.com`
- `Student_2@gmail.com`
- `Student_3@gmail.com`
- `Student_4@gmail.com`
- password for all four: `CODESTORMERS`

Rules:

- each public student account has `10` live sessions
- the live-session limit is consumed when a camera run starts
- learners cannot reset that limit themselves
- only admin or developer accounts can reset demo account limits
- unknown usernames route to `/access-required` with a contact-the-developers message

Private team admin and developer accounts are seeded in the backend for internal
operations, but they are intentionally not listed on the public login page or in
public docs.

## Deployment Shape

This repo is set up to deploy the `frontend` on `Vercel` and keep the FastAPI
backend on a separate persistent Python host.

Why:

- the frontend is a normal Next.js app and works well on Vercel
- the backend owns SQLite auth data, review queue state, and longer AI calls
- the backend CORS setting currently expects one explicit frontend origin

Read the deployment guide here:

- [docs/vercel-deployment.md](docs/vercel-deployment.md)

## Local Run

Start with:

- [docs/how-to-run.md](docs/how-to-run.md) for the fastest local setup
- [docs/local-setup.md](docs/local-setup.md) for the fuller development guide

## Repository Layout

```text
.
|-- backend/       FastAPI API, AI transport, scoring, review queue, auth, and tests
|-- docs/          setup, API, and deployment docs
|-- frontend/      Next.js dashboard, trainer, knowledge, library, profile, and review UI
`-- open-library/  procedure rubric and benchmark reference assets
```

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

## Documentation

- [docs/how-to-run.md](docs/how-to-run.md)
- [docs/local-setup.md](docs/local-setup.md)
- [docs/vercel-deployment.md](docs/vercel-deployment.md)
- [docs/api-reference.md](docs/api-reference.md)
- [docs/team-setup.md](docs/team-setup.md)
- [backend/README.md](backend/README.md)
- [frontend/README.md](frontend/README.md)
