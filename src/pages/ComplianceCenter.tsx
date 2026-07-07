import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { useLabData } from "../contexts/LabDataContext";

const DAY_MS = 24 * 60 * 60 * 1000;

export function ComplianceCenter() {
  const navigate = useNavigate();
  const { experimentDetails, inventoryItems, collaborationTasks } = useLabData();
  const experiments = Object.values(experimentDetails);
  const lots = new Map(inventoryItems.flatMap((item) => item.lots.map((lot) => [lot.id, { item, lot }] as const)));

  const unsignedComplete = experiments.filter((experiment) => experiment.status === "complete" && !experiment.locked);
  const staleDrafts = experiments.filter((experiment) => experiment.status === "draft" && experiment.modifiedAt && Date.now() - Date.parse(experiment.modifiedAt) > 14 * DAY_MS);
  const missingObjectives = experiments.filter((experiment) => !experiment.objective.trim());
  const missingLots = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.required !== false && !step.reagentLotId)
      .map((step) => ({ experiment, step })),
  );
  const expiredLotsUsed = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.reagentLotId && lots.get(step.reagentLotId)?.lot.status === "expired")
      .map((step) => ({ experiment, step, lot: lots.get(step.reagentLotId || "") })),
  );
  const unresolvedReviews = experiments.filter((experiment) => experiment.reviewStatus === "requested" || experiment.reviewStatus === "rejected");
  const overdueTasks = collaborationTasks.filter((task) => task.status !== "done" && task.dueDate && Date.parse(task.dueDate) < Date.now());

  const score = Math.max(
    0,
    100 - unsignedComplete.length * 12 - staleDrafts.length * 6 - missingObjectives.length * 10 - missingLots.length * 4 - expiredLotsUsed.length * 12 - unresolvedReviews.length * 8 - overdueTasks.length * 6,
  );

  const rows = [
    { label: "Unsigned Complete", count: unsignedComplete.length, note: "Completed records should be signed and locked.", path: "/dashboard" },
    { label: "Stale Drafts", count: staleDrafts.length, note: "Drafts older than 14 days need action.", path: "/dashboard" },
    { label: "Missing Objectives", count: missingObjectives.length, note: "Every experiment should state its objective.", path: "/dashboard" },
    { label: "Missing Reagent Lots", count: missingLots.length, note: "Required protocol steps need material traceability.", path: "/dashboard" },
    { label: "Expired Lots Used", count: expiredLotsUsed.length, note: "Expired inventory lots were linked to protocol steps.", path: "/inventory" },
    { label: "Review Queue", count: unresolvedReviews.length, note: "Reviews need approval, rejection handling, or signature.", path: "/collaboration" },
    { label: "Overdue Tasks", count: overdueTasks.length, note: "Open tasks are past due.", path: "/collaboration" },
  ];

  return (
    <>
      <div className="topbar">
        <h1>Compliance Center</h1>
      </div>
      <div className="workbench-content">
        <div className="score-list">
          <div className="score-card"><span>Audit Health</span><strong>{score}</strong><small>Deterministic readiness score</small></div>
          <div className="score-card"><span>Open Issues</span><strong>{rows.reduce((sum, row) => sum + row.count, 0)}</strong><small>Records needing attention</small></div>
          <div className="score-card"><span>Signed</span><strong>{experiments.filter((experiment) => experiment.locked).length}</strong><small>Locked records</small></div>
          <div className="score-card"><span>Reviews</span><strong>{unresolvedReviews.length}</strong><small>Pending or rejected</small></div>
        </div>

        <div className="workbench-list">
          {rows.map((row) => (
            <article key={row.label} className="workbench-card">
              <div className="workbench-card-row">
                <div>
                  <h2>{row.label}</h2>
                  <p>{row.note}</p>
                </div>
                <span className={`workbench-pill${row.count > 0 ? " primary" : ""}`}>{row.count}</span>
              </div>
              {row.count > 0 && (
                <div className="workbench-actions">
                  <button className="btn-secondary" onClick={() => navigate(row.path)}>Review</button>
                </div>
              )}
            </article>
          ))}

          <section className="workbench-card">
            <h2>Mock AI Compliance Checks</h2>
            <p>Checks are deterministic for now: missing objectives, unsigned complete records, protocol traceability, expired lots, and stale drafts. This can later become a secure server-side AI review once the backend supports secrets.</p>
          </section>
        </div>
      </div>
    </>
  );
}
