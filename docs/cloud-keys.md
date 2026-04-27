# Cloud AI Keys

Use this guide when a teammate needs to add their own Anthropic or OpenAI key
without reusing someone else's secret.

## The Safe Rule

- Anthropic and OpenAI secrets belong on the backend only
- the frontend never talks directly to Anthropic or OpenAI
- `backend/.env` is the local file for backend secrets, and it is kept out of Git
- `frontend/.env.local` should only hold frontend config such as the backend API
  base URL, never provider keys
- each collaborator should use their own local keys, or a shared team-managed
  secret manager for a shared deployment
- never paste real keys into Git, docs, screenshots, chat messages, or PRs

If you are unsure where a key should go, the answer is almost always
`backend/.env` locally or the backend host's environment manager in deployment.

## What Each Key Does

Main AI provider for analysis, coaching, debriefs, and Knowledge Lab:

- `AI_PROVIDER`
- `AI_API_BASE_URL`
- `AI_API_KEY`
- `AI_ANALYSIS_MODEL`
- `AI_DEBRIEF_MODEL`
- `AI_COACH_MODEL`
- `AI_LEARNING_MODEL`

Learner voice transcription:

- `TRANSCRIPTION_API_BASE_URL`
- `TRANSCRIPTION_API_KEY`
- `TRANSCRIPTION_MODEL`

Recommended naming rule:

- use the generic `AI_*` variables for the main provider
- use the generic `TRANSCRIPTION_*` variables for transcription
- do not mix `AI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` in the
  same setup unless you are intentionally debugging alias behavior

## Local Setup

1. Copy the backend example file:

```bash
cd backend
cp .env.example .env
```

2. Keep non-secret local defaults such as:

```env
FRONTEND_ORIGIN=http://localhost:3000
SIMULATION_ONLY=true
```

3. Choose one main AI provider setup below.
4. Add your real key values only in your own `backend/.env` or exported shell
   environment.
5. Restart the backend after every key change.

If you use micromamba, activate it before launching the backend:

```bash
micromamba activate <your env>
cd backend
micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001
```

If you already activated `<your env>` in your shell, the same Uvicorn command
works without the `micromamba run -n <your env>` prefix. The docs keep the
prefix so setup stays explicit and consistent.

## Option A: Anthropic Main AI Plus OpenAI Transcription

Use this if you want a cloud-first backend instead of the local-vLLM default
documented in [how-to-run.md](how-to-run.md).

1. Create your own Anthropic API key in your Anthropic account.
2. Create your own OpenAI API key in your OpenAI account.
3. Put them into `backend/.env` like this:

```env
AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=YOUR_ANTHROPIC_KEY
AI_ANALYSIS_MODEL=claude-sonnet-4-6
AI_DEBRIEF_MODEL=claude-sonnet-4-6
AI_COACH_MODEL=claude-sonnet-4-6
AI_LEARNING_MODEL=claude-haiku-4-5

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=YOUR_OPENAI_KEY
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

4. Start the backend:

```bash
cd backend
micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001
```

Use this option if you want Anthropic to be the primary model provider.

## Option B: OpenAI Main AI Plus OpenAI Transcription

Use this if your team wants OpenAI for the main AI stack as well.

1. Create your own OpenAI API key.
2. Choose an OpenAI chat-completions model that your account can access and
   that supports image input plus JSON output for the main AI routes.
3. Put the values into `backend/.env` like this:

```env
AI_PROVIDER=openai
AI_API_BASE_URL=https://api.openai.com/v1
AI_API_KEY=YOUR_OPENAI_KEY
AI_ANALYSIS_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_DEBRIEF_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_COACH_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_LEARNING_MODEL=YOUR_OPENAI_MAIN_MODEL_ID

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=YOUR_OPENAI_KEY
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

4. Start the backend:

```bash
cd backend
micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001
```

If your team standardizes on a different OpenAI model per feature, replace the
four `AI_*_MODEL` values individually.

## Shell Export Alternative

If you want to keep placeholder values inside `backend/.env`, export secrets in
your terminal before launching the backend:

