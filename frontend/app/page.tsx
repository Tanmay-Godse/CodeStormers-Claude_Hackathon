import Link from "next/link";

export default function Home() {
  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>AI Clinical Skills Coach</span>
          </div>
          <span className="pill">Simulation-only training product</span>
        </header>

        <section className="hero">
          <div className="hero-grid">
            <article className="hero-card hero-copy">
              <span className="pill">Phase 3 demo-ready trainer</span>
              <h1>Practice a simple interrupted suture with calm, structured coaching.</h1>
              <p>
                This version turns a webcam into a stable simulation-first trainer for
                medical students practicing on an orange, banana, or foam pad. It stays
                tightly scoped to one procedure, one polished camera workflow, and one
                study-friendly review page.
              </p>
              <div className="button-row">
                <Link
                  className="button-primary"
                  href="/train/simple-interrupted-suture"
                >
                  Start Training
                </Link>
                <a className="button-secondary" href="#how-it-works">
                  See the Flow
                </a>
              </div>
              <p className="fine-print">
                Built for simulated deliberate practice only. This product does not replace
                instructors, real-patient training, or clinical judgment.
              </p>
            </article>

            <aside className="hero-card hero-aside">
              <div className="stat-card">
                <strong>Hero workflow</strong>
                <p className="panel-copy">
                  Frame the practice surface, capture a step, receive model coaching,
                  retry once, and finish with a stored review summary.
                </p>
              </div>
              <div className="stat-card">
                <strong>Technical boundary</strong>
                <p className="panel-copy">
                  Next.js owns camera and overlays. FastAPI owns the procedure contract,
                  scoring, and AI-backed analysis and debrief generation.
                </p>
              </div>
              <div className="stat-card">
                <strong>Phase 3 reliability</strong>
                <p className="panel-copy">
                  Session review is cached locally, debrief generation has a fallback path,
                  and the app is tuned for repeatable demos instead of new feature churn.
                </p>
              </div>
            </aside>
          </div>

          <div className="feature-grid" id="how-it-works">
            <article className="feature-card">
              <h2>One believable procedure</h2>
              <p>
                The app stays focused on simple interrupted suturing so the UI, scoring, and
                coaching all feel coherent instead of spread thin.
              </p>
            </article>
            <article className="feature-card">
              <h2>Live mock coaching loop</h2>
              <p>
                The frontend calls the live FastAPI service for frame analysis, deterministic
                scoring, and session review generation.
              </p>
            </article>
            <article className="feature-card">
              <h2>Review that feels educational</h2>
              <p>
                Each attempt is stored locally so the review page can show progress, stage
                outcomes, and a study-ready debrief without regenerating the same summary
                on every visit.
              </p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
