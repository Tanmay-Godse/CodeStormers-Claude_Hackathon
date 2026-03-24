# Documentation Guide

Use this folder as the documentation entry point for the repo.

## Start With

- [how-to-run.md](how-to-run.md): quickest way to run the demo locally
- [cloud-keys.md](cloud-keys.md): exact Anthropic and OpenAI key setup for local and deployed backends
- [local-setup.md](local-setup.md): full developer setup, architecture, persistence, and troubleshooting
- [team-setup.md](team-setup.md): collaboration rules, secret handling, and push checklist

## Deployment Docs

- [vercel-deployment.md](vercel-deployment.md): deploy the `frontend` on Vercel
- [backend-deployment.md](backend-deployment.md): deploy the FastAPI backend on a persistent host

## Reference Docs

- [api-reference.md](api-reference.md): backend route and payload reference
- [../backend/README.md](../backend/README.md): backend package overview and commands
- [../frontend/README.md](../frontend/README.md): frontend package overview and commands

## Recommended Reading Order

1. Read [../README.md](../README.md) for the product overview.
2. Use [how-to-run.md](how-to-run.md) if you just want the app running fast.
3. Use [cloud-keys.md](cloud-keys.md) before adding Anthropic or OpenAI secrets.
4. Use [local-setup.md](local-setup.md) if you are developing features or debugging behavior.
5. Use [team-setup.md](team-setup.md) before pushing, deploying, or sharing credentials.
6. Use the deployment docs only when you are preparing hosted environments.

## Which Doc Owns What

- `README.md`: high-level repo overview and quick links
- `docs/how-to-run.md`: fastest local startup path
- `docs/cloud-keys.md`: canonical cloud-key setup for Anthropic and OpenAI
- `docs/local-setup.md`: canonical local-development guide
- `docs/team-setup.md`: public-vs-private rules and team workflow
- `docs/vercel-deployment.md`: frontend deployment steps and backend wiring
- `docs/backend-deployment.md`: backend hosting, persistence, and runtime config
- `docs/api-reference.md`: route-level backend reference

## Notes

- Keep secrets out of tracked files.
- Keep backend runtime state out of Git.
- Prefer linking to the canonical doc for a topic instead of duplicating the same instructions in multiple places.
