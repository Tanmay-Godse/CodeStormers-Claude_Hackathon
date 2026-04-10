"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppFrame } from "@/components/AppFrame";
import {
  DashboardIcon,
  type DashboardIconName,
} from "@/components/DashboardIcon";
import { getProcedure } from "@/lib/api";
import { buildSharedSidebarItems, DEFAULT_TRAINING_HREF } from "@/lib/appShell";
import { clearAuthUser } from "@/lib/storage";
import type { ProcedureDefinition } from "@/lib/types";
import { useWorkspaceUser } from "@/lib/useWorkspaceUser";

const LIBRARY_PROCEDURE_ID = "simple-interrupted-suture";

const fallbackProcedure: ProcedureDefinition = {
  id: "simple-interrupted-suture",
  title: "Simple Interrupted Suture",
  simulation_only: true,
  practice_surface: "Any fruit or foam pad",
  named_overlay_targets: [
    {
      id: "surface_center",
      label: "Practice surface",
      description: "Center the practice surface inside the framing area.",
      u: 0.5,
      v: 0.5,
      color: "#0f6c82",
    },
    {
      id: "needle_driver_grip",
      label: "Driver grip",
      description: "Where the needle driver grip should stay stable.",
      u: 0.28,
      v: 0.3,
      color: "#2e8b57",
    },
    {
      id: "entry_point",
      label: "Entry point",
      description: "The expected starting point for the first bite.",
      u: 0.38,
      v: 0.48,
      color: "#d97706",
    },
    {
      id: "needle_angle",
      label: "Needle angle",
      description: "Visual guide for a more perpendicular entry angle.",
      u: 0.44,
      v: 0.38,
      color: "#c2410c",
    },
    {
      id: "exit_point",
      label: "Exit point",
      description: "Where the needle tip should emerge on the far side.",
      u: 0.62,
      v: 0.49,
      color: "#7c3aed",
    },
    {
      id: "thread_path",
      label: "Thread path",
      description: "Keep the suture line visible and controlled as you pull through.",
      u: 0.56,
      v: 0.56,
      color: "#0f766e",
    },
    {
      id: "knot_center",
      label: "Knot center",
      description: "Target spot for a centered final knot.",
      u: 0.5,
      v: 0.52,
      color: "#b91c1c",
    },
    {
      id: "wound_line_center",
      label: "Wound line center",
      description: "The midline that the stitch should visually align with.",
      u: 0.5,
      v: 0.48,
      color: "#1d4ed8",
    },
  ],
  stages: [
    {
      id: "setup",
      title: "Setup",
      objective: "Prepare the surface and tools so the practice field is clearly framed.",
      visible_checks: [
        "practice surface visible",
        "needle driver visible",
        "suture visible",
      ],
      common_errors: [
        "surface out of frame",
        "tool missing",
        "dark or blurry image",
      ],
      overlay_targets: ["surface_center"],
      score_weight: 10,
    },
    {
      id: "grip",
      title: "Grip",
      objective: "Hold the needle driver with a stable grip before entry.",
      visible_checks: ["needle driver visible", "stable hand position"],
      common_errors: ["grip too close to the tip", "unstable wrist posture"],
      overlay_targets: ["needle_driver_grip"],
      score_weight: 10,
    },
    {
      id: "needle_entry",
      title: "Needle Entry",
      objective: "Approach the surface at a confident entry angle for the first bite.",
      visible_checks: [
        "entry point visible",
        "needle angle acceptable",
        "instrument aligned with the target",
      ],
      common_errors: [
        "angle too shallow",
        "entry point drifted off target",
        "needle not aligned with the practice line",
      ],
      overlay_targets: ["entry_point", "needle_angle"],
      score_weight: 15,
    },
    {
      id: "needle_exit",
      title: "Needle Exit",
      objective: "Complete the arc so the needle exits across the wound line.",
      visible_checks: [
        "exit point visible",
        "arc completed across the wound line",
      ],
      common_errors: [
        "needle exits too early",
        "exit point not visible",
        "arc incomplete",
      ],
      overlay_targets: ["exit_point", "wound_line_center"],
      score_weight: 15,
    },
    {
      id: "pull_through",
      title: "Pull Through",
      objective: "Pull the suture through without losing control of tension.",
      visible_checks: ["thread visible", "tension controlled"],
      common_errors: [
        "thread tangled",
        "tension too loose",
        "tension too aggressive",
      ],
      overlay_targets: ["thread_path"],
      score_weight: 10,
    },
    {
      id: "knot_tie",
      title: "Knot Tie",
      objective: "Form a centered knot that looks neat in the practice field.",
      visible_checks: ["knot visible", "knot centered", "thread tails controlled"],
      common_errors: [
        "knot off center",
        "over-tightened knot",
        "thread twisting during tie",
      ],
      overlay_targets: ["knot_center"],
      score_weight: 20,
    },
    {
      id: "final_check",
      title: "Final Check",
      objective:
        "Review the finished stitch for overall presentation and alignment.",
      visible_checks: [
        "approximation looks presentable",
        "final frame is clear",
        "knot and wound line are visible",
      ],
      common_errors: [
        "final frame blurry",
        "stitch looks misaligned",
        "knot obscures the field",
      ],
      overlay_targets: ["wound_line_center", "knot_center"],
      score_weight: 20,
    },
  ],
};

