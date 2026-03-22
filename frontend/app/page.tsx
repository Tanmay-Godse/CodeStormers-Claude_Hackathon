import Link from "next/link";

import { HomeSystemStatus } from "@/components/HomeSystemStatus";

const workflowCards = [
  {
    index: "01",
    title: "Load the trainer from the backend",
    body:
      "The landing page now checks FastAPI health and loads the suturing procedure before you start, so the UI reflects real system state instead of placeholder copy.",
  },
  {
    index: "02",
    title: "Capture one frame for the current stage",
    body:
      "The training view stays focused on the active stage, camera framing, overlay targets, and the next coaching decision.",
  },
  {
    index: "03",
    title: "Review the saved session",
    body:
      "Every analyzed attempt is stored locally and fed into the review page for a debrief, drill plan, quiz, and timeline of corrections.",
  },
];

const setupChecklist = [
  "A webcam or phone camera aimed at an orange, banana, foam pad, or bench model",
  "The FastAPI backend running with the suturing procedure and review routes",
  "The model server reachable by the backend for frame analysis and debrief generation",
  "A student or admin sign-in to enter training or the faculty review queue",
];

export default function Home() {
  return (
    <main className="page-shell landing-shell">
      <div className="page-inner">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>AI Clinical Skills Coach</span>
          </div>
          <span className="pill">Simple interrupted suture</span>
        </header>

        <section className="hero">
          <div className="hero-grid">
            <article className="hero-card hero-copy hero-copy-compact">
              <span className="eyebrow">Guided practice</span>
              <h1>Practice one suturing step at a time with live AI coaching.</h1>
              <p>
                This trainer is built around one real loop: load the suturing rubric from
                the backend, capture a single frame, get stage-specific feedback, and save
                the session for review.
              </p>
              <div className="button-row">
                <Link
                  className="button-primary"
                  href="/login?role=student&next=/train/simple-interrupted-suture"
                >
                  Start Training
                </Link>
                <Link
                  className="button-secondary"
                  href="/login?role=admin&next=/admin/reviews"
                >
                  Open Admin Queue
                </Link>
                <Link className="button-secondary" href="/library">
                  Open Library
                </Link>
                <a className="button-secondary" href="#how-it-works">
                  How It Works
                </a>
              </div>
              <div className="signal-grid">
                <article className="signal-card">
                  <span>Procedure</span>
                  <strong>Suturing trainer</strong>
                </article>
                <article className="signal-card">
                  <span>Input</span>
                  <strong>Camera + single frame</strong>
                </article>
                <article className="signal-card">
                  <span>Feedback</span>
                  <strong>Live stage coaching</strong>
                </article>
                <article className="signal-card">
                  <span>Review</span>
                  <strong>Debrief + drill plan</strong>
                </article>
              </div>
            </article>

            <HomeSystemStatus />
          </div>

          <section className="marquee-band" aria-label="Product framing">
            <span>backend health</span>
            <span>procedure metadata</span>
            <span>camera-led capture</span>
            <span>overlay guidance</span>
            <span>session review</span>
            <span>simulation only</span>
          </section>

          <div className="feature-grid" id="how-it-works">
            {workflowCards.map((card) => (
              <article className="feature-card" key={card.index}>
                <span className="feature-index">{card.index}</span>
                <h2>{card.title}</h2>
                <p>{card.body}</p>
              </article>
            ))}
          </div>

          <section className="landing-bottom-grid">
            <article className="feature-card">
              <span className="feature-index">Before you start</span>
              <h2>What you need on the table</h2>
              <ul className="checklist-list" style={{ marginTop: 18 }}>
                {setupChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="feature-card">
              <span className="feature-index">Why this UI changed</span>
              <h2>Less pitch deck, more working trainer</h2>
              <p>
                The landing page now reflects the real backend workflow, the trainer focuses
                on the active step, and the review page centers the recorded practice data
                instead of implementation notes.
              </p>
            </article>
          </section>

          <p className="fine-print landing-note">
            Built for simulated deliberate practice only. It does not replace instructors,
            real-patient training, or clinical judgment.
          </p>
        </section>
      </div>
    </main>
  );
}
