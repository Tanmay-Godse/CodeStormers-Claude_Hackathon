# API Reference

The backend exposes a small API under:

```text
http://localhost:8001/api/v1
```

The frontend only talks to this backend. Browser clients do not call Anthropic or OpenAI-compatible model APIs directly.

## Conventions

- all request and response bodies are JSON
- request validation is handled by Pydantic
- backend scoring is deterministic
- analyze errors are surfaced as HTTP errors
- debrief responses are normalized into a stable study-summary structure with equity support and audio text

## `GET /health`

Returns a simple service health payload.

### Example

```bash
curl http://localhost:8001/api/v1/health
```

### Response

```json
{"status":"ok","simulation_only":true}
```

## `GET /procedures/{id}`

Returns the procedure definition used by the trainer UI.

### Supported procedure ids

- `simple-interrupted-suture`

### Example

```bash
curl http://localhost:8001/api/v1/procedures/simple-interrupted-suture
```

### Response shape

```json
{
  "id": "simple-interrupted-suture",
  "title": "Simple Interrupted Suture",
  "simulation_only": true,
  "practice_surface": "Orange, banana, or foam pad",
  "named_overlay_targets": [],
  "stages": []
}
```

### Important fields

- `named_overlay_targets`: overlay ids with labels, descriptions, normalized coordinates, and colors
- `stages`: stage ids, objectives, visible checks, common errors, overlay target ids, and score weights

### Error behavior

- `404` if the procedure id is unknown

## `GET /auth/accounts/preview`

Looks up an existing workspace account by username or display name.

### Query parameters

- `identifier`: username or display name to check

### Example

```bash
curl "http://localhost:8001/api/v1/auth/accounts/preview?identifier=student01"
```

### Successful response

```json
{
  "id": "account-demo",
  "name": "Student One",
  "username": "student01",
  "role": "student",
  "created_at": "2026-03-21T18:45:00.000000+00:00"
}
```

### Error behavior

- `404` if no account matches the identifier
- `409` if more than one account shares the same display name and the username was not used

## `POST /auth/accounts`

Creates a new workspace account and persists it in the backend SQLite database.

### Request body

```json
{
  "name": "Student One",
  "username": "student01",
  "password": "supersecure",
  "role": "student"
}
```

### Error behavior

- `201` on success
- `400` for invalid usernames or short passwords
- `409` if the username is already registered

## `POST /auth/sign-in`

Signs in an existing workspace account by identifier and password.

### Request body

```json
{
  "identifier": "student01",
  "password": "supersecure",
  "role": "student"
}
```

### Error behavior

- `200` on success
- `401` for invalid credentials
- `404` if the account does not exist
- `409` if the requested role does not match the stored account role

## `POST /analyze-frame`

Submits one captured trainer frame for stage analysis.

The backend:

- validates the request
- applies a simulation-only safety gate before coaching
- loads the procedure rubric and current stage
- auto-detects whether the configured AI endpoint is OpenAI-compatible or Anthropic-style
- prompts the configured model
- validates the returned JSON
- filters overlay targets against the current stage
- computes `score_delta` in Python
- withholds hard scores when confidence is too low or the frame is too ambiguous
- escalates flagged sessions into the human review queue

### Request body

```json
{
  "procedure_id": "simple-interrupted-suture",
  "stage_id": "needle_entry",
  "skill_level": "beginner",
  "image_base64": "ZmFrZQ==",
  "student_question": "optional question",
  "simulation_confirmation": true,
  "session_id": "session-123",
  "student_name": "Student User",
  "feedback_language": "en",
  "equity_mode": {
    "enabled": true,
    "audio_coaching": true,
    "low_bandwidth_mode": true,
    "cheap_phone_mode": false,
    "offline_practice_logging": true
  }
}
```

### Request fields

- `procedure_id`: currently `simple-interrupted-suture`
- `stage_id`: one of the defined procedure stage ids
- `skill_level`: `beginner` or `intermediate`
- `image_base64`: raw base64 image bytes, without a data URL prefix
- `student_question`: optional free-text prompt from the learner
- `simulation_confirmation`: required simulation-only acknowledgement before analysis
- `session_id`: optional session id used to attach human-review cases
- `student_name`: optional learner name for the review queue
- `feedback_language`: requested learner-facing language, currently `en`, `es`, `fr`, or `hi`
- `equity_mode`: optional access-profile settings that guide response style and lower-resource behavior

