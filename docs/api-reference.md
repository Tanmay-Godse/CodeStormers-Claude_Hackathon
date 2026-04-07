# API Reference

This document is the backend route reference.

For local setup, use [local-setup.md](local-setup.md).
For Anthropic and OpenAI key setup, use [cloud-keys.md](cloud-keys.md).
For deployment, use [vercel-deployment.md](vercel-deployment.md) and
[backend-deployment.md](backend-deployment.md).

Base URL in local development:

```text
http://localhost:8001/api/v1
```

The browser only talks to this backend. It does not call Anthropic or OpenAI
directly.

## Conventions

- request and response bodies are JSON unless noted otherwise
- auth currently uses username lookup
- self-service and seeded accounts share the same backend auth store
- seeded demo accounts return quota fields such as `live_session_limit` and `live_session_remaining`
- the frontend currently sends fixed defaults for simulation confirmation, audio coaching, and offline logging
- the frontend keeps a browser cache, but the backend is now the source of truth for synced session history and Knowledge Lab progress

## Health And Procedure

### `GET /health`

Returns:

```json
{"status":"ok","simulation_only":true}
```

### `GET /procedures/{id}`

Supported right now:

- `simple-interrupted-suture`

Returns the procedure metadata that drives the trainer and library.

## Auth

### `GET /auth/accounts/preview`

Looks up an existing account by username.

Query params:

- `identifier`

Example:

```bash
curl "http://localhost:8001/api/v1/auth/accounts/preview?identifier=student.prime"
```

Response fields include:

- `id`
- `name`
- `username`
- `role`
- `is_developer`
- `is_seeded`
- `live_session_limit`
- `live_session_used`
- `live_session_remaining`
- `session_token` which is `null` before sign-in

Behavior:

- unknown usernames return `404`

### `POST /auth/sign-in`

Signs in any existing account.

Example request:

```json
{
  "identifier": "Student_1@gmail.com",
  "password": "CODESTORMERS",
  "role": "student"
}
```

Success returns the same account preview shape plus a non-null `session_token`.

### `POST /auth/accounts`

Creates a new self-service account.

Student-account behavior:

- creates the account immediately
- returns `201`
- includes a non-null `session_token`
- applies the app's default live-session limit

Admin-request behavior:

- if the request body uses `"role": "admin"`, the account is created as a student account first
- the response sets `requested_role` to `admin`
- the response sets `admin_approval_status` to `pending`
- the fixed developer account can later approve or reject that request

### `PUT /auth/accounts/{account_id}`

Profile update route for non-seeded self-service accounts.

In this build:

- seeded student accounts are read-only
- developer-managed seeded accounts are still managed out of band

### `GET /auth/demo-accounts`

Lists seeded non-developer demo accounts for quota management.

Query params:

- `actor_account_id`
- `actor_session_token`

Access:

- admin or developer only

### `POST /auth/live-sessions/consume`

Consumes one live session when a camera run starts.

Request:

```json
{
  "account_id": "account-demo-student-1",
  "session_token": "..."
}
```

Returns the refreshed account preview with updated `live_session_used` and
`live_session_remaining`.

### `POST /auth/accounts/{account_id}/reset-live-sessions`

Resets a seeded demo account back to its full live-session allowance.

Request:

```json
{
  "actor_account_id": "account-admin-or-developer",
  "actor_session_token": "..."
}
```

Access:

- admin or developer only

### `GET /auth/admin-requests`
### `POST /auth/admin-requests/{account_id}/approve`
### `POST /auth/admin-requests/{account_id}/reject`

These routes are developer-only approval controls for pending admin reviewer
requests.

## Learning State

### `GET /learning-state`

Returns the signed-in learner's synced state snapshot.

Query params:

- `account_id`
- `session_token`

Response fields:

- `sessions`
- `active_session_ids`
- `knowledge_progress`

### `PUT /learning-state/sessions/{session_id}`

Upserts one synced learner session record.

Example request:

```json
{
  "account_id": "account-demo-student-1",
  "session_token": "...",
  "session": {
    "id": "session-123",
    "procedureId": "simple-interrupted-suture",
    "ownerUsername": "student_1@gmail.com",
    "skillLevel": "beginner",
    "events": [],
    "createdAt": "2026-03-21T00:00:00.000Z",
    "updatedAt": "2026-03-21T00:05:00.000Z"
  },
  "make_active": true
}
```