const benchmarkLabels = [
  {
    detail: "The frame is clear and the current stage meets the visible objective.",
    label: "Clear pass",
  },
  {
    detail: "The frame is clear enough to grade, but the step needs another rep.",
    label: "Clear retry",
  },
  {
    detail: "The camera view is too dark, blurry, cropped, or unstable to trust.",
    label: "Unclear frame",
  },
  {
    detail: "The technique shown is unsafe for the simulated task and should be corrected.",
    label: "Unsafe technique",
  },
  {
    detail: "The image looks like a real-patient or non-simulation scene and must be blocked.",
    label: "Blocked real-patient risk",
  },
];

const simulationGuardrails = [
  "Use only a simulation surface. No real-patient or live-clinical imagery.",
  "Keep identifying information and unrelated background items out of frame.",
  "Use labels that help learning, not just model scoring.",
  "If a frame is disputed, prefer faculty review instead of guessing.",
];

const sourceAssets: Array<{
  description: string;
  icon: DashboardIconName;
  path: string;
  title: string;
}> = [
  {
    description: "The active rubric the trainer uses for the suturing demo.",
    icon: "tree",
    path: "open-library/rubrics/simple-interrupted-suture.json",
    title: "Live suturing rubric",
  },
  {
    description: "Starter benchmark labels for clear, unclear, unsafe, and blocked frames.",
    icon: "analytics",
    path: "open-library/benchmark/simulation_benchmark_manifest.csv",
    title: "Benchmark manifest",
  },
  {
    description: "Simulation-only notes for adding new library assets later.",
    icon: "book",
    path: "open-library/README.md",
    title: "Open library notes",
  },
];

