import Link from "next/link";

export default function Home() {
  return (
    <main className="page-shell landing-shell">
      <div className="page-inner">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>AI Clinical Skills Coach</span>
          </div>
          <span className="pill">Simulation bay: suturing edition</span>
        </header>

        <section className="hero">
          <div className="hero-grid">
            <article className="hero-card hero-copy">
              <span className="eyebrow">Studio mode</span>
              <h1>Turn a kitchen-counter practice setup into a cinematic training bay.</h1>
              <p>
                A webcam, a foam pad or orange, and one sharply scoped procedure become a
                guided suturing loop with overlays, AI feedback, and a review deck built
                for repetition instead of clutter.
              </p>
              <div className="button-row">
                <Link
                  className="button-primary"
                  href="/login?role=student&next=/train/simple-interrupted-suture"
                >
                  Launch Suturing Bay
                </Link>
                <Link
                  className="button-secondary"
                  href="/login?role=admin&next=/admin/reviews"
                >
                  Open Admin Queue
                </Link>
                <Link className="button-secondary" href="/library">
                  Open Learning Library
                </Link>
                <a className="button-secondary" href="#how-it-works">
                  Explore the System
                </a>
              </div>
              <div className="signal-grid">
                <article className="signal-card">
                  <span>Focus</span>
                  <strong>1 procedure</strong>
                </article>
                <article className="signal-card">
                  <span>Input</span>
                  <strong>Camera + overlays</strong>
                </article>
                <article className="signal-card">
                  <span>Output</span>
                  <strong>AI debrief + quiz</strong>
                </article>
                <article className="signal-card">
                  <span>Access</span>
                  <strong>Equity mode</strong>
                </article>
              </div>
            </article>

            <aside className="hero-card hero-aside">
              <div className="hero-diagram">
                <div className="diagram-chip">capture</div>
                <div className="diagram-chip">calibrate</div>
                <div className="diagram-chip">analyze</div>
                <div className="diagram-chip">retry</div>
                <div className="diagram-chip">review</div>
              </div>
              <div className="stat-card accent-card">
                <strong>Built like a focused control room</strong>
                <p className="panel-copy">
                  The interface treats each practice attempt like a logged simulation
                  event, not a generic chat prompt. Camera framing, stage progress, and
                  review all stay visible at once.
                </p>
              </div>
              <div className="stat-rail">
                <div className="stat-card compact-card">
                  <span className="metric-kicker">Frontend</span>
                  <strong>Next.js</strong>
                  <p className="panel-copy">Camera, calibration, overlays, review cache.</p>
                </div>
                <div className="stat-card compact-card">
                  <span className="metric-kicker">Backend</span>
                  <strong>FastAPI</strong>
                  <p className="panel-copy">Rubrics, scoring, analysis, debrief generation.</p>
                </div>
              </div>
            </aside>
          </div>

          <section className="marquee-band" aria-label="Product framing">
            <span>simulation-only</span>
            <span>simple interrupted suture</span>
            <span>camera-led coaching</span>
            <span>overlay-targeted guidance</span>
            <span>session memory</span>
            <span>review-first learning</span>
          </section>

          <div className="feature-grid feature-grid-four" id="how-it-works">
            <article className="feature-card">
              <span className="feature-index">01</span>
              <h2>One believable procedure, treated with depth</h2>
              <p>
                Every screen is tuned around simple interrupted suturing so stage labels,
                scoring, targets, and review language all stay specific and teachable.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-index">02</span>
              <h2>A trainer view that feels instrumented</h2>
              <p>
                The camera sits at the center, while calibration, stage controls, and live
                coaching readouts frame the attempt like a deliberate practice console.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-index">03</span>
              <h2>Review that reads like a study artifact</h2>
              <p>
                The session timeline, debrief, and quiz are designed to be revisited after
                practice, not just glanced at once before closing the tab.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-index">04</span>
              <h2>Access settings built for outside-the-lab practice</h2>
              <p>
                Equity mode now adds multilingual feedback, audio coaching, low-bandwidth
                capture, cheap-phone compatibility, and offline-first practice logging.
              </p>
            </article>
          </div>

          <section className="landing-bottom-grid">
            <article className="feature-card atmosphere-card">
              <span className="feature-index">Practice mood</span>
              <h2>Calm, technical, and visibly intentional</h2>
              <p>
                Instead of default dashboard styling, the interface leans into warm lab
                lighting, technical labels, and strong spatial cues so the app feels like
                a training environment with purpose.
              </p>
            </article>
            <article className="feature-card atmosphere-card">
              <span className="feature-index">Safety frame</span>
              <h2>Always simulation-only</h2>
              <p>
                The product is explicitly designed for practice on oranges, bananas, or
                foam pads. It supports deliberate repetition and instruction, not real
                patient care or clinical decision-making.
              </p>
            </article>
            <article className="feature-card atmosphere-card">
              <span className="feature-index">Open library</span>
              <h2>Share rubrics and benchmark starter assets</h2>
              <p>
                The repo now includes a public rubric library, a benchmark manifest starter,
                and a safer-skills roadmap so the social benefit extends beyond this single
                app build.
              </p>
            </article>
            <article className="feature-card atmosphere-card">
              <span className="feature-index">Safer roadmap</span>
              <h2>Expand into broader, lower-risk skills first</h2>
              <p>
                Future modules now prioritize sterile technique, wound dressing, PPE,
                hand hygiene, and basic instrument handling ahead of flashier procedures.
              </p>
            </article>
          </section>

          <p className="fine-print landing-note">
            Built for simulated deliberate practice only. This product does not replace
            instructors, real-patient training, or clinical judgment.
          </p>
        </section>
      </div>
    </main>
  );
}