Notes:

- the backend normalizes `ownerUsername` to the authenticated account
- `make_active` is optional and defaults to `false`
- a learner cannot reuse another account's `session_id`

### `PUT /learning-state/knowledge-progress`

Upserts the signed-in learner's Knowledge Lab progress counters.

Example request:

```json
{
  "account_id": "account-demo-student-1",
  "session_token": "...",
  "progress": {
    "answeredCount": 12,
    "completedQuizRounds": 3,
    "correctCount": 10,
    "flashcardsMastered": 5,
    "perfectRounds": 1,
    "rapidfireBestStreak": 6,
    "totalPoints": 180
  }
}
```

## Knowledge

### `POST /knowledge-pack`

Builds the Knowledge Lab pack for rapidfire, quiz, and flashcards.

Example request:

```json
{
  "procedure_id": "simple-interrupted-suture",
  "skill_level": "beginner",
  "feedback_language": "en",
  "learner_name": "Student 1",
  "study_mode": "related_topics",
  "selected_topic": "Needle angle",
  "recent_issue_labels": ["angle_shallow"]
}
```

Important fields:

- `study_mode`: `current_procedure`, `related_topics`, or `common_mistakes`
- `selected_topic`: optional user-chosen topic
- `topic_suggestions`: suggestion chips for the next round
- `rapidfire_rounds`
- `quiz_questions`
- `flashcards`

If the learning model fails, the backend returns a rubric-based fallback pack.

## Live Trainer

### `POST /analyze-frame`

Submits one captured frame for grading and coaching.

Typical request:

```json
{
  "procedure_id": "simple-interrupted-suture",
  "stage_id": "needle_entry",
  "skill_level": "beginner",
  "practice_surface": "Foam pad",
  "image_base64": "ZmFrZQ==",
  "student_question": "What should I fix next?",
  "simulation_confirmation": true,
  "session_id": "session-123",
  "student_name": "Student 1",
  "student_username": "student_1@gmail.com",
  "feedback_language": "en",
  "equity_mode": {
    "enabled": true,
    "audio_coaching": true,
    "low_bandwidth_mode": false,
    "cheap_phone_mode": false,
    "offline_practice_logging": true
  }
}
```

Important response fields:

- `analysis_mode`
- `step_status`
- `grading_decision`
- `grading_reason`
- `confidence`
- `visible_observations`
- `issues`
- `coaching_message`
- `next_action`
- `overlay_target_ids`
- `score_delta`
- `requires_human_review`
- `review_case_id`

Notes:

- a blocked safety-gate result still returns `200` with `analysis_mode="blocked"`
- the setup stage is intentionally more forgiving for visible demo surfaces
- the current frontend keeps `simulation_confirmation=true`

### `POST /coach-chat`

Generates the next live coaching turn.

The request can carry:

- `messages`
- `image_base64`
- `audio_base64`
- `audio_format`
- current stage, surface, and learner context

The response includes:

- `conversation_stage`
- `coach_message`
- `plan_summary`
- `suggested_next_step`
- `camera_observations`
- `stage_focus`
- `learner_goal_summary`
- `learner_transcript`

### `POST /tts`

Generates coach speech audio.

Example:

```json
{
  "text": "Keep the needle entry slightly more upright.",
  "feedback_language": "en",
  "coach_voice": "guide_female"
}
```

Returns audio bytes with the active content type, usually `audio/mpeg` when
neural TTS succeeds.

## Review

### `GET /review-cases`

Lists flagged review tickets.

Useful query params:

- `status`
- `session_id`

Each case can include:

- learner name and username
- initial AI assessment
- safety-gate result
- blocked or escalated reason
- reviewer resolution fields when resolved

### `POST /review-cases/{case_id}/resolve`

Resolves a flagged case with reviewer notes and optional corrected coaching.

### `POST /debrief`

Generates the review-page debrief from stored session history.

Typical request includes:

- `session_id`
- `procedure_id`
- `skill_level`
- `feedback_language`
- `events`
- optional `learner_profile`

Important response fields:

- `graded_attempt_count`
- `not_graded_attempt_count`
- `error_fingerprint`
- `adaptive_drill`
- `strengths`
- `improvement_areas`
- `practice_plan`
- `equity_support_plan`
- `audio_script`
- `quiz`
