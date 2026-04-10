from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    analyze,
    auth,
    coach,
    debrief,
    health,
    knowledge,
    learning_state,
    procedures,
    review_cases,
    transcription,
    tts,
)
from app.core.config import settings

app = FastAPI(title=settings.app_name, version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(procedures.router, prefix="/api/v1")
app.include_router(analyze.router, prefix="/api/v1")
app.include_router(coach.router, prefix="/api/v1")
app.include_router(tts.router, prefix="/api/v1")
app.include_router(debrief.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")
app.include_router(learning_state.router, prefix="/api/v1")
app.include_router(review_cases.router, prefix="/api/v1")
app.include_router(transcription.router, prefix="/api/v1")
