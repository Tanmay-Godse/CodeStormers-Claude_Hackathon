# Deep Project Index

Last indexed: 2026-04-21

This document is a code-oriented map of the Clinical Curator AI repository.
It is meant to answer two questions quickly:

1. What exists in this repository?
2. Where does each important behavior live?

## Repo Snapshot

- Product: simulation-only clinical skills trainer focused on simple interrupted suturing practice
- Primary packages: `frontend` (Next.js 16), `backend` (FastAPI), `docs`, `open-library`
- Main experience areas: login, dashboard, live trainer, review/debrief, Knowledge Lab, library, profile, admin queue, developer approvals
- Runtime persistence: SQLite for auth and synced learning state, JSON for the human review queue, and browser `localStorage` for auth/session/debrief/knowledge cache. Backend runtime files are resolved through `runtime_data_path()`, which uses `backend/app/data` locally and `/tmp/clinical-curator-ai-data` on Vercel.
- AI surfaces:
  - analysis, coach, debrief, knowledge: shared JSON-message path over Anthropic or OpenAI-compatible endpoints
  - transcription: browser-first STT in the trainer, with OpenAI-compatible backend transcription for diagnostics and fallback
  - speech output fallback: browser speech first, then backend TTS via Edge TTS, then `pyttsx3`
