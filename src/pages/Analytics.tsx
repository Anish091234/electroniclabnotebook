import { useMemo } from "react";
import "./Dashboard.css";
import "./Analytics.css";
import { useLabData } from "../contexts/LabDataContext";

export function Analytics() {
  const { experiments, experimentDetails, protocolTemplates, inventoryItems, sampleRecords, projectRecords, notifications, collaborationTasks, auditEvents } = useLabData();

  const metrics = useMemo(() => {
    const complete = experiments.filter((experiment) => experiment.status === "complete").length;
    const active = experiments.filter((experiment) => experiment.status === "active").length;
    const lowLots = inventoryItems.flatMap((item) => item.lots).filter((lot) => lot.status === "low" || lot.status === "expired" || lot.status === "depleted").length;
    const completedSteps = Object.values(experimentDetails).reduce(
      (sum, detail) => sum + detail.protocol.filter((step) => step.status === "done").length,
      0,
    );

    return [
      { label: "Experiments", value: experiments.length, note: `${active} active / ${complete} complete` },
      { label: "Protocol Templates", value: protocolTemplates.length, note: `${completedSteps} completed run steps` },
      { label: "Inventory Watch", value: lowLots, note: "Low, expired, or depleted lots" },
      { label: "Registry", value: sampleRecords.length, note: `${projectRecords.length} projects` },
    ];
  }, [experimentDetails, experiments, inventoryItems, projectRecords.length, protocolTemplates.length, sampleRecords.length]);

  const protocolUsage = protocolTemplates.map((template) => ({
    template,
    count: Object.values(experimentDetails).filter((detail) => detail.protocolTemplateId === template.id).length,
  }));

  return (
    <>
      <div className="topbar">
        <h1>Analytics</h1>
      </div>
      <div className="analytics-content">
        <div className="stats-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="stat-card">
              <div className="stat-card-label">{metric.label}</div>
              <div className="stat-card-value">{metric.value}</div>
              <div className="stat-card-note">{metric.note}</div>
            </div>
          ))}
        </div>

        <div className="analytics-grid">
          <section className="analytics-panel">
            <h2>Protocol Usage</h2>
            {protocolUsage.length === 0 && <p>No protocol templates yet.</p>}
            {protocolUsage.map(({ template, count }) => (
              <div key={template.id} className="analytics-row">
                <span>{template.name} v{template.version}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </section>

          <section className="analytics-panel">
            <h2>Inventory Watch</h2>
            {inventoryItems.flatMap((item) => item.lots).length === 0 && <p>No inventory lots yet.</p>}
            {inventoryItems.flatMap((item) =>
              item.lots
                .filter((lot) => lot.status !== "available")
                .map((lot) => (
                  <div key={`${item.id}-${lot.id}`} className="analytics-row">
                    <span>{item.name} / {lot.lotNumber}</span>
                    <strong>{lot.status}</strong>
                  </div>
                )),
            )}
          </section>

          <section className="analytics-panel wide">
            <h2>Recent Activity</h2>
            {auditEvents.slice(0, 10).map((event) => (
              <div key={event.id} className="analytics-row">
                <span>{event.action} - {event.targetLabel}</span>
                <strong>{event.timestamp}</strong>
              </div>
            ))}
          </section>

          <section className="analytics-panel">
            <h2>Collaboration</h2>
            <div className="analytics-row"><span>Open tasks</span><strong>{collaborationTasks.filter((task) => task.status !== "done").length}</strong></div>
            <div className="analytics-row"><span>Unread notifications</span><strong>{notifications.length}</strong></div>
            <div className="analytics-row"><span>Review queue</span><strong>{experiments.filter((experiment) => experiment.status === "review").length}</strong></div>
          </section>

          <section className="analytics-panel">
            <h2>Signature Coverage</h2>
            <div className="analytics-row"><span>Signed / locked</span><strong>{Object.values(experimentDetails).filter((experiment) => experiment.locked).length}</strong></div>
            <div className="analytics-row"><span>Unsigned complete</span><strong>{Object.values(experimentDetails).filter((experiment) => experiment.status === "complete" && !experiment.locked).length}</strong></div>
            <div className="analytics-row"><span>Amendments</span><strong>{Object.values(experimentDetails).filter((experiment) => experiment.parentExperimentId).length}</strong></div>
          </section>
        </div>
      </div>
    </>
  );
}