```bash
export AI_API_KEY='YOUR_REAL_MAIN_PROVIDER_KEY'
export TRANSCRIPTION_API_KEY='YOUR_REAL_OPENAI_KEY'
cd backend
micromamba run -n <your env> uvicorn app.main:app --reload --reload-dir app --port 8001
```

For most local setups, editing `backend/.env` is simpler than exporting
secrets. Real keys in `backend/.env` take priority over stale shell-exported
values, while placeholder values still let shell exports work.

This works well when:

- your local `backend/.env` is shared across several team members' machines as a
  copied template
- you do not want secrets saved in a local file
- you switch between personal and team-managed credentials

## Deployment Setup

For any shared hosted environment:

1. Add secrets to the backend host only.
2. Do not add Anthropic or OpenAI keys to the Vercel frontend project.
3. Set the backend environment variables in the host dashboard or secret
   manager.
4. Restart or redeploy the backend.
5. Set only `API_BASE_URL` on the frontend deployment.

Recommended backend deployment pattern:

- `frontend` on Vercel
- `backend` on a persistent Python host
- Anthropic/OpenAI secrets stored in the backend host secret manager

Example backend host variables for Anthropic main AI:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
SIMULATION_ONLY=true

AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=SET_IN_BACKEND_HOST_SECRET_MANAGER
AI_ANALYSIS_MODEL=claude-sonnet-4-6
AI_DEBRIEF_MODEL=claude-sonnet-4-6
AI_COACH_MODEL=claude-sonnet-4-6
AI_LEARNING_MODEL=claude-haiku-4-5

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=SET_IN_BACKEND_HOST_SECRET_MANAGER
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

Example Vercel frontend variable:

```env
API_BASE_URL=https://your-backend.example.com/api/v1
```

## Shared-Team Guidance

- never send your personal key to another teammate
- if the team needs one shared deployed backend, store those secrets in the host
  environment manager and grant teammates access to the host, not to raw keys in
  chat
- if a key is ever pasted into a public place, rotate it immediately
- keep `backend/.env` untracked and local to each developer

## Accepted Env Aliases

The backend accepts provider-specific aliases from
[backend/app/core/config.py](../backend/app/core/config.py), but the docs use
the generic names above to keep setup predictable.

Main provider aliases:

- `AI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Transcription aliases:

- `TRANSCRIPTION_API_KEY`
- `OPENAI_TRANSCRIPTION_API_KEY`
- `OPENAI_API_KEY`

Recommendation:

- use `AI_API_KEY` for the main provider
- use `TRANSCRIPTION_API_KEY` for transcription

## If You Must Use Provider-Specific Key Names

Some hosts or teammates already use provider-specific secret names. The backend
accepts them, but the generic names above are still easier to reason about.

Anthropic main provider with alias naming:

```env
AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
OPENAI_TRANSCRIPTION_API_KEY=YOUR_OPENAI_KEY
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

OpenAI main provider with alias naming:

```env
AI_PROVIDER=openai
AI_API_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=YOUR_OPENAI_KEY
AI_ANALYSIS_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_DEBRIEF_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_COACH_MODEL=YOUR_OPENAI_MAIN_MODEL_ID
AI_LEARNING_MODEL=YOUR_OPENAI_MAIN_MODEL_ID

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
OPENAI_TRANSCRIPTION_API_KEY=YOUR_OPENAI_KEY
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Troubleshooting

- `invalid x-api-key` when live preview starts:
  your Anthropic `AI_API_KEY` is invalid, revoked, or pasted into the wrong
  variable.
- `AI_API_KEY is still set to a placeholder value`:
  you left `SET_IN_ENV_MANAGER` or another placeholder in place.
- `TRANSCRIPTION_API_KEY is not configured`:
  the OpenAI transcription key is missing.
- OpenAI-compatible requests fail before the model answers:
  `AI_API_BASE_URL` is wrong or the selected model does not support the request
  shape.
- The frontend loads but AI still fails:
  you probably updated the wrong environment, or the backend has not been
  restarted yet.
