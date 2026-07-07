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
  const missingNotes = experiments.filter((experiment) => experiment.status !== "draft" && !experiment.notes.trim());
  const missingObservations = experiments.filter((experiment) => experiment.status !== "draft" && !experiment.observations.trim());
  const missingAttachments = experiments.filter((experiment) => experiment.status !== "draft" && experiment.attachmentIds.length === 0);
  const missingLots = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.required !== false && !step.reagentLotId)
      .map((step) => ({ experiment, step })),
  );
  const incompleteRequiredSteps = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.required !== false && step.status !== "done")
      .map((step) => ({ experiment, step })),
  );
  const openDeviations = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.deviation?.trim())
      .map((step) => ({ experiment, step })),
  );
  const incompleteRequiredBlocks = experiments.flatMap((experiment) =>
    experiment.authoringBlocks
      .filter((block) => block.required && !block.content.trim())
      .map((block) => ({ experiment, block })),
  );
  const expiredLotsUsed = experiments.flatMap((experiment) =>
    experiment.protocol
      .filter((step) => step.reagentLotId && lots.get(step.reagentLotId)?.lot.status === "expired")
      .map((step) => ({ experiment, step, lot: lots.get(step.reagentLotId || "") })),
  );
  const unresolvedReviews = experiments.filter((experiment) => experiment.reviewStatus === "requested" || experiment.reviewStatus === "rejected");
  const overdueReviews = experiments.filter((experiment) => experiment.reviewStatus === "requested" && experiment.reviewDueDate && Date.parse(experiment.reviewDueDate) < Date.now());
  const overdueTasks = collaborationTasks.filter((task) => task.status !== "done" && task.dueDate && Date.parse(task.dueDate) < Date.now());

  const score = Math.max(
    0,
    100 -
      unsignedComplete.length * 12 -
      staleDrafts.length * 6 -
      missingObjectives.length * 10 -
      missingNotes.length * 5 -
      missingObservations.length * 5 -
      missingAttachments.length * 5 -
      missingLots.length * 4 -
      incompleteRequiredSteps.length * 4 -
      incompleteRequiredBlocks.length * 6 -
      openDeviations.length * 5 -
      expiredLotsUsed.length * 12 -
      unresolvedReviews.length * 8 -
      overdueReviews.length * 8 -
      overdueTasks.length * 6,
  );

  const rows = [
    { label: "Unsigned Complete", count: unsignedComplete.length, note: "Completed records should be signed and locked.", path: "/dashboard" },
    { label: "Stale Drafts", count: staleDrafts.length, note: "Drafts older than 14 days need action.", path: "/dashboard" },
    { label: "Missing Objectives", count: missingObjectives.length, note: "Every experiment should state its objective.", path: "/dashboard" },
    { label: "Missing Notes", count: missingNotes.length, note: "Active/review/complete records need notebook notes.", path: "/dashboard" },
    { label: "Missing Observations", count: missingObservations.length, note: "Active/review/complete records need observations.", path: "/dashboard" },
    { label: "Missing Attachments", count: missingAttachments.length, note: "Non-draft records should attach raw data or supporting files.", path: "/dashboard" },
    { label: "Incomplete Required Steps", count: incompleteRequiredSteps.length, note: "Required protocol steps should be done before signing.", path: "/dashboard" },
    { label: "Missing Reagent Lots", count: missingLots.length, note: "Required protocol steps need material traceability.", path: "/dashboard" },
    { label: "Open Deviations", count: openDeviations.length, note: "Deviation notes should be reviewed and accepted.", path: "/dashboard" },
    { label: "Required Blocks", count: incompleteRequiredBlocks.length, note: "Required structured authoring blocks are blank.", path: "/dashboard" },
    { label: "Expired Lots Used", count: expiredLotsUsed.length, note: "Expired inventory lots were linked to protocol steps.", path: "/inventory" },
    { label: "Review Queue", count: unresolvedReviews.length, note: "Reviews need approval, rejection handling, or signature.", path: "/collaboration" },
    { label: "Overdue Reviews", count: overdueReviews.length, note: "Assigned reviews are past their due date.", path: "/collaboration" },
    { label: "Overdue Tasks", count: overdueTasks.length, note: "Open tasks are past due.", path: "/collaboration" },
  ];

  const signingReadiness = experiments
    .filter((experiment) => experiment.status !== "draft" && !experiment.locked)
    .map((experiment) => ({
      experiment,
      blockers: [
        !experiment.objective.trim() ? "objective" : "",
        !experiment.notes.trim() ? "notes" : "",
        !experiment.observations.trim() ? "observations" : "",
        experiment.attachmentIds.length === 0 ? "attachments" : "",
        experiment.protocol.some((step) => step.required !== false && step.status !== "done") ? "required steps" : "",
        experiment.protocol.some((step) => step.required !== false && !step.reagentLotId) ? "reagent lots" : "",
        experiment.protocol.some((step) => step.deviation?.trim()) ? "deviation review" : "",
        experiment.authoringBlocks.some((block) => block.required && !block.content.trim()) ? "required blocks" : "",
      ].filter(Boolean),
    }))
    .filter((item) => item.blockers.length > 0);

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
            <h2>Sign-Readiness Checks</h2>
            {signingReadiness.length === 0 && <p>No active sign-readiness blockers detected.</p>}
            {signingReadiness.slice(0, 8).map(({ experiment, blockers }) => (
              <div key={experiment.id} className="workbench-card-row">
                <div>
                  <h3>{experiment.name}</h3>
                  <p>Complete before signing: {blockers.join(", ")}.</p>
                </div>
                <button className="btn-secondary" onClick={() => navigate(`/experiments/${experiment.id}`)}>Open</button>
              </div>
            ))}
          </section>

          <section className="workbench-card">
            <h2>Deterministic AI Compliance Checks</h2>
            <p>Checks explain exact blockers now: missing fields, unsigned complete records, protocol traceability, expired lots, stale drafts, review due dates, required blocks, and deviations. Server-side AI can later draft review comments without storing secrets in the browser.</p>
          </section>
        </div>
      </div>
    </>
  );
}
