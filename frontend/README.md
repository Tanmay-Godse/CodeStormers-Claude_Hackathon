# Frontend

This package contains the Next.js frontend for the AI Clinical Skills Coach trainer and review flow.

## Responsibilities

- landing page and entry flow
- trainer page with camera access and frame capture
- calibration UI and overlay rendering
- stage-by-stage feedback display
- browser-local session persistence
- review page hydration and debrief caching

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

## Useful Commands

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

This should point at the FastAPI backend, not directly at your model server.

## Routes

- `/`: landing page and project framing
- `/train/[procedure]`: live trainer flow with capture, analyze, stage progression, and review handoff
- `/review/[sessionId]`: session summary, cached or fresh debrief, and per-attempt history

## Local Session Model

The frontend stores training history in browser `localStorage`.

What is stored:

- active session id per procedure
- calibration state
- per-stage attempt history
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
- analyze requests are only sent on `Check My Step`
- the review page debrief request is driven from stored session events

## Common Issues

### No local session found

The review page depends on the same browser profile and local machine that created the session.

### Procedure load fails

Check that `NEXT_PUBLIC_API_BASE_URL` points at a running backend and that `/api/v1/health` succeeds.

### Review text looks stale

The cached debrief is invalidated automatically when the session event history changes. If you want to reset everything, start a fresh session from the trainer UI.

For full project setup, use `../docs/local-setup.md`.
