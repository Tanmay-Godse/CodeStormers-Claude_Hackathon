# API Reference

The backend exposes a small API under:

```text
http://localhost:8000/api/v1
```

The frontend only talks to this backend. Browser clients do not call Anthropic or OpenAI-compatible model APIs directly.

## Conventions

- all request and response bodies are JSON
- request validation is handled by Pydantic
- backend scoring is deterministic
- analyze errors are surfaced as HTTP errors
- debrief responses are normalized into a stable four-part structure

## `GET /health`

Returns a simple service health payload.

### Example

```bash
curl http://localhost:8000/api/v1/health
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
curl http://localhost:8000/api/v1/procedures/simple-interrupted-suture
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

## `POST /analyze-frame`

Submits one captured trainer frame for stage analysis.

The backend:

- validates the request
- loads the procedure rubric and current stage
- auto-detects whether the configured AI endpoint is OpenAI-compatible or Anthropic-style
- prompts the configured model
- validates the returned JSON
- filters overlay targets against the current stage
- computes `score_delta` in Python

### Request body

```json
{
  "procedure_id": "simple-interrupted-suture",
  "stage_id": "needle_entry",
  "skill_level": "beginner",
  "image_base64": "ZmFrZQ==",
  "student_question": "optional question"
}
```

### Request fields

- `procedure_id`: currently `simple-interrupted-suture`
- `stage_id`: one of the defined procedure stage ids
- `skill_level`: `beginner` or `intermediate`
- `image_base64`: raw base64 image bytes, without a data URL prefix
- `student_question`: optional free-text prompt from the learner

### Successful response

```json
{
  "step_status": "retry",
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
  "score_delta": 13
}
```

### Response fields

- `step_status`: `pass`, `retry`, `unclear`, or `unsafe`
- `confidence`: number from `0` to `1`
- `visible_observations`: normalized list of visible cues the model could judge
- `issues`: up to three structured issues
- `coaching_message`: short coaching summary
- `next_action`: concrete next step for the learner
- `overlay_target_ids`: allowed overlay ids for the current stage only
- `score_delta`: deterministic integer computed by the backend

### Status codes

- `200`: successful analyzed response
- `404`: unknown procedure or stage
- `503`: AI analysis is not configured, usually because `AI_API_BASE_URL` is missing
- `502`: upstream AI request failed or returned invalid JSON

### Notes

- a vision-capable model is required for this route
- `Qwen/Qwen2.5-VL-3B-Instruct` and `Qwen/Qwen2.5-Omni-7B` are good OpenAI-compatible examples
- `Qwen3-4B` is not suitable for this route because it is text-only

## `POST /debrief`

Generates the review-page debrief from stored session history.

### Request body

```json
{
  "session_id": "demo-session",
  "procedure_id": "simple-interrupted-suture",
  "skill_level": "beginner",
  "events": [
    {
      "stage_id": "needle_entry",
      "attempt": 1,
      "step_status": "retry",
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

### Event field notes

- `stage_id`: current stage id
- `attempt`: 1-based attempt number for that stage
- `step_status`: `pass`, `retry`, `unclear`, or `unsafe`
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

- `strengths` always has 3 items
- `improvement_areas` always has 3 items
- `practice_plan` always has 3 items
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
- skill level
- calibration state
- per-stage events
- score deltas
- coaching messages
- optional visible observations, confidence, and next-action data
- an optional cached debrief keyed by session review signature
