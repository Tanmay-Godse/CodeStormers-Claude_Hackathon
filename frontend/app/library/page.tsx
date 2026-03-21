import Link from "next/link";

const rubricFiles = [
  {
    title: "Simple Interrupted Suture Rubric",
    description:
      "The current simulation-only suturing rubric with stages, checks, errors, and overlay targets.",
    path: "open-library/rubrics/simple-interrupted-suture.json",
  },
  {
    title: "Rubric Template",
    description:
      "A starter schema for educators who want to add broader, safer simulation modules.",
    path: "open-library/rubrics/rubric-template.json",
  },
];

const benchmarkAssets = [
  {
    title: "Simulation Benchmark Manifest",
    description:
      "Starter manifest for a faculty-labeled benchmark set covering clear, unclear, unsafe, and blocked scenes.",
    path: "open-library/benchmark/simulation_benchmark_manifest.csv",
  },
  {
    title: "Benchmark Notes",
    description:
      "Contribution guidance for simulation-only imagery, labels, and reviewer expectations.",
    path: "open-library/benchmark/README.md",
  },
];

const roadmapModules = [
  "Sterile technique",
  "Wound dressing",
  "PPE donning and doffing",
  "Hand hygiene",
  "Basic instrument handling",
];

export default function LibraryPage() {
  return (
    <main className="page-shell landing-shell">
      <div className="page-inner">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>Open Learning Library</span>
          </div>
          <div className="button-row">
            <Link className="button-ghost" href="/">
              Landing
            </Link>
            <Link
              className="button-secondary"
              href="/login?role=student&next=/train/simple-interrupted-suture"
            >
              Open Trainer
            </Link>
          </div>
        </header>

        <section className="hero">
          <div className="hero-grid">
            <article className="hero-card hero-copy">
              <span className="eyebrow">Public-good layer</span>
              <h1>Share the rubric, benchmark the scenes, and broaden the safer-skills roadmap.</h1>
              <p>
                This library turns the project outward: open simulation rubrics, a starter
                benchmark manifest, and a roadmap that favors high-value, lower-risk
                training modules over flashy procedures.
              </p>
              <div className="signal-grid">
                <article className="signal-card">
                  <span>Library</span>
                  <strong>Open rubrics</strong>
                </article>
                <article className="signal-card">
                  <span>Evidence</span>
                  <strong>Benchmark starter</strong>
                </article>
                <article className="signal-card">
                  <span>Roadmap</span>
                  <strong>Safer skills first</strong>
                </article>
              </div>
            </article>

            <aside className="hero-card hero-aside">
              <div className="hero-diagram">
                <div className="diagram-chip">rubrics</div>
                <div className="diagram-chip">benchmark</div>
                <div className="diagram-chip">equity</div>
                <div className="diagram-chip">safer skills</div>
              </div>
              <div className="stat-card accent-card">
                <strong>Designed for educators and future builders</strong>
                <p className="panel-copy">
                  The app still ships one focused trainer, but the repository now carries a
                  reusable learning-library surface that can support contribution, evaluation,
                  and expansion beyond a single module.
                </p>
              </div>
            </aside>
          </div>

          <section className="feature-grid" style={{ marginTop: 20 }}>
            {rubricFiles.map((file) => (
              <article className="feature-card" key={file.path}>
                <span className="feature-index">Rubric asset</span>
                <h2>{file.title}</h2>
                <p>{file.description}</p>
                <p className="path-chip" style={{ marginTop: 16 }}>
                  {file.path}
                </p>
              </article>
            ))}
            <article className="feature-card">
              <span className="feature-index">Contribution guide</span>
              <h2>Open-library overview</h2>
              <p>
                The repo includes contribution notes for rubric authorship, benchmark labels,
                and simulation-only guardrails so future collaborators can extend the work
                responsibly.
              </p>
              <p className="path-chip" style={{ marginTop: 16 }}>
                open-library/README.md
              </p>
            </article>
          </section>

          <section className="landing-bottom-grid" style={{ marginTop: 20 }}>
            {benchmarkAssets.map((asset) => (
              <article className="feature-card atmosphere-card" key={asset.path}>
                <span className="feature-index">Benchmark starter</span>
                <h2>{asset.title}</h2>
                <p>{asset.description}</p>
                <p className="path-chip" style={{ marginTop: 16 }}>
                  {asset.path}
                </p>
              </article>
            ))}
          </section>

          <section className="review-card" style={{ marginTop: 20 }}>
            <header>
              <strong>Safer-skills roadmap</strong>
              <span className="pill">Broader access</span>
            </header>
            <p className="review-subtle" style={{ marginTop: 12 }}>
              Future expansion now prioritizes safer, broader modules that matter across
              nursing, allied health, community health, and low-resource practice settings.
            </p>
            <ul className="feedback-list" style={{ marginTop: 16 }}>
              {roadmapModules.map((module) => (
                <li key={module}>{module}</li>
              ))}
            </ul>
            <p className="path-chip" style={{ marginTop: 16 }}>
              docs/safer-skills-roadmap.md
            </p>
          </section>
        </section>
      </div>
    </main>
  );
}
