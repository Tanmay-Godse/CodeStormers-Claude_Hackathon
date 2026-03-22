# Frontend

This package contains the Next.js frontend for the AI Clinical Skills Coach trainer and review flow.

## Responsibilities

- landing page and entry flow
- student and admin login screens with SQLite-backed account creation
- trainer page with camera access and frame capture
- calibration UI and overlay rendering
- stage-by-stage feedback display
- browser-local session persistence
- review page hydration and debrief caching
- admin review queue for human validation
- equity mode for multilingual feedback, audio coaching, low-bandwidth capture, cheap-phone compatibility, and offline-first practice logging
- open learning-library page for public rubric and benchmark assets

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

`npm run dev` uses a Webpack-backed Next.js dev server in this workspace because it has been more stable locally than Turbopack during iterative development.

## Useful Commands

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1
```

This should point at the FastAPI backend, not directly at your model server.

## Routes

- `/`: landing page and project framing
- `/login`: workspace account sign-in and create-account flow for students and admin reviewers
- `/library`: open learning-library page for rubric and benchmark assets
- `/admin/reviews`: human-in-the-loop validation queue
- `/train/[procedure]`: live trainer flow with capture, analyze, stage progression, and review handoff
- `/review/[sessionId]`: session summary, cached or fresh debrief, and per-attempt history

## Local Session Model

The frontend stores training history in browser `localStorage`.

Account records are not stored in the frontend anymore. Account preview, create-account, and sign-in go through the backend SQLite database, while the signed-in user snapshot is still cached locally for convenience.

What is stored:

- active session id per procedure
- local auth user for the selected role
- calibration state
- equity-mode settings per session
- per-stage attempt history
- offline-only practice logs
- score deltas and coaching text
- cached debrief output keyed by a review signature

How debrief caching works:

- the review page can render immediately from local session history
- if a matching cached debrief exists, it is reused
- if the session changed, a fresh debrief request is sent
- if the backend returns fallback debrief content, that response is cached like any other valid debrief

## API Integration Notes

- the frontend only talks to the FastAPI backend
- the browser never sends Anthropic or OpenAI-compatible API keys directly
- account preview, create-account, and sign-in requests go through the backend and persist in SQLite
- analyze requests are only sent on `Check My Step`
- the trainer sends `simulation_confirmation` before analysis
- the trainer can send `feedback_language` and `equity_mode` for multilingual and lower-resource coaching
- blocked or low-confidence responses can surface `review_case_id` values from the backend queue
- the review page debrief request is driven from stored session events
- the review page can play read-aloud coaching when equity mode audio is enabled and browser speech synthesis is available

## Common Issues

### No local session found

The review page depends on the same browser profile and local machine that created the session.

### Procedure load fails

Check that `NEXT_PUBLIC_API_BASE_URL` points at a running backend and that `/api/v1/health` succeeds.

### Login or account creation fails

Check that the backend is running. Workspace account preview, creation, and sign-in now require the FastAPI backend because accounts persist in SQLite.

### Review text looks stale

The cached debrief is invalidated automatically when the session event history changes. If you want to reset everything, start a fresh session from the trainer UI.

### Frontend dev mode throws bundler or manifest errors

This repo already defaults `npm run dev` to `next dev --webpack`.

If the dev server still gets into a bad state, stop it and start it again:

```bash
npm run dev
```

### I want to test offline-first practice logging

Enable equity mode in the trainer, turn on `Offline-first practice logging`, then disconnect the network before pressing `Check My Step`. The attempt will be saved locally and displayed on the review page even without a live analysis response.

For full project setup, use `../docs/local-setup.md`.
