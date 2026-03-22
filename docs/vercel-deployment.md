# Vercel Deployment

This repo is best deployed with:

- `frontend` on `Vercel`
- `backend` on a separate persistent Python host

## Why This Split

The frontend is a standard Next.js app and fits Vercel well.

The backend currently:

- stores auth and quota state in SQLite
- keeps human-review queue state
- handles longer AI and transcription calls
- expects a single explicit `FRONTEND_ORIGIN` value for CORS

Because of that, a separate persistent backend host is the safer demo choice.

## Deploy The Frontend To Vercel

In Vercel:

1. Import the GitHub repository.
2. Set the project root directory to `frontend`.
3. Keep the framework as `Next.js`.
4. Add the frontend environment variable:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.example.com/api/v1
```

5. Deploy.

## Deploy The Backend Separately

Use any persistent Python host that can keep `backend/app/data/auth.db` across restarts.

Minimum backend environment:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
SIMULATION_ONLY=true

AI_PROVIDER=anthropic
AI_API_BASE_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=SET_IN_ENV_MANAGER
AI_ANALYSIS_MODEL=claude-sonnet-4-6
AI_DEBRIEF_MODEL=claude-sonnet-4-6
AI_COACH_MODEL=claude-sonnet-4-6
AI_LEARNING_MODEL=claude-haiku-4-5

TRANSCRIPTION_API_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=SET_IN_ENV_MANAGER
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Vercel Preview Caveat

The backend currently allows one exact frontend origin.

For the cleanest hackathon deployment:

- use one stable Vercel production URL
- point `FRONTEND_ORIGIN` at that exact domain

If you want preview URLs to work too, you will need to widen backend CORS
behavior in code.

## Public Demo Login Notes

The deployed login page intentionally shows only the four public judge accounts.

That is by design:

- fixed public student accounts reduce API abuse
- each one has `10` live sessions
- unknown usernames are routed to `/access-required`
- quota resets are reserved for admin and developer accounts

## Post-Deploy Smoke Checklist

1. Open `/login`.
2. Sign in with one judge account.
3. Confirm `/dashboard`, `/library`, and `/knowledge` load.
4. Start a live session and confirm the backend receives analysis calls.
5. Confirm the backend `FRONTEND_ORIGIN` matches the deployed frontend URL exactly.
