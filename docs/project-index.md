# Deep Project Index

Last indexed: 2026-03-31

This document is a code-oriented map of the Clinical Curator AI repository.
It is meant to answer two questions quickly:

1. What exists in this repository?
2. Where does each important behavior live?

## Repo Snapshot

- Product: simulation-only clinical skills trainer focused on simple interrupted suturing practice
- Primary packages: `frontend` (Next.js 16), `backend` (FastAPI), `docs`, `open-library`
- Main experience areas: login, dashboard, live trainer, review/debrief, Knowledge Lab, library, profile, admin queue, developer approvals
- Runtime persistence: SQLite for auth and synced learning state, JSON file for human review queue, browser `localStorage` for cache and offline-first state
- AI surfaces:
  - analysis, coach, debrief, knowledge: Anthropic by default or any OpenAI-compatible endpoint
  - transcription: OpenAI-compatible speech-to-text
  - TTS fallback: Edge TTS, then `pyttsx3`
- Indexed code size:
  - `backend/app`: 47 files
  - `frontend/app` + `frontend/components` + `frontend/lib`: 33 files
  - `docs` + `open-library`: 13 files
  - Total indexed lines across major source/docs folders: about 25.9k

## Top-Level Layout

```text
.
|-- backend/       FastAPI API, AI routing, auth, persistence, tests
|-- docs/          setup, deployment, API reference, project index
|-- frontend/      Next.js app router UI, shared components, browser storage
`-- open-library/  rubric and benchmark reference assets
```

## Architecture At A Glance

```text
Browser
  -> Next.js frontend
     -> localStorage cache, offline logs, session/debrief cache
     -> /api/proxy/* in production
  -> FastAPI backend (/api/v1)
     -> auth.db
     -> learning_state.db
     -> review_cases.json
     -> procedure JSON
     -> AI providers
        -> Anthropic messages API
        -> OpenAI-compatible chat/transcription endpoints
```

### Main runtime loop

1. A learner signs in or creates an account.
2. The trainer loads the suturing procedure and restores the active session.
3. Starting the camera consumes one live-session allowance.
4. `analyze-frame` runs a safety gate first, then stage analysis, scoring, and optional human-review escalation.
5. `coach-chat` drives the voice loop, optionally transcribing learner audio first.
6. The review page generates or reuses a debrief, derives learner-profile patterns, and shows any review cases.
7. Knowledge Lab generates study packs from the same procedure and learner context.
8. Admins resolve flagged review cases; the fixed developer account approves admin access requests.

## What The Repo Is Optimized For

- Safe demo access through self-service signup plus seeded demo accounts for judging
- One polished end-to-end procedure rather than a broad procedure catalog
- Simulation-only enforcement before image-guided coaching
- Offline-friendly practice logging and browser-first recovery
- Human review escalation when the model is unclear, unsafe, or low-confidence
- Hackathon-friendly hosting with Vercel frontend plus persistent Python backend

## Top-Level File Ownership

| Area | Purpose | Start Here |
| --- | --- | --- |
| Product overview | What the app is and how it is positioned | [../README.md](../README.md) |
| Run locally fast | Fastest developer/judge startup path | [how-to-run.md](how-to-run.md) |
| Full dev setup | Canonical local behavior, persistence, troubleshooting | [local-setup.md](local-setup.md) |
| Backend API | Route-level payload reference | [api-reference.md](api-reference.md) |
| Backend package guide | Backend commands and responsibilities | [../backend/README.md](../backend/README.md) |
| Frontend package guide | Frontend commands and responsibilities | [../frontend/README.md](../frontend/README.md) |
| Rubric assets | Procedure/rubric reference data | [../open-library/README.md](../open-library/README.md) |

## Backend Index

### Backend entrypoints

| Path | Role |
| --- | --- |
| [../backend/main.py](../backend/main.py) | Thin launch shim for the backend package |
| [../backend/app/main.py](../backend/app/main.py) | FastAPI app bootstrap, CORS, router registration |
| [../backend/requirements.txt](../backend/requirements.txt) | Python runtime and test dependencies |
| [../backend/.env.example](../backend/.env.example) | Canonical backend env shape and provider examples |
| [../backend/Dockerfile](../backend/Dockerfile) | Containerization entrypoint for backend deployment |

### Backend folder map

| Folder | Purpose |
| --- | --- |
| [../backend/app/api](../backend/app/api) | HTTP route layer |
| [../backend/app/core](../backend/app/core) | Settings, provider selection, runtime storage paths |
| [../backend/app/providers](../backend/app/providers) | Anthropic and OpenAI-compatible transport adapters |
| [../backend/app/procedures](../backend/app/procedures) | Bundled runtime procedure definitions |
| [../backend/app/schemas](../backend/app/schemas) | Pydantic request/response models |
| [../backend/app/services](../backend/app/services) | All application behavior and persistence logic |
| [../backend/tests](../backend/tests) | API, service, config, and live smoke tests |

### API routes

All routes mount under `/api/v1`.

| Route module | Endpoints | Responsibility |
| --- | --- | --- |
| [../backend/app/api/routes/health.py](../backend/app/api/routes/health.py) | `GET /health` | Reachability and simulation-only status |
| [../backend/app/api/routes/procedures.py](../backend/app/api/routes/procedures.py) | `GET /procedures/{procedure_id}` | Procedure metadata delivery |
| [../backend/app/api/routes/auth.py](../backend/app/api/routes/auth.py) | Preview, create account, sign-in, admin approvals, quota reset, live-session consume | Self-service and seeded account auth workflow |
| [../backend/app/api/routes/analyze.py](../backend/app/api/routes/analyze.py) | `POST /analyze-frame` | Stage analysis entrypoint |
| [../backend/app/api/routes/coach.py](../backend/app/api/routes/coach.py) | `POST /coach-chat` | Voice/text coaching entrypoint |
| [../backend/app/api/routes/debrief.py](../backend/app/api/routes/debrief.py) | `POST /debrief` | Session review synthesis |
| [../backend/app/api/routes/knowledge.py](../backend/app/api/routes/knowledge.py) | `POST /knowledge-pack` | Study-pack generation |
| [../backend/app/api/routes/learning_state.py](../backend/app/api/routes/learning_state.py) | `GET /learning-state`, session upsert, knowledge-progress upsert | Synced cross-device learner state |
| [../backend/app/api/routes/review_cases.py](../backend/app/api/routes/review_cases.py) | List and resolve review cases | Human review queue |
| [../backend/app/api/routes/tts.py](../backend/app/api/routes/tts.py) | `POST /tts` | Backend speech synthesis fallback |

### Core backend infrastructure

| Path | Role |
| --- | --- |
| [../backend/app/core/config.py](../backend/app/core/config.py) | Pydantic settings, env aliases, secret preference rules, model IDs, thresholds |
| [../backend/app/core/provider_factory.py](../backend/app/core/provider_factory.py) | Chooses Anthropic vs OpenAI-compatible provider from config/base URL |
| [../backend/app/core/storage_paths.py](../backend/app/core/storage_paths.py) | Resolves persistent runtime data paths and Vercel `/tmp` fallback |

### Backend providers

| Path | Role |
| --- | --- |
| [../backend/app/providers/base.py](../backend/app/providers/base.py) | Shared exceptions, placeholder-key detection, JSON provider protocol |
| [../backend/app/providers/anthropic.py](../backend/app/providers/anthropic.py) | Anthropic messages API adapter with schema/tool extraction |
| [../backend/app/providers/openai_compatible.py](../backend/app/providers/openai_compatible.py) | Chat-completions adapter with payload fallbacks for provider quirks |

### Backend services

| Path | Role |
| --- | --- |
| [../backend/app/services/ai_client.py](../backend/app/services/ai_client.py) | Common JSON-message send path used by analysis/coach/debrief/knowledge/safety |
| [../backend/app/services/procedure_loader.py](../backend/app/services/procedure_loader.py) | Loads procedure JSON and resolves stages |
| [../backend/app/services/safety_service.py](../backend/app/services/safety_service.py) | Blocks or escalates suspected real-clinical scenes before coaching |
| [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py) | Runs safety gate, stage analysis, grading decision, scoring, review escalation |
| [../backend/app/services/scoring_service.py](../backend/app/services/scoring_service.py) | Validates overlay targets and computes score deltas from severity/status |
| [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py) | Handles voice/text coach turns, transcription normalization, safety-aware fallback |
| [../backend/app/services/transcription_service.py](../backend/app/services/transcription_service.py) | Sends learner audio to OpenAI-compatible transcription endpoint |
| [../backend/app/services/tts_service.py](../backend/app/services/tts_service.py) | Synthesizes spoken coaching with browser fallback support on the frontend |
| [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py) | Generates session recap, strengths, improvement areas, drill, equity plan, quiz |
| [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py) | Builds Knowledge Lab packs, plus substantial local fallback content |
| [../backend/app/services/review_queue_service.py](../backend/app/services/review_queue_service.py) | Persists human review queue to JSON and resolves reviewer outcomes |
| [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) | Self-service and seeded auth, password hashing, session tokens, admin approval workflow, quota management |
| [../backend/app/services/learning_state_service.py](../backend/app/services/learning_state_service.py) | SQLite sync for saved sessions, active-session pointers, and knowledge progress |

### Important backend behaviors

#### 1. Safety-first analysis

- `analysis_service.analyze_frame_payload()` loads the procedure/stage, runs `safety_service.evaluate_safety_gate()`, and only then asks the main model for stage analysis.
- Blocked safety outcomes can create a human review case through `review_queue_service.create_review_case()`.
- Setup has a special fast-pass rule: if the setup frame clearly shows an approved inert surface, the service upgrades setup to `pass` even if the raw model said `retry`.
- Grading is separate from step status:
  - `unclear` is always not graded
  - low-confidence outputs can be not graded even if the model gave a coaching label
- Human review is triggered for:
  - `unclear` or `unsafe`
  - confidence below threshold
  - high-severity issues

#### 2. Voice coach loop support

- `coach_service.generate_coach_turn()` can transcribe audio first and append it into the chat history.
- It reuses the safety gate when an image is present.
- If transcription fails for a spoken turn, the service returns a blocked coaching response rather than crashing the loop.
- The coach prompt is optimized for short spoken turns, avoiding repetitive lectures.

#### 3. Auth model

- Public demo accounts are hardcoded in `auth_service.PUBLIC_DEMO_ACCOUNTS`.
- Self-service student account creation is enabled.
- Admin reviewer requests are created as student accounts first with pending developer approval.
- Optional private admin/developer accounts come from `PRIVATE_SEED_ACCOUNTS_JSON`.
- Passwords are stored with PBKDF2-SHA256 and per-account salts.
- Session tokens are stored in SQLite and issued on sign-in.
- Live-session quotas are tracked per seeded public/admin account.

#### 4. Synced learning state

- `learning_state_service` stores:
  - session payloads
  - active session per procedure
  - knowledge-progress counters
- Upserts are timestamp-aware: older session payloads do not overwrite newer ones.
- The backend normalizes `ownerUsername` to the authenticated account before storing.

### Backend schemas

| Path | Main model family |
| --- | --- |
| [../backend/app/schemas/analyze.py](../backend/app/schemas/analyze.py) | Frame analysis requests, issues, safety gate, analysis response |
| [../backend/app/schemas/auth.py](../backend/app/schemas/auth.py) | Auth previews, sign-in/update/reset payloads |
| [../backend/app/schemas/coach.py](../backend/app/schemas/coach.py) | Coach chat history, request, response |
| [../backend/app/schemas/debrief.py](../backend/app/schemas/debrief.py) | Debrief events, drill, error fingerprint, review response |
| [../backend/app/schemas/knowledge.py](../backend/app/schemas/knowledge.py) | MCQs, flashcards, topic suggestions, study pack |
| [../backend/app/schemas/learning_state.py](../backend/app/schemas/learning_state.py) | Learning-state sync payloads |
| [../backend/app/schemas/procedure.py](../backend/app/schemas/procedure.py) | Procedure/stage/overlay structure |
| [../backend/app/schemas/review.py](../backend/app/schemas/review.py) | Human review case and resolution payloads |
| [../backend/app/schemas/tts.py](../backend/app/schemas/tts.py) | Speech synthesis request |

### Backend data files

| Path | Owned by | Purpose |
| --- | --- | --- |
| [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json) | Backend runtime | Canonical procedure definition served to the app |
| `backend/app/data/auth.db` | `auth_service` | Accounts, password state, roles, quotas, session tokens |
| `backend/app/data/learning_state.db` | `learning_state_service` | Synced sessions, active-session map, Knowledge Lab progress |
| `backend/app/data/review_cases.json` | `review_queue_service` | Human review queue and reviewer resolutions |

## Frontend Index

### Frontend entrypoints

| Path | Role |
| --- | --- |
| [../frontend/package.json](../frontend/package.json) | Scripts and JS dependency manifest |
| [../frontend/next.config.ts](../frontend/next.config.ts) | Next.js config |
| [../frontend/.env.local.example](../frontend/.env.local.example) | Frontend env shape |
| [../frontend/app/layout.tsx](../frontend/app/layout.tsx) | Root layout, fonts, metadata |
| [../frontend/app/globals.css](../frontend/app/globals.css) | Entire visual system and page styling |

### Frontend routes

| Route | File | Responsibility |
| --- | --- | --- |
| `/` | [../frontend/app/page.tsx](../frontend/app/page.tsx) | Redirect to dashboard |
| `/login` | [../frontend/app/login/page.tsx](../frontend/app/login/page.tsx) | Sign-in and create-account flow with role-aware routing |
| `/access-required` | [../frontend/app/access-required/page.tsx](../frontend/app/access-required/page.tsx) | Legacy fallback route kept for older links |
| `/dashboard` | [../frontend/app/dashboard/page.tsx](../frontend/app/dashboard/page.tsx) | Gamified learner summary, missions, achievements, recent session links |
| `/train/[procedure]` | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) | Live trainer, camera loop, analysis loop, voice coach loop, session persistence |
| `/review/[sessionId]` | [../frontend/app/review/[sessionId]/page.tsx](../frontend/app/review/[sessionId]/page.tsx) | Session recap, debrief hydration/cache, review-case visibility |
| `/knowledge` | [../frontend/app/knowledge/page.tsx](../frontend/app/knowledge/page.tsx) | Gamified study modes, rapidfire/quiz/flashcards, progress persistence |
| `/library` | [../frontend/app/library/page.tsx](../frontend/app/library/page.tsx) | Procedure and rubric walkthrough, fallback procedure copy |
| `/profile` | [../frontend/app/profile/page.tsx](../frontend/app/profile/page.tsx) | Account profile updates and demo quota reset UI for admins/developers |
| `/admin/reviews` | [../frontend/app/admin/reviews/page.tsx](../frontend/app/admin/reviews/page.tsx) | Human review queue and resolution form |
| `/developer/approvals` | [../frontend/app/developer/approvals/page.tsx](../frontend/app/developer/approvals/page.tsx) | Developer-only admin-approval queue |
| `/api/proxy/[...path]` | [../frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts) | Production backend proxy for deployed frontend |

### Shared frontend components

| Path | Role |
| --- | --- |
| [../frontend/components/AppFrame.tsx](../frontend/components/AppFrame.tsx) | Shared shell, sidebar, top bar, footer actions |
| [../frontend/components/CameraFeed.tsx](../frontend/components/CameraFeed.tsx) | Camera lifecycle, frame capture, device-state normalization |
| [../frontend/components/FeedbackCard.tsx](../frontend/components/FeedbackCard.tsx) | Renders analysis results and optional spoken coaching |
| [../frontend/components/ProcedureStepper.tsx](../frontend/components/ProcedureStepper.tsx) | Stage list, attempts, latest status, advance control |
| [../frontend/components/VoiceCoachPanel.tsx](../frontend/components/VoiceCoachPanel.tsx) | Voice-coach transcript, stage plan, voice selection |
| [../frontend/components/ReviewSummary.tsx](../frontend/components/ReviewSummary.tsx) | Review/debrief surface and learner-profile display |
| [../frontend/components/HomeSystemStatus.tsx](../frontend/components/HomeSystemStatus.tsx) | Frontend-side health and procedure availability check |
| [../frontend/components/CalibrationOverlay.tsx](../frontend/components/CalibrationOverlay.tsx) | Manual corner/guide calibration UI |
| [../frontend/components/OverlayRenderer.tsx](../frontend/components/OverlayRenderer.tsx) | Projects overlay targets into the visible frame |
| [../frontend/components/DashboardIcon.tsx](../frontend/components/DashboardIcon.tsx) | SVG icon set for the app shell |

### Frontend libraries

| Path | Role |
| --- | --- |
| [../frontend/lib/types.ts](../frontend/lib/types.ts) | Shared frontend data model contract |
| [../frontend/lib/api.ts](../frontend/lib/api.ts) | All backend fetch wrappers and response mapping |
| [../frontend/lib/storage.ts](../frontend/lib/storage.ts) | Local session/auth/cache persistence plus backend sync orchestration |
| [../frontend/lib/useWorkspaceUser.ts](../frontend/lib/useWorkspaceUser.ts) | Reactive auth/session store over browser storage |
| [../frontend/lib/audio.ts](../frontend/lib/audio.ts) | Browser speech, backend TTS fallback, microphone recording, WAV encoding |
| [../frontend/lib/learnerProfile.ts](../frontend/lib/learnerProfile.ts) | Derived recurring issues and local adaptive drills |
| [../frontend/lib/equity.ts](../frontend/lib/equity.ts) | Feedback-language labels and API equity-mode mapping |
| [../frontend/lib/geometry.ts](../frontend/lib/geometry.ts) | Guide-frame geometry and overlay projection |
| [../frontend/lib/appShell.ts](../frontend/lib/appShell.ts) | Shared nav/top-item generation |

### Important frontend behaviors

#### 1. Live trainer page

`frontend/app/train/[procedure]/page.tsx` is the single densest frontend file and owns:

- auth gate and procedure/session hydration
- camera lifecycle
- 2-minute hackathon camera window
- live-session allowance consumption
- auto-analysis for setup after camera start
- offline-first analysis fallback logging
- stage progression and review navigation
- hands-free voice coach loop with microphone recording and speech playback
- session persistence back into browser storage and synced backend state

If you change the main learner experience, start there.

#### 2. Browser storage ownership

`frontend/lib/storage.ts` owns the browser-side data model:

- auth user cache
- session list and active session pointers
- debrief cache keyed by session signature
- knowledge-progress cache
- migration when a username changes
- sync merge with backend learning-state snapshots

This file is effectively the frontend persistence layer.

#### 3. Review/debrief pipeline

`frontend/app/review/[sessionId]/page.tsx`:

- loads the owned session
- derives learner-profile context across same-procedure sessions
- reuses cached debriefs when the session signature matches
- requests a debrief only when needed
- stores the returned debrief back into the session cache
- loads human-review cases linked to that session

#### 4. Knowledge Lab pipeline

`frontend/app/knowledge/page.tsx`:

- derives recent issues from saved sessions
- requests study packs from the backend
- falls back to default topic suggestions when needed
- tracks rapidfire, quiz, and flashcard progress locally and via backend sync

## Procedure And Rubric Assets

| Path | Role |
| --- | --- |
| [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json) | Runtime procedure used by the app |
| [../open-library/rubrics/simple-interrupted-suture.json](../open-library/rubrics/simple-interrupted-suture.json) | Reference rubric asset in the open library |
| [../open-library/rubrics/rubric-template.json](../open-library/rubrics/rubric-template.json) | Template for future procedure rubrics |
| [../open-library/benchmark/simulation_benchmark_manifest.csv](../open-library/benchmark/simulation_benchmark_manifest.csv) | Benchmark manifest stub/reference |

The repo currently centers the product around one procedure, but it already has a clear pattern for adding more.

## Persistence And State Ownership

### Backend-owned state

- Auth account records
- Password hash/salt state
- Session tokens
- Admin approval state
- Live-session quotas
- Synced session history
- Active session pointers per procedure
- Knowledge Lab progress
- Human review queue

### Browser-owned state

- Fast hydration cache for sessions
- Cached debrief payloads
- Offline practice logs
- Locally derived learner-profile views
- Workspace change events for reactive UI updates

### Sync model

- The frontend can operate from browser cache first.
- The backend is the durable source for cross-browser session history and knowledge progress.
- Review content is cached locally by session signature to avoid unnecessary regeneration.
- Offline analysis attempts are logged locally when connectivity drops and can still appear in review history.

## Configuration Index

### Backend environment groups

Defined and normalized in [../backend/app/core/config.py](../backend/app/core/config.py), with examples in [../backend/.env.example](../backend/.env.example).

| Group | Examples |
| --- | --- |
| App/cors | `FRONTEND_ORIGIN`, `SIMULATION_ONLY` |
| Main AI provider | `AI_PROVIDER`, `AI_API_BASE_URL`, `AI_API_KEY` |
| Main model IDs | `AI_ANALYSIS_MODEL`, `AI_DEBRIEF_MODEL`, `AI_COACH_MODEL`, `AI_LEARNING_MODEL` |
| Request tuning | `AI_TIMEOUT_SECONDS`, token limits, confidence thresholds |
| Anthropic-specific | `ANTHROPIC_VERSION` |
| Transcription | `TRANSCRIPTION_API_BASE_URL`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL` |
| Private seeding | `PRIVATE_SEED_ACCOUNTS_JSON` |

### Frontend environment groups

Defined in [../frontend/.env.local.example](../frontend/.env.local.example) and [../frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts).

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Local-development direct backend base URL |
| `API_BASE_URL` | Hosted frontend server-side proxy target |

## Test Index

| Path | What it covers |
| --- | --- |
| [../backend/tests/test_api.py](../backend/tests/test_api.py) | Route behavior, seeded auth, quota reset, major API responses |
| [../backend/tests/test_services.py](../backend/tests/test_services.py) | Service fallbacks, validation, setup acceptance, debrief behavior |
| [../backend/tests/test_ai_client.py](../backend/tests/test_ai_client.py) | Provider payload conversion and transport fallback behavior |
| [../backend/tests/test_config.py](../backend/tests/test_config.py) | Config precedence and secret-selection rules |
| [../backend/tests/test_live_vllm_smoke.py](../backend/tests/test_live_vllm_smoke.py) | Optional live smoke tests against a running backend and vLLM server |

## Where To Change Things

| If you want to change... | Start here |
| --- | --- |
| Login/account behavior | [../frontend/app/login/page.tsx](../frontend/app/login/page.tsx), [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) |
| Public demo accounts or quotas | [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) |
| Main trainer workflow | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) |
| Analysis prompt or scoring rules | [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py), [../backend/app/services/scoring_service.py](../backend/app/services/scoring_service.py) |
| Safety behavior | [../backend/app/services/safety_service.py](../backend/app/services/safety_service.py) |
| Voice coaching behavior | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx), [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py), [../frontend/lib/audio.ts](../frontend/lib/audio.ts) |
| Debrief content | [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py), [../frontend/components/ReviewSummary.tsx](../frontend/components/ReviewSummary.tsx) |
| Knowledge Lab content | [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py), [../frontend/app/knowledge/page.tsx](../frontend/app/knowledge/page.tsx) |
| Human review queue | [../backend/app/services/review_queue_service.py](../backend/app/services/review_queue_service.py), [../frontend/app/admin/reviews/page.tsx](../frontend/app/admin/reviews/page.tsx) |
| Developer approval workflow | [../frontend/app/developer/approvals/page.tsx](../frontend/app/developer/approvals/page.tsx), [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) |
| Procedure content or overlays | [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json), [../frontend/app/library/page.tsx](../frontend/app/library/page.tsx) |
| Browser persistence or rehydration | [../frontend/lib/storage.ts](../frontend/lib/storage.ts), [../frontend/lib/useWorkspaceUser.ts](../frontend/lib/useWorkspaceUser.ts) |
| Deployment wiring | [backend-deployment.md](backend-deployment.md), [vercel-deployment.md](vercel-deployment.md), [../frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts) |

## Suggested Reading Order For New Contributors

1. [../README.md](../README.md)
2. [project-index.md](project-index.md)
3. [how-to-run.md](how-to-run.md)
4. [local-setup.md](local-setup.md)
5. [api-reference.md](api-reference.md)
6. Then jump into either:
   - [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) for product flow
   - [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py) for AI behavior
   - [../frontend/lib/storage.ts](../frontend/lib/storage.ts) for persistence behavior

## Summary

This repo is not a generic full-stack starter. It is a tightly scoped, demo-safe training product with:

- one main procedure
- a deliberate safety gate before image coaching
- mixed self-service plus seeded-account access control
- browser-plus-backend dual persistence
- a human-review loop
- a clear expansion path for more procedures and richer study content

That makes the most important files disproportionately concentrated in:

- [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx)
- [../frontend/lib/storage.ts](../frontend/lib/storage.ts)
- [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py)
- [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py)
- [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py)
- [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py)
- [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py)
