import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "../components/icons";
import "./Landing.css";

const capabilities = [
  {
    eyebrow: "Capture",
    title: "Keep every experiment connected",
    body: "Bring objectives, protocol steps, observations, raw files, and structured results into one traceable record.",
  },
  {
    eyebrow: "Coordinate",
    title: "Move work forward together",
    body: "Assign reviews, surface due work, track inventory lots, and give every collaborator a clear next step.",
  },
  {
    eyebrow: "Defend",
    title: "Make readiness visible",
    body: "Built-in checks reveal missing notes, incomplete steps, unlinked lots, and unsigned records before handoff.",
  },
];

const workflow = [
  ["01", "Plan", "Start with a concise objective, linked project, due date, and a repeatable protocol."],
  ["02", "Run", "Record the real work as it happens—steps, lots, files, observations, and deviations."],
  ["03", "Review", "Route a record for review, resolve readiness gaps, then create an accountable signature."],
];

export function Landing() {
  const navigate = useNavigate();
  // Keep the acquisition page dependency-free: it can render before Firebase
  // loads. The login route restores an existing authenticated session.
  const primaryLabel = "Start your lab workspace";
  const primaryPath = "/login";

  useEffect(() => {
    document.title = "LabOS | Electronic lab notebook";
  }, []);

  return (
    <div className="landing-page">
      <a className="landing-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="landing-header">
        <button className="landing-brand" type="button" onClick={() => navigate("/")} aria-label="LabOS home">
          <span className="landing-brand-mark" aria-hidden="true"><LogoMark size={19} /></span>
          <span>LabOS</span>
        </button>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#workflow">Workflow</a>
          <a href="#capabilities">Capabilities</a>
          <button className="landing-sign-in" type="button" onClick={() => navigate("/login")}>
            Sign in
          </button>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section id="landing-hero" className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero-copy">
          <p className="landing-kicker">THE RESEARCH OPERATING SYSTEM</p>
          <h1 id="landing-hero-title">Make the next scientific decision easier to trust.</h1>
          <p className="landing-subhead">
            LabOS brings experimental records, protocols, inventory traceability, collaboration, and readiness checks into one calm workspace.
          </p>
          <div className="landing-actions">
            <button className="landing-primary" type="button" onClick={() => navigate(primaryPath)}>{primaryLabel} <span aria-hidden="true">→</span></button>
            <a className="landing-secondary" href="#workflow">See how it works</a>
          </div>
          <p className="landing-trust-line">Designed for labs that need a clearer path from first note to review-ready record.</p>
        </div>

        <aside className="landing-product-preview" aria-labelledby="preview-experiment-title">
          <div className="preview-topline">
            <span className="preview-dot" aria-hidden="true" />
            <span>Experiment readiness</span>
            <span className="preview-status">On track</span>
          </div>
          <div className="preview-title-row">
            <div>
              <strong id="preview-experiment-title">ELISA cytokine panel</strong>
              <span>EXP-2026-0142 · Immunotherapy</span>
            </div>
            <span className="preview-pill">In review</span>
          </div>
          <div className="preview-progress" role="progressbar" aria-label="Experiment readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={84}>
            <span />
          </div>
          <div className="preview-grid">
            <div><span>Protocol</span><strong>8 / 8 steps</strong></div>
            <div><span>Traceability</span><strong>4 lots linked</strong></div>
            <div><span>Evidence</span><strong>3 files attached</strong></div>
            <div><span>Readiness</span><strong>Ready for review</strong></div>
          </div>
          <div className="preview-audit">
            <span className="preview-check">✓</span>
            <div><strong>Record is ready for reviewer attention</strong><span>All required notebook fields are present.</span></div>
          </div>
        </aside>
        </section>

        <section className="landing-proof" aria-label="Product principles">
          <div><strong>One source of truth</strong><span>from planning to report</span></div>
          <div><strong>Human-centered controls</strong><span>for labs, not spreadsheets</span></div>
          <div><strong>Built for momentum</strong><span>without losing context</span></div>
        </section>

        <section id="capabilities" className="landing-section landing-capabilities">
        <div className="landing-section-heading">
          <p className="landing-kicker">LESS ADMIN, MORE SCIENCE</p>
          <h2>Everything your team needs to turn work into knowledge.</h2>
        </div>
        <div className="landing-capability-grid">
          {capabilities.map((capability) => (
            <article key={capability.eyebrow} className="landing-capability-card">
              <span>{capability.eyebrow}</span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </article>
          ))}
        </div>
        </section>

        <section id="workflow" className="landing-section landing-workflow">
        <div className="landing-section-heading">
          <p className="landing-kicker">A BETTER RESEARCH LOOP</p>
          <h2>From blank page to review-ready in a single flow.</h2>
        </div>
        <ol className="landing-workflow-list">
          {workflow.map(([number, title, body]) => (
            <li key={number}>
              <span>{number}</span>
              <div><h3>{title}</h3><p>{body}</p></div>
            </li>
          ))}
        </ol>
        </section>

        <section className="landing-cta">
          <p className="landing-kicker">READY WHEN YOUR NEXT EXPERIMENT IS</p>
          <h2>Give your lab a workspace that respects the work.</h2>
          <button className="landing-primary" type="button" onClick={() => navigate(primaryPath)}>{primaryLabel} <span aria-hidden="true">→</span></button>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} LabOS</span>
        <nav aria-label="Footer navigation">
          <button type="button" onClick={() => navigate("/login")}>Sign in</button>
        </nav>
      </footer>
    </div>
  );
}
