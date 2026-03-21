# Simulation Benchmark Starter

This benchmark folder is a starter surface for building a faculty-labeled dataset of simulation-only training images.

## Intended Labels

- `clear_pass`
- `clear_retry`
- `unclear_frame`
- `unsafe_technique`
- `blocked_real_patient_risk`

## Metadata To Capture

- procedure or module
- stage
- image condition
- simulation surface
- reviewer label
- reviewer notes
- whether the image should trigger human review

## Guardrails

- No real-patient or live-clinical imagery
- No identifying information
- Prefer multiple faculty labels for disputed frames
- Keep benchmark categories useful for education, not just model optimization
