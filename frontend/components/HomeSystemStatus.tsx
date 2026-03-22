"use client";

import { useCallback, useEffect, useState } from "react";

import { getHealthStatus, getProcedure } from "@/lib/api";
import type { HealthStatus, ProcedureDefinition } from "@/lib/types";

const DEFAULT_PROCEDURE_ID = "simple-interrupted-suture";

type LoadState = "loading" | "ready" | "error";

export function HomeSystemStatus() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [procedure, setProcedure] = useState<ProcedureDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSystemState = useCallback(async () => {
    setLoadState("loading");
    setError(null);

    try {
      const [nextHealth, nextProcedure] = await Promise.all([
        getHealthStatus(),
        getProcedure(DEFAULT_PROCEDURE_ID),
      ]);

      setHealth(nextHealth);
      setProcedure(nextProcedure);
      setLoadState("ready");
    } catch (loadError) {
      setHealth(null);
      setProcedure(null);
      setLoadState("error");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not reach the backend right now.",
      );
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSystemState();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadSystemState]);

  const hasLiveData = loadState === "ready" && health !== null && procedure !== null;

  return (
    <aside className="hero-card hero-aside system-board">
      <div className="system-board-header">
        <div>
          <span className="eyebrow">Live system</span>
          <h2 className="section-title">Backend and procedure status</h2>
        </div>
        <button
          className="button-ghost"
          onClick={() => void loadSystemState()}
          type="button"
        >
          Refresh
        </button>
      </div>

      <article
        className={`status-panel ${
          hasLiveData ? "is-ready" : loadState === "loading" ? "is-loading" : "is-error"
        }`}
      >
        <div className="status-row">
          <span
            aria-hidden="true"
            className={`status-dot ${
              hasLiveData ? "is-ready" : loadState === "loading" ? "is-loading" : "is-error"
            }`}
          />
          <div>
            <strong>
              {hasLiveData
                ? "Backend reachable"
                : loadState === "loading"
                  ? "Checking backend"
                  : "Backend unavailable"}
            </strong>
            <p className="panel-copy" style={{ marginTop: 10 }}>
              {hasLiveData
                ? `FastAPI is responding and the ${procedure.title} trainer is available.`
                : loadState === "loading"
                  ? "Fetching health and procedure metadata from the training backend."
                  : error ??
                    "Start the backend and make sure NEXT_PUBLIC_API_BASE_URL points to it."}
            </p>
          </div>
        </div>
      </article>

      {hasLiveData ? (
        <>
          <div className="status-summary-grid">
            <article className="mini-stat">
              <span>Procedure</span>
              <strong>{procedure.title}</strong>
            </article>
            <article className="mini-stat">
              <span>Stages</span>
              <strong>{procedure.stages.length}</strong>
            </article>
            <article className="mini-stat">
              <span>Surface</span>
              <strong>{procedure.practice_surface}</strong>
            </article>
          </div>

          <section className="system-section">
            <strong>Loaded stage flow</strong>
            <ul className="stage-preview-list">
              {procedure.stages.map((stage) => (
                <li key={stage.id}>
                  <span>{stage.title}</span>
                  <small>{stage.objective}</small>
                </li>
              ))}
            </ul>
          </section>

          <p className="panel-copy">
            Safety mode: {health.simulation_only ? "simulation only" : "custom mode"}.
            Overlay targets loaded: {procedure.named_overlay_targets.length}.
          </p>
        </>
      ) : (
        <section className="system-section">
          <strong>What to verify</strong>
          <ul className="checklist-list">
            <li>Run the backend on port 8001 so the frontend can load procedure data.</li>
            <li>Keep the model server reachable from the backend for frame analysis.</li>
            <li>Confirm `NEXT_PUBLIC_API_BASE_URL` points to `/api/v1` on your backend.</li>
          </ul>
        </section>
      )}
    </aside>
  );
}