function titleCaseStage(stageId: string) {
  return stageId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function LibraryPage() {
  const router = useRouter();
  const { hydrated, sessions, user } = useWorkspaceUser();
  const [procedure, setProcedure] = useState<ProcedureDefinition>(fallbackProcedure);
  const [isLoadingProcedure, setIsLoadingProcedure] = useState(true);
  const [procedureError, setProcedureError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && user?.isDeveloper) {
      router.replace("/developer/approvals");
      return;
    }

    if (!hydrated) {
      return;
    }

    let cancelled = false;

    async function loadProcedure() {
      try {
        const nextProcedure = await getProcedure(LIBRARY_PROCEDURE_ID);
        if (!cancelled) {
          setProcedure(nextProcedure);
          setProcedureError(null);
        }
      } catch {
        if (!cancelled) {
          setProcedure(fallbackProcedure);
          setProcedureError(
            "Using the bundled guide summary because the live rubric could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProcedure(false);
        }
      }
    }

    void loadProcedure();

    return () => {
      cancelled = true;
    };
  }, [hydrated, router, user?.isDeveloper]);

  const latestReviewHref = useMemo(() => {
    const latestSession = sessions[0];
    return latestSession ? `/review/${latestSession.id}` : DEFAULT_TRAINING_HREF;
  }, [sessions]);
  const hasSavedSession = latestReviewHref !== DEFAULT_TRAINING_HREF;

  const totalWeight = useMemo(
    () => procedure.stages.reduce((total, stage) => total + stage.score_weight, 0),
    [procedure.stages],
  );

  const highValueStages = useMemo(
    () =>
      [...procedure.stages]
        .sort((left, right) => right.score_weight - left.score_weight)
        .slice(0, 3),
    [procedure.stages],
  );

  const recurringMisses = useMemo(
    () =>
      [...new Set(procedure.stages.flatMap((stage) => stage.common_errors))].slice(0, 6),
    [procedure.stages],
  );

  const setupChecklist = useMemo(() => {
    const setupStage = procedure.stages.find((stage) => stage.id === "setup");

    return [
      `Use a ${procedure.practice_surface.toLowerCase()} simulation surface.`,
      "Keep the practice surface, needle driver, and suture fully visible.",
      "Use bright, steady lighting and avoid dark or blurry frames.",
      "Frame only the simulation field before pressing Check My Step.",
      ...(setupStage?.visible_checks ?? []).map((item) => `Verify ${item}.`),
    ];
  }, [procedure]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  const userName = user?.name?.trim() || "Student Clinician";

  if (!hydrated) {
    return (
      <AppFrame
        brandSubtitle="Live practice guide"
        pageTitle="Library"
        sidebarItems={buildSharedSidebarItems({ active: "library", userRole: null })}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Preparing Library</span>
          <h2>Loading the practice guide.</h2>
          <p>We are syncing the signed-in account and the saved review links first.</p>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      brandSubtitle="Live practice guide"
      footerPrimaryAction={{
        href: DEFAULT_TRAINING_HREF,
        icon: "play",
        label: "Start Live Session",
        strong: true,
      }}
      footerSecondaryActions={[
        {
          href: latestReviewHref,
          icon: "review",
          label: hasSavedSession ? "Latest Review" : "Open Trainer",
        },
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Library"
      sidebarItems={buildSharedSidebarItems({
        active: "library",
        isDeveloper: user?.isDeveloper === true,
        reviewHref: latestReviewHref,
        userRole: user?.role ?? null,
      })}
      statusPill={{
        icon: "book",
        label: isLoadingProcedure ? "loading guide" : "practice guide",
      }}
      topActions={[
        { href: latestReviewHref, label: hasSavedSession ? "Latest Review" : "Open Trainer" },
        { href: DEFAULT_TRAINING_HREF, label: "Open Trainer", strong: true },
      ]}
      userName={userName}
    >
      <section className="dashboard-hero library-hero">
        <div>
          <span className="dashboard-kicker">Practice Library</span>
          <h1>Know exactly what the trainer is looking for before you start.</h1>
          <p>
            This page now acts like a quick procedure guide: how to set up the
            simulation, what each stage is checking, what mistakes to avoid, and how
            the camera frames get judged.
          </p>
        </div>
        <div className="dashboard-hero-meta">
          <span>{procedure.title}</span>
          <span>{procedure.stages.length} guided stages</span>
          <Link href={DEFAULT_TRAINING_HREF}>Open live session</Link>
        </div>
      </section>

      {procedureError ? (
        <article className="dashboard-card library-inline-notice">
          <div className="dashboard-card-header">
            <div>
              <span className="dashboard-card-eyebrow">Guide Status</span>
              <h2>Bundled library view</h2>
            </div>
            <span className="dashboard-meta-chip">fallback</span>
          </div>
          <p className="library-lead-copy">{procedureError}</p>
        </article>
      ) : null}

      <section className="library-summary-grid">
        <article className="dashboard-card dashboard-kpi-card library-summary-card">
          <span>Practice surface</span>
          <strong>{procedure.practice_surface}</strong>
          <p>Keep only the simulation field inside frame.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card library-summary-card">
          <span>Rubric weight</span>
          <strong>{totalWeight}</strong>
          <p>Total weighted score points across the guided flow.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card library-summary-card">
          <span>Guide points</span>
          <strong>{procedure.named_overlay_targets.length}</strong>
          <p>Named reference targets the trainer can reason about.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card library-summary-card">
          <span>Highest focus</span>
          <strong>{highValueStages[0]?.title ?? "Needle Entry"}</strong>
          <p>The biggest scoring stage deserves the cleanest rep.</p>
        </article>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-left-column">
          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Before You Start</span>
                <h2>Set up one clean simulation field.</h2>
              </div>
              <span className="dashboard-meta-chip">camera prep</span>
            </div>
            <ul className="library-checklist">
              {setupChecklist.map((item) => (
                <li key={item}>
                  <DashboardIcon className="library-list-icon" name="target" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Stage Guide</span>
                <h2>What each step needs to show.</h2>
              </div>
              <span className="dashboard-meta-chip">{procedure.stages.length} stages</span>
            </div>
            <div className="library-stage-list">
              {procedure.stages.map((stage) => (
                <article className="library-stage-card" key={stage.id}>
                  <header className="library-stage-header">
                    <div>
                      <span className="dashboard-card-eyebrow">
                        {titleCaseStage(stage.id)}
                      </span>
                      <h3>{stage.title}</h3>
                    </div>
                    <span className="library-stage-meta">{stage.score_weight} pts</span>
                  </header>
                  <p className="library-stage-objective">{stage.objective}</p>
                  <div className="library-stage-detail-grid">
                    <div className="library-detail-block">
                      <span>What should be visible</span>
                      <ul className="library-detail-list">
                        {stage.visible_checks.map((check) => (
                          <li key={`${stage.id}:${check}`}>{check}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="library-detail-block">
                      <span>What usually goes wrong</span>
                      <ul className="library-detail-list">
                        {stage.common_errors.map((issue) => (
                          <li key={`${stage.id}:${issue}`}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>

        <div className="dashboard-right-column">
          <article className="dashboard-card library-note-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Grading Focus</span>
                <h2>Where the score moves fastest.</h2>
              </div>
              <span className="dashboard-meta-chip">high-value stages</span>
            </div>
            <div className="library-chip-row">
              {highValueStages.map((stage) => (
                <span className="dashboard-meta-chip" key={stage.id}>
                  {stage.title} · {stage.score_weight} pts
                </span>
              ))}
            </div>
            <p className="library-lead-copy">
              The biggest scoring jumps happen when the stitch is clearly framed and the
              bite, exit, and final knot look intentional in one steady view.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Benchmark Labels</span>
                <h2>How the frame gets categorized.</h2>
              </div>
              <span className="dashboard-meta-chip">review logic</span>
            </div>
            <div className="library-benchmark-list">
              {benchmarkLabels.map((item) => (
                <article className="library-benchmark-card" key={item.label}>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Simulation Guardrails</span>
                <h2>Keep the demo safe and valid.</h2>
              </div>
              <span className="dashboard-meta-chip">simulation only</span>
            </div>
            <ul className="library-guardrail-list">
              {simulationGuardrails.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Most Common Misses</span>
                <h2>What to correct first if a rep fails.</h2>
              </div>
              <span className="dashboard-meta-chip">quick scan</span>
            </div>
            <ul className="library-guardrail-list">
              {recurringMisses.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Source Assets</span>
                <h2>Files behind this guide.</h2>
              </div>
              <span className="dashboard-meta-chip">open library</span>
            </div>
            <div className="library-resource-grid">
              {sourceAssets.map((asset) => (
                <article className="library-resource-card" key={asset.path}>
                  <div className="library-resource-head">
                    <div className="library-resource-icon">
                      <DashboardIcon name={asset.icon} />
                    </div>
                    <div>
                      <strong>{asset.title}</strong>
                      <p>{asset.description}</p>
                    </div>
                  </div>
                  <span className="library-path">{asset.path}</span>
                </article>
              ))}
            </div>
          </article>

          <article className="dashboard-card" id="library-next-steps">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Next Step</span>
                <h2>Take the guide back into practice.</h2>
              </div>
              <Link className="dashboard-inline-link" href="/dashboard">
                Back to dashboard
              </Link>
            </div>
            <p className="library-lead-copy">
              Start one live session, aim for one clean rep, then open the latest
              review and compare what the coach saw against this guide.
            </p>
            <div className="dashboard-frame-actions">
              <Link className="dashboard-primary-button" href={DEFAULT_TRAINING_HREF}>
                Start live session
              </Link>
              <Link className="dashboard-action-pill" href={latestReviewHref}>
                {hasSavedSession ? "Open latest review" : "Open trainer"}
              </Link>
            </div>
          </article>
        </div>
      </div>
    </AppFrame>
  );
}