### Successful response

```json
{
  "analysis_mode": "coaching",
  "step_status": "retry",
  "grading_decision": "not_graded",
  "grading_reason": "Not graded - retake required because the confidence was too low for a trustworthy score.",
  "confidence": 0.83,
  "visible_observations": [
    "entry zone is visible",
    "instrument is close to the target point",
    "needle angle appears too shallow for a clean bite"
  ],
  "issues": [
    {
      "code": "angle_shallow",
      "severity": "medium",
      "message": "Approach is too shallow for a confident needle entry."
    }
  ],
  "coaching_message": "Rotate the driver slightly upward and start the bite more perpendicular to the surface.",
  "next_action": "Reposition the grip, retake the frame, and try the entry again.",
  "overlay_target_ids": ["entry_point", "needle_angle"],
  "score_delta": 0,
  "safety_gate": {
    "status": "cleared",
    "confidence": 0.98,
    "reason": "The image cleared the simulation-only safety screen.",
    "refusal_message": null
  },
  "requires_human_review": false,
  "human_review_reason": null,
  "review_case_id": null
}
```

### Response fields

- `analysis_mode`: `coaching` or `blocked`
- `step_status`: `pass`, `retry`, `unclear`, or `unsafe`
- `grading_decision`: `graded` or `not_graded`
- `grading_reason`: explanation when the backend refuses to attach a trustworthy score
- `confidence`: number from `0` to `1`
- `visible_observations`: normalized list of visible cues the model could judge
- `issues`: up to three structured issues
- `coaching_message`: short coaching summary
- `next_action`: concrete next step for the learner
- `overlay_target_ids`: allowed overlay ids for the current stage only
- `score_delta`: deterministic integer computed by the backend; this is `0` when the attempt is not graded
- `safety_gate`: result of the simulation-only validation layer
- `requires_human_review`: whether the session was queued for faculty review
- `human_review_reason`: why the case was flagged
- `review_case_id`: queue id when a human review case was created

### Status codes

- `200`: successful analyzed response
- `404`: unknown procedure or stage
- `503`: AI analysis is not configured, usually because `AI_API_BASE_URL` is missing
- `502`: upstream AI request failed or returned invalid JSON

### Notes

- a vision-capable model is required for this route
- if the safety gate blocks the image, the response still returns `200` with `analysis_mode="blocked"`
- `chaitnya26/Qwen2.5-Omni-3B-Fork` and `Qwen/Qwen2.5-VL-3B-Instruct` are good OpenAI-compatible examples
- text-only models are not suitable for this route because image input is required

## `GET /review-cases`

Returns the human validation queue.

### Query params

- `status`: optional `pending` or `resolved`
- `session_id`: optional session filter

## `POST /review-cases/{case_id}/resolve`

Resolves a flagged session with human feedback.

### Request body

```json
{
  "reviewer_name": "Faculty Reviewer",
  "reviewer_notes": "The AI was directionally correct but too uncertain.",
  "corrected_step_status": "retry",
  "corrected_coaching_message": "Slow the entry and reframe the angle before retrying.",
  "rubric_feedback": "Add a stronger low-confidence escalation rule for shallow entries."
}
```

## `POST /debrief`

Generates the review-page debrief from stored session history.

### Request body

```json
{
  "session_id": "demo-session",
  "procedure_id": "simple-interrupted-suture",
  "skill_level": "beginner",
  "feedback_language": "en",
  "equity_mode": {
    "enabled": true,
    "audio_coaching": true,
    "low_bandwidth_mode": true,
    "cheap_phone_mode": false,
    "offline_practice_logging": true
  },
  "events": [
    {
      "stage_id": "needle_entry",
      "attempt": 1,
      "step_status": "retry",
      "analysis_mode": "coaching",
      "graded": true,
      "issues": [
        {
          "code": "angle_shallow",
          "severity": "medium",
          "message": "The angle is too shallow."
        }
      ],
      "score_delta": 13,
      "coaching_message": "Rotate upward before retrying.",
      "overlay_target_ids": ["entry_point", "needle_angle"],
      "visible_observations": [
        "surface is centered",
        "entry zone is visible"
      ],
      "next_action": "Retry the entry stage.",
      "confidence": 0.88,
      "created_at": "2026-03-20T17:10:00.000Z"
    }
  ]
}
```