- Indexed source size:
  - counts below exclude `backend/app/data/*`, `__pycache__/*`, and binary docs such as `.docx`
  - `backend/app`: 49 files / about 7.9k lines
  - `frontend/app` + `frontend/components` + `frontend/lib`: 33 files / about 20.6k lines
  - `docs` + `open-library`: 16 text assets / about 2.5k lines
  - Total indexed lines across major source/docs folders: about 31.0k

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
     -> localStorage auth/session/debrief/knowledge cache
     -> useWorkspaceUser hydration + sync store
     -> /api/proxy/* in production
  -> FastAPI backend (/api/v1)
     -> runtime_data_path(...)
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
2. The trainer loads the suturing procedure, restores the active session, and runs setup preflight checks.
3. `Check Audio` can test Browser STT and backend transcription before grading starts.
4. Setup checks and setup-only preview stay local and do not consume a counted live session; the live-session allowance is consumed when real non-setup training starts.
5. `analyze-frame` runs a safety gate first, then stage analysis, grading/scoring, and optional human-review escalation.
6. `coach-chat` drives the voice loop, optionally transcribing learner audio first and reusing the safety gate for frame-aware coaching.
7. The review page hydrates the owned session, derives learner-profile patterns, reuses or generates a debrief, and shows linked review cases.
8. Knowledge Lab generates fresh study packs from the same procedure, recent issues, and prior prompt history.
9. Admins resolve flagged review cases; the fixed developer account approves admin access requests.

## What The Repo Is Optimized For

- Safe demo access through self-service signup plus seeded demo accounts for judging
- One polished end-to-end procedure rather than a broad procedure catalog
- Local setup verification and speech diagnostics before counted live coaching starts
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

Additional support docs currently present but not part of the main contributor path:

- [project-demo-report.md](project-demo-report.md)
- [static-accounts-local.md](static-accounts-local.md)

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
| [../backend/app/api/routes/health.py](../backend/app/api/routes/health.py) | `GET /health` | Reachability, simulation-only status, AI readiness, transcription readiness |
| [../backend/app/api/routes/procedures.py](../backend/app/api/routes/procedures.py) | `GET /procedures/{procedure_id}` | Procedure metadata delivery |
| [../backend/app/api/routes/auth.py](../backend/app/api/routes/auth.py) | `GET /auth/session`, self-preview, create/sign-in/update account, admin-request approve/reject/list, demo-account list, live-session consume/reset | Self-service auth, session refresh, developer approvals, and demo quota management |
| [../backend/app/api/routes/analyze.py](../backend/app/api/routes/analyze.py) | `POST /analyze-frame` | Stage analysis entrypoint |
| [../backend/app/api/routes/coach.py](../backend/app/api/routes/coach.py) | `POST /coach-chat` | Voice/text coaching entrypoint |
| [../backend/app/api/routes/transcription.py](../backend/app/api/routes/transcription.py) | `POST /transcription/test` | Backend speech-diagnostic endpoint for trainer setup |
| [../backend/app/api/routes/debrief.py](../backend/app/api/routes/debrief.py) | `POST /debrief` | Session review synthesis |
| [../backend/app/api/routes/knowledge.py](../backend/app/api/routes/knowledge.py) | `POST /knowledge-pack` | Study-pack generation |
| [../backend/app/api/routes/learning_state.py](../backend/app/api/routes/learning_state.py) | `GET /learning-state`, `PUT /learning-state/sessions/{session_id}`, `PUT /learning-state/knowledge-progress` | Synced cross-device learner state |
| [../backend/app/api/routes/review_cases.py](../backend/app/api/routes/review_cases.py) | `GET /review-cases`, `POST /review-cases/{case_id}/resolve` | Human review queue with status/session filters |
| [../backend/app/api/routes/tts.py](../backend/app/api/routes/tts.py) | `POST /tts` | Backend speech synthesis fallback with no-store audio responses |

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
| [../backend/app/services/ai_client.py](../backend/app/services/ai_client.py) | Common JSON-message send path, multimodal payload conversion, and provider response normalization |
| [../backend/app/services/procedure_loader.py](../backend/app/services/procedure_loader.py) | Loads procedure JSON and resolves stages |
| [../backend/app/services/safety_service.py](../backend/app/services/safety_service.py) | Simulation-only gate with text blocking, fast clears, and false-positive overrides |
| [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py) | Runs safety gate, stage analysis, setup acceptance, grading decision, scoring, and review escalation |
| [../backend/app/services/scoring_service.py](../backend/app/services/scoring_service.py) | Validates overlay targets and computes score deltas from severity/status |
| [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py) | Handles voice/text coach turns, transcript normalization, safety-aware blocking, and fallback guidance |
| [../backend/app/services/transcription_service.py](../backend/app/services/transcription_service.py) | Sends learner audio to OpenAI-compatible transcription endpoint |
| [../backend/app/services/tts_service.py](../backend/app/services/tts_service.py) | Synthesizes spoken coaching with Edge TTS voice selection and `pyttsx3` fallback |
| [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py) | Generates session recap, strengths, improvement areas, adaptive drill, equity plan, quiz, and localized fallbacks |
| [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py) | Builds Knowledge Lab packs, topic suggestions, freshness against prompt history, and substantial local fallbacks |
| [../backend/app/services/review_queue_service.py](../backend/app/services/review_queue_service.py) | Persists human review queue to JSON and resolves reviewer outcomes |
| [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) | Self-service and seeded auth, password hashing/upgrade, session tokens, admin approval workflow, and quota management |
| [../backend/app/services/learning_state_service.py](../backend/app/services/learning_state_service.py) | SQLite sync for saved sessions, active-session pointers, knowledge progress, and ownership normalization |

### Important backend behaviors

#### 1. Safety-first analysis

- `analysis_service.analyze_frame_payload()` loads the procedure/stage, runs `safety_service.evaluate_safety_gate()`, and only then asks the main model for stage analysis.
- The safety gate blocks immediately when simulation confirmation is missing or the learner text suggests a real-clinical context.
- For the simulation-only procedure, the safety service can fast-clear confirmed scenes without an extra safety-model round, and setup can still fall back to a cleared state when the safety classifier is unavailable.
- A learner, face, hands, or other person being visible is not a block reason by itself; the false-positive override explicitly clears benign non-clinical scenes.
- Setup still has a fast-pass rule inside analysis: if the frame clearly shows an approved inert surface, the service upgrades setup to `pass` even if the raw model said `retry`.
- Grading is separate from step status:
  - `unclear` is always not graded
  - low-confidence outputs can be not graded even if the model gave a coaching label
- Human review is triggered for:
  - blocked safety outcomes
  - `unclear` or `unsafe`
  - confidence below threshold
  - high-severity issues

#### 2. Voice coach loop support

- `coach_service.generate_coach_turn()` can transcribe learner audio first, append the transcript into the chat history, and trim the working conversation window before the model call.
- It reuses the safety gate when an image is present, so frame-aware coaching still respects the same simulation-only boundary as analysis.
- If transcription fails for a spoken turn, the service returns a blocked coaching response rather than crashing the loop.
- The coach prompt is optimized for short spoken turns, direct questions, and non-repetitive stage cues; the fallback path also knows when to wait for the learner instead of lecturing again.
- The frontend speech path tries browser STT first, but the backend transcription route remains available for setup diagnostics and fallback.

#### 3. Auth model

- Public demo accounts are hardcoded in `auth_service.PUBLIC_DEMO_ACCOUNTS`.
- Self-service student account creation is enabled.
- Admin reviewer requests are created as student-scoped accounts first, with `requested_role="admin"` and pending developer approval.
- Optional private admin/developer accounts come from `PRIVATE_SEED_ACCOUNTS_JSON`, and legacy private seeded accounts are cleaned out if they are no longer configured.
- Usernames are normalized to lowercase and stay globally unique across seeded and self-service accounts.
- Passwords are stored with PBKDF2-SHA256 and per-account salts, with legacy hashes upgraded on successful sign-in.
- Session tokens are stored in SQLite and issued on sign-in.
- Live-session quotas are tracked per seeded public/admin account, while developer access can remain uncapped.

#### 4. Synced learning state

- `learning_state_service` stores:
  - session payloads
  - active session per procedure
  - knowledge-progress counters
- Every read/write is authenticated through `X-Account-Id` and `X-Session-Token`, and cross-account session id takeover is rejected.
- Upserts are timestamp-aware: older session payloads do not overwrite newer ones.
- `make_active` is explicit on session upserts, so saving and switching the active pointer are separate decisions.
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

Runtime files are resolved through `runtime_data_path()`: locally they live under `backend/app/data`, and on Vercel they move to `/tmp/clinical-curator-ai-data`.

| Path | Owned by | Purpose |
| --- | --- | --- |
| [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json) | Backend runtime | Canonical procedure definition served to the app |
| `runtime_data_path("auth.db")` | `auth_service` | Accounts, password state, roles, quotas, and session tokens |
| `runtime_data_path("learning_state.db")` | `learning_state_service` | Synced sessions, active-session map, and Knowledge Lab progress |
| `runtime_data_path("review_cases.json")` | `review_queue_service` | Human review queue and reviewer resolutions |

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
| `/login` | [../frontend/app/login/page.tsx](../frontend/app/login/page.tsx) | Sign-in/create-account flow with local session resume, role-aware routing, and pending-admin messaging |
| `/access-required` | [../frontend/app/access-required/page.tsx](../frontend/app/access-required/page.tsx) | Legacy explanation page for older links that now redirect learners back to `/login` |
| `/dashboard` | [../frontend/app/dashboard/page.tsx](../frontend/app/dashboard/page.tsx) | Gamified learner dashboard built from saved sessions, streaks, XP, and recurring issues |
| `/train/[procedure]` | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) | Live trainer with local setup checks, quota-gated live-session activation, analysis loop, voice loop, and session persistence |
| `/review/[sessionId]` | [../frontend/app/review/[sessionId]/page.tsx](../frontend/app/review/[sessionId]/page.tsx) | Owned session review, debrief cache/hydration, local adaptive drill fallback, and review-case visibility |
| `/knowledge` | [../frontend/app/knowledge/page.tsx](../frontend/app/knowledge/page.tsx) | Fresh study packs across procedure/related-topic/common-mistake lanes, plus progress persistence |
| `/library` | [../frontend/app/library/page.tsx](../frontend/app/library/page.tsx) | Procedure walkthrough, benchmark notes, and bundled fallback procedure copy |
| `/profile` | [../frontend/app/profile/page.tsx](../frontend/app/profile/page.tsx) | Account profile updates, approval status, and demo quota reset UI for admins/developers |
| `/admin/reviews` | [../frontend/app/admin/reviews/page.tsx](../frontend/app/admin/reviews/page.tsx) | Human review queue and resolution form |
| `/developer/approvals` | [../frontend/app/developer/approvals/page.tsx](../frontend/app/developer/approvals/page.tsx) | Developer-only admin-approval queue |
| `/api/proxy/[...path]` | [../frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts) | Server-side proxy that forwards all HTTP verbs to the configured backend base URL |

### Shared frontend components

| Path | Role |
| --- | --- |
| [../frontend/components/AppFrame.tsx](../frontend/components/AppFrame.tsx) | Shared shell, sidebar, top bar, footer actions |
| [../frontend/components/CameraFeed.tsx](../frontend/components/CameraFeed.tsx) | Camera lifecycle, relaxed retry, optional mic priming, frame capture, and device-state normalization |
| [../frontend/components/FeedbackCard.tsx](../frontend/components/FeedbackCard.tsx) | Renders analysis results, safety blocks, priority fixes, and optional spoken coaching |
| [../frontend/components/ProcedureStepper.tsx](../frontend/components/ProcedureStepper.tsx) | Stage list, attempts, latest status, advance control |
| [../frontend/components/VoiceCoachPanel.tsx](../frontend/components/VoiceCoachPanel.tsx) | Voice-coach transcript, current plan, voice selection, and playback testing |
| [../frontend/components/ReviewSummary.tsx](../frontend/components/ReviewSummary.tsx) | Review/debrief surface, learner-profile display, drill plan, and debrief audio controls |
| [../frontend/components/HomeSystemStatus.tsx](../frontend/components/HomeSystemStatus.tsx) | Reusable backend/procedure status board component for live system checks |
| [../frontend/components/CalibrationOverlay.tsx](../frontend/components/CalibrationOverlay.tsx) | Manual corner/guide calibration UI |
| [../frontend/components/OverlayRenderer.tsx](../frontend/components/OverlayRenderer.tsx) | Projects overlay targets into the visible frame |
| [../frontend/components/DashboardIcon.tsx](../frontend/components/DashboardIcon.tsx) | SVG icon set for the app shell |

### Frontend libraries

| Path | Role |
| --- | --- |
| [../frontend/lib/types.ts](../frontend/lib/types.ts) | Shared frontend data model contract |
| [../frontend/lib/api.ts](../frontend/lib/api.ts) | Backend fetch wrappers, auth header construction, and dev-vs-proxy base URL selection |
| [../frontend/lib/storage.ts](../frontend/lib/storage.ts) | Browser auth/session/debrief/knowledge persistence, username migration, and backend sync merge |
| [../frontend/lib/useWorkspaceUser.ts](../frontend/lib/useWorkspaceUser.ts) | `useSyncExternalStore` bridge over storage with background learning-state hydration |
| [../frontend/lib/audio.ts](../frontend/lib/audio.ts) | Browser speech synthesis, browser STT/voice capture, WAV encoding, and backend TTS fallback |
| [../frontend/lib/learnerProfile.ts](../frontend/lib/learnerProfile.ts) | Graded-attempt inference, recurring-issue aggregation, and localized local adaptive drills |
| [../frontend/lib/equity.ts](../frontend/lib/equity.ts) | Feedback-language labels and API equity-mode mapping |
| [../frontend/lib/geometry.ts](../frontend/lib/geometry.ts) | Guide-frame geometry and overlay projection |
| [../frontend/lib/appShell.ts](../frontend/lib/appShell.ts) | Shared nav/top-item generation |

### Important frontend behaviors

#### 1. Live trainer page

`frontend/app/train/[procedure]/page.tsx` is the single densest frontend file and owns:

- auth gate plus procedure/session hydration after opportunistic backend sync
- reset-to-clean-run trainer startup while preserving older sessions for review
- local setup verification for backend reachability, secure context, camera, microphone, speech path, network, and quota
- `Check Audio` shortcut plus the deeper `Mic and speech test` panel that can compare Browser STT against backend transcription
- setup-only preview and setup-stage checks that do not consume the counted live-session quota
- real live-session activation, 2-minute demo window, pause/resume, and quota refresh
- manual `Check My Step` analysis flow, including local setup pass/fail synthesis and automatic setup-to-stage advance
- offline-first analysis fallback logging
- hands-free voice coach loop with proactive turns, browser-first speech capture, backend fallback, and duplicate-guidance suppression
- pause/end session controls, footer audio insight cards, and session persistence back into browser storage plus synced backend state

If you change the main learner experience, start there.

#### 2. Browser storage ownership

`frontend/lib/storage.ts` owns the browser-side data model:

- auth user cache
- session list and active session pointers keyed by owner + procedure
- debrief cache keyed by review signature
- knowledge-progress cache plus recent question/front history
- migration when a username changes
- sync merge with backend learning-state snapshots

This file is effectively the frontend persistence layer.

#### 3. Review/debrief pipeline

`frontend/app/review/[sessionId]/page.tsx`:

- syncs from the backend before hydrating the owned session
- derives learner-profile context across same-procedure sessions
- builds a local adaptive drill fallback even before the server debrief arrives
- reuses cached debriefs when the review signature matches the session plus learner profile
- suppresses debrief generation in offline mode when offline practice logging is active
- stores the returned debrief back into the session cache
- loads human-review cases linked to that session

#### 4. Knowledge Lab pipeline

`frontend/app/knowledge/page.tsx`:

- hydrates persisted knowledge progress per signed-in learner
- derives recent issues, latest skill level, latest language, and focus area from saved sessions
- requests study packs from the backend with study mode, selected topic, recent issue labels, and history to avoid repeated prompts/cards
- falls back to default topic suggestions when needed
- tracks rapidfire timers, quiz scoring, flashcard mastery, and total points locally and via backend sync

## Procedure And Rubric Assets

| Path | Role |
| --- | --- |
| [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json) | Runtime procedure used by the app |
| [../open-library/rubrics/simple-interrupted-suture.json](../open-library/rubrics/simple-interrupted-suture.json) | Reference rubric asset in the open library |
| [../open-library/rubrics/rubric-template.json](../open-library/rubrics/rubric-template.json) | Template for future procedure rubrics |
| [../open-library/benchmark/simulation_benchmark_manifest.csv](../open-library/benchmark/simulation_benchmark_manifest.csv) | Benchmark manifest stub/reference |

The repo currently centers the product around one procedure, and the library page also ships a bundled fallback copy so the guide can still render when the backend procedure fetch fails.

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

- Auth user cache
- Fast hydration cache for sessions
- Active session pointers
- Cached debrief payloads
- Knowledge progress and recent question/front history
- Offline practice logs
- Locally derived learner-profile views
- Workspace change events for reactive UI updates

### Sync model

- The frontend can operate from browser cache first.
- `useWorkspaceUser` and several routes opportunistically call `syncLearningStateFromBackend()` to refresh the local cache.
- The backend is the durable source for cross-browser session history, active-session pointers, and knowledge progress.
- Review content is cached locally by review signature to avoid unnecessary regeneration.
- Offline analysis attempts and offline practice logs still appear in local review history even when cloud services are unavailable.

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
| `API_BASE_URL` | Hosted frontend server-side proxy target used by `/api/proxy/*` |

## Test Index

| Path | What it covers |
| --- | --- |
| [../backend/tests/test_api.py](../backend/tests/test_api.py) | Route behavior across auth, learning-state sync, review queue, debrief/coach/knowledge endpoints, TTS, and transcription |
| [../backend/tests/test_services.py](../backend/tests/test_services.py) | Service fallbacks, overlay validation, setup acceptance, coach/audio behavior, safety fast clears, review queue, and live-session concurrency |
| [../backend/tests/test_ai_client.py](../backend/tests/test_ai_client.py) | Multimodal payload conversion, provider parsing, Z.AI/OpenAI-compatible fallback modes, and Anthropic transport behavior |
| [../backend/tests/test_config.py](../backend/tests/test_config.py) | Backend `.env` precedence, transcription key precedence, and extra-key handling |
| [../backend/tests/test_live_vllm_smoke.py](../backend/tests/test_live_vllm_smoke.py) | Optional live smoke tests against a running backend and vLLM server for coach/analyze/audio flows |

## Where To Change Things

| If you want to change... | Start here |
| --- | --- |
| Login/account behavior | [../frontend/app/login/page.tsx](../frontend/app/login/page.tsx), [../frontend/lib/storage.ts](../frontend/lib/storage.ts), [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) |
| Public demo accounts, admin approvals, or quotas | [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py), [../frontend/app/profile/page.tsx](../frontend/app/profile/page.tsx), [../frontend/app/developer/approvals/page.tsx](../frontend/app/developer/approvals/page.tsx) |
| Setup preflight, camera gating, or audio diagnostics | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx), [../frontend/components/CameraFeed.tsx](../frontend/components/CameraFeed.tsx), [../frontend/lib/audio.ts](../frontend/lib/audio.ts) |
| Main trainer workflow | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) |
| Analysis prompt or scoring rules | [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py), [../backend/app/services/scoring_service.py](../backend/app/services/scoring_service.py) |
| Safety behavior | [../backend/app/services/safety_service.py](../backend/app/services/safety_service.py) |
| Voice coaching behavior | [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx), [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py), [../frontend/lib/audio.ts](../frontend/lib/audio.ts) |
| Debrief content or learner-profile derivation | [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py), [../frontend/app/review/[sessionId]/page.tsx](../frontend/app/review/[sessionId]/page.tsx), [../frontend/lib/learnerProfile.ts](../frontend/lib/learnerProfile.ts) |
| Knowledge Lab content | [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py), [../frontend/app/knowledge/page.tsx](../frontend/app/knowledge/page.tsx) |
| Human review queue | [../backend/app/services/review_queue_service.py](../backend/app/services/review_queue_service.py), [../frontend/app/admin/reviews/page.tsx](../frontend/app/admin/reviews/page.tsx) |
| Procedure content or overlays | [../backend/app/procedures/simple_interrupted_suture.json](../backend/app/procedures/simple_interrupted_suture.json), [../frontend/app/library/page.tsx](../frontend/app/library/page.tsx) |
| Browser persistence or cross-device sync | [../frontend/lib/storage.ts](../frontend/lib/storage.ts), [../frontend/lib/useWorkspaceUser.ts](../frontend/lib/useWorkspaceUser.ts), [../backend/app/services/learning_state_service.py](../backend/app/services/learning_state_service.py) |
| Deployment wiring or runtime data placement | [backend-deployment.md](backend-deployment.md), [../frontend/app/api/proxy/[...path]/route.ts](../frontend/app/api/proxy/[...path]/route.ts), [../backend/app/core/storage_paths.py](../backend/app/core/storage_paths.py) |

## Suggested Reading Order For New Contributors

1. [../README.md](../README.md)
2. [project-index.md](project-index.md)
3. [how-to-run.md](how-to-run.md)
4. [local-setup.md](local-setup.md)
5. [api-reference.md](api-reference.md)
6. Then jump into either:
   - [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx) for product flow
   - [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py) for access and quota behavior
   - [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py) for AI behavior
   - [../frontend/lib/storage.ts](../frontend/lib/storage.ts) for persistence behavior

## Summary

This repo is not a generic full-stack starter. It is a tightly scoped, demo-safe training product with:

- one main procedure
- local setup plus speech diagnostics before counted live coaching starts
- a deliberate safety gate before image coaching
- mixed self-service plus seeded-account access control
- browser-plus-backend dual persistence
- a human-review loop
- a clear expansion path for more procedures and richer study content

That makes the most important files disproportionately concentrated in:

- [../frontend/app/train/[procedure]/page.tsx](../frontend/app/train/[procedure]/page.tsx)
- [../frontend/lib/storage.ts](../frontend/lib/storage.ts)
- [../frontend/app/review/[sessionId]/page.tsx](../frontend/app/review/[sessionId]/page.tsx)
- [../backend/app/services/auth_service.py](../backend/app/services/auth_service.py)
- [../backend/app/services/analysis_service.py](../backend/app/services/analysis_service.py)
- [../backend/app/services/safety_service.py](../backend/app/services/safety_service.py)
- [../backend/app/services/coach_service.py](../backend/app/services/coach_service.py)
- [../backend/app/services/debrief_service.py](../backend/app/services/debrief_service.py)
- [../backend/app/services/knowledge_service.py](../backend/app/services/knowledge_service.py)
