# Vercel Deployment

This document covers the recommended hosted shape for the `frontend`.

## Recommended Split

- deploy `frontend` on `Vercel`
- deploy `backend` on a separate persistent Python host

Why this split is recommended:

- the frontend is a standard Next.js app and fits Vercel well
- the backend owns SQLite auth, quota, and learning-state persistence
- the backend owns review queue persistence
- the backend handles longer AI and transcription calls
- the backend currently expects one explicit `FRONTEND_ORIGIN` value for CORS

For backend-specific deployment steps, use
[backend-deployment.md](backend-deployment.md).

## Vercel Project Settings

In Vercel:

1. Import the GitHub repository.
2. Set the project root directory to `frontend`.
3. Keep the framework preset as `Next.js`.
4. Add the production environment variable below.
5. Deploy.

Required frontend environment variable:

```env
API_BASE_URL=https://your-backend.example.com/api/v1
```

The production app proxies browser requests through `/api/proxy/*`, so
`API_BASE_URL` stays server-side in Vercel and is not exposed to the public
client bundle.

Do not add `AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`TRANSCRIPTION_API_KEY` to the frontend Vercel project. Those secrets belong to
the backend only. Use [cloud-keys.md](cloud-keys.md) for the exact backend key
setup.

## Backend Alignment

Your backend must separately allow the deployed frontend origin:

```env
FRONTEND_ORIGIN=https://your-project.vercel.app
```

If the backend origin does not match the deployed frontend exactly, the frontend
will load but API calls will fail.

## Preview Deployment Caveat

The backend currently allows one exact frontend origin.

That means:

- one stable Vercel production URL is the safest demo setup
- Vercel preview URLs will not work automatically unless backend CORS is widened in code

## Public Demo Notes

The deployed login page supports normal self-service signup and sign-in.

The seeded public judge accounts are still useful for a controlled demo:

- fixed public student accounts reduce API abuse during judging
- each account has `10` live sessions
- quota resets are reserved for admin and developer accounts
- preview-only camera start does not consume quota; the first real non-setup
  graded step does
- new admin reviewer accounts still require developer approval before they can use `/admin/reviews`

## Post-Deploy Smoke Checklist

1. Open `/login`.
2. Create a normal student account or sign in with one judge account.
3. Confirm `/dashboard`, `/knowledge`, and `/library` load.
4. Open `/train/simple-interrupted-suture` and confirm the `Setup` tab loads its preflight checks.
5. Run `Check Audio` and confirm browser/backend speech diagnostics appear as expected for that environment.
6. Run `Check My Step` once on `Setup` and confirm it stays local and finishes quickly.
7. Start preview and run the first real non-setup `Check My Step`, then confirm analysis requests reach the backend and quota updates there.
8. Confirm `FRONTEND_ORIGIN` matches the deployed frontend URL exactly.

## Related Docs

- [cloud-keys.md](cloud-keys.md)
- [backend-deployment.md](backend-deployment.md)
- [team-setup.md](team-setup.md)
- [local-setup.md](local-setup.md)