Optional request addition:

- `learner_profile`: aggregated cross-session snapshot from the frontend, including `total_sessions`, `graded_attempts`, and top recurring issues for the same learner and procedure

### Event field notes

- `stage_id`: current stage id
- `attempt`: 1-based attempt number for that stage
- `step_status`: `pass`, `retry`, `unclear`, or `unsafe`
- `analysis_mode`: `coaching` or `blocked`
- `graded`: whether that attempt should count as a trustworthy scored signal
- `grading_reason`: optional explanation when the attempt was not graded
- `issues`: structured issue list from a prior analyze response
- `score_delta`: backend-computed score delta from that attempt
- `coaching_message`: coaching text from the prior analyze response
- `overlay_target_ids`: overlay ids used in that attempt
- `visible_observations`: optional normalized observations from the analyze response
- `next_action`: optional next-step text
- `confidence`: optional confidence value
- `created_at`: ISO timestamp string

### Successful response

```json
{
  "feedback_language": "en",
  "graded_attempt_count": 4,
  "not_graded_attempt_count": 1,
  "error_fingerprint": [
    {
      "code": "angle_shallow",
      "label": "shallow entry angle",
      "count": 3,
      "stage_ids": ["needle_entry"]
    }
  ],
  "adaptive_drill": {
    "title": "shallow entry angle mini drill",
    "focus": "shallow entry angle",
    "reason": "This drill targets the correction that shows up most often across your sessions: shallow entry angle.",
    "instructions": [
      "Do 5 slow reps that isolate shallow entry angle instead of running a full stitch.",
      "Pause after each rep and check whether the correction stayed visible in frame.",
      "Finish with 1 full captured attempt and compare it with the earlier pattern."
    ],
    "rep_target": "Target: 5 focused reps and 1 full capture."
  },
  "strengths": [
    "You kept the practice surface centered during the attempt.",
    "Your grip remained stable enough to judge the frame.",
    "You captured a reviewable image for coaching."
  ],
  "improvement_areas": [
    "Improve the entry angle on the first bite.",
    "Keep the needle arc consistent through the wound line.",
    "Seat the knot more centrally during the final tie."
  ],
  "practice_plan": [
    "Repeat the entry stage with a more perpendicular approach.",
    "Practice one slow exit arc while keeping the far side visible.",
    "Finish with one centered knot attempt and review the frame."
  ],
  "equity_support_plan": [
    "Use low-bandwidth mode when the connection is weak.",
    "Replay the audio coaching if reading is tiring.",
    "Keep logging practice locally when the network drops."
  ],
  "audio_script": "Quick coaching recap. Repeat the entry stage with a more perpendicular approach.",
  "quiz": [
    {
      "question": "What does a shallow entry angle usually affect?",
      "answer": "It makes the first bite less confident and harder to control."
    },
    {
      "question": "Why should the far-side exit remain visible?",
      "answer": "Visibility helps confirm the arc completes across the practice line."
    },
    {
      "question": "What does a centered final knot improve?",
      "answer": "It improves the presentation and alignment of the finished stitch."
    }
  ]
}
```

### Response guarantees

- `graded_attempt_count` and `not_graded_attempt_count` are always present
- `error_fingerprint` is always present, even when it is empty
- `strengths` always has 3 items
- `improvement_areas` always has 3 items
- `practice_plan` always has 3 items
- `adaptive_drill` always returns one focused micro-drill
- `equity_support_plan` always has 3 items
- `audio_script` is always a single read-aloud coaching paragraph
- `quiz` always has 3 question and answer pairs

### Status codes

- `200`: both AI-backed and fallback debriefs
- `404`: unknown procedure id

### Notes

- empty `events` are supported
- non-empty `events` prefer model-backed output when available
- if the AI layer fails or returns a partial payload, the backend fills missing content from deterministic fallback logic

## Frontend Session Model

The review page is powered by browser `localStorage`, not by backend persistence.

Each local session contains:

- procedure id
- optional learner ownership metadata
- skill level
- calibration state
- per-stage events
- score deltas
- graded vs not-graded attempt state
- coaching messages
- optional visible observations, confidence, and next-action data
- an optional cached debrief keyed by session review signature
