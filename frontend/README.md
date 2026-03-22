# Frontend

This package contains the Next.js frontend for Clinical Curator AI.

## Responsibilities

- shared app shell and navigation
- login and access-required flows
- student dashboard
- live trainer UI
- review page and debrief rendering
- Knowledge Lab
- library guide
- profile page
- admin review queue
- developer approval queue
- browser-local session history and cached learning state

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

This must point at the FastAPI backend, not directly at Anthropic or OpenAI.

## Routes

- `/` redirects to `/dashboard`
- `/login`
- `/access-required`
- `/dashboard`
- `/train/[procedure]`
- `/review/[sessionId]`
- `/knowledge`
- `/library`
- `/profile`
- `/admin/reviews`
- `/developer/approvals`

## Auth Model

The public demo is fixed-account-only.

What the login page supports:

- username lookup
- sign-in to seeded demo accounts
- live-session remaining counts
- routing unknown usernames to `/access-required`

What it does not support:

- open public signup
- user-created admin accounts from the UI

## Local Storage Model

The frontend stores:

- active live session id per procedure
- session history and attempt events
- cached debrief responses
- knowledge progress, rating, and points
- signed-in user snapshot for convenience

The backend still owns the real auth account record, session token, and live-session quota.

## Vercel Deployment

This frontend is intended to deploy from the `frontend` directory on Vercel.

Required project setting:

- root directory: `frontend`

Required env:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.example.com/api/v1
```

The backend must separately allow the Vercel frontend origin through `FRONTEND_ORIGIN`.

## Useful Commands

```bash
npm run lint
npm run typecheck
npm run build
```

## Common Issues

### The login page cannot find an account

That is expected for unknown usernames in the public demo. The app redirects
those users to `/access-required`.

### The trainer cannot call the backend after deployment

Check both:

- `NEXT_PUBLIC_API_BASE_URL`
- backend `FRONTEND_ORIGIN`

### A review page cannot find a session

Review history is browser-local. Open it from the same browser profile that ran
the session.

For full app setup, see [../docs/local-setup.md](../docs/local-setup.md).
