import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentReport.css";
import { useLabData } from "../contexts/LabDataContext";

export function ExperimentReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { experimentDetails, attachments, auditEvents, inventoryItems } = useLabData();
  const detail = id ? experimentDetails[id] : undefined;

  if (!detail) {
    return (
      <div className="report-page">
        <button className="report-back" onClick={() => navigate("/dashboard")}>Back</button>
        <p>Experiment not found.</p>
      </div>
    );
  }

  const files = attachments.filter((item) => item.experimentId === detail.id);
  const events = auditEvents.filter((event) => event.targetId === detail.id).slice(0, 20);
  const lotLabels = new Map(
    inventoryItems.flatMap((item) =>
      item.lots.map((lot) => [lot.id, `${item.name} / ${lot.lotNumber} (${lot.quantity} ${lot.unit})`] as const),
    ),
  );

  return (
    <div className="report-page">
      <div className="report-actions">
        <button className="report-back" onClick={() => navigate(`/experiments/${detail.id}`)}>Back to editor</button>
        <button className="report-print" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <main className="report-sheet">
        <header>
          <p>LabOS Experiment Report</p>
          <h1>{detail.name}</h1>
          <div className="report-meta">
            <span>{detail.id}</span>
            <span>{detail.project}</span>
            <span>{detail.status}</span>
            <span>Review: {detail.reviewStatus ?? "none"}</span>
            <span>v{detail.versionNumber ?? 1}</span>
            {detail.locked && <span>Signed / Locked</span>}
            <span>{detail.owner}</span>
          </div>
        </header>

        <section>
          <h2>Objective</h2>
          <p>{detail.objective || "No objective recorded."}</p>
        </section>

        <section>
          <h2>Notebook Notes</h2>
          <p>{detail.notes || "No notes recorded."}</p>
        </section>

        <section>
          <h2>Observations</h2>
          <p>{detail.observations || "No observations recorded."}</p>
        </section>

        <section>
          <h2>Structured Blocks</h2>
          {detail.authoringBlocks.length === 0 && <p>No structured blocks.</p>}
          {detail.authoringBlocks.map((block) => (
            <div key={block.id} className="report-block">
              <strong>{block.title} ({block.kind})</strong>
              <pre>{block.content}</pre>
            </div>
          ))}
        </section>

        <section>
          <h2>Protocol Run</h2>
          <ol>
            {detail.protocol.map((step) => (
              <li key={step.id}>
                <strong>{step.label}</strong> - {step.status.replace("_", " ")}
                {step.completedAt ? ` (${step.completedBy} ${step.completedAt})` : ""}
                {step.reagentLotId ? ` - lot: ${lotLabels.get(step.reagentLotId) ?? step.reagentLotId}` : ""}
                {step.timerMinutes ? ` - timer: ${step.timerMinutes} min` : ""}
                {step.note ? ` - note: ${step.note}` : ""}
                {step.deviation ? ` - deviation: ${step.deviation}` : ""}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Attachments</h2>
          {files.length === 0 && <p>No attachments.</p>}
          {files.map((file) => (
            <p key={file.id}>{file.fileName} - {Math.ceil(file.size / 1024)} KB - uploaded by {file.uploadedBy}</p>
          ))}
        </section>

        <section>
          <h2>Comments</h2>
          {detail.comments.length === 0 && <p>No comments.</p>}
          {detail.comments.map((comment) => (
            <p key={comment.id}><strong>{comment.author}</strong>: {comment.body}</p>
          ))}
        </section>

        <section>
          <h2>Review and Signatures</h2>
          <p>Review status: {detail.reviewStatus ?? "none"}</p>
          {detail.reviewComment && <p>Review note: {detail.reviewComment}</p>}
          {detail.signatures.length === 0 && <p>No electronic signatures.</p>}
          {detail.signatures.map((signature) => (
            <p key={signature.id}><strong>{signature.signerName}</strong> signed as {signature.meaning} on {new Date(signature.signedAt).toLocaleString()}. {signature.comment}</p>
          ))}
        </section>

        <section>
          <h2>Version History</h2>
          {detail.versions.length === 0 && <p>No version history yet.</p>}
          {detail.versions.map((version) => (
            <div key={version.id} className="report-version">
              <p>
                <strong>v{version.versionNumber}.{version.revisionNumber ?? 0} - {version.label}</strong>
                <br />
                {new Date(version.createdAt).toLocaleString()} by {version.createdBy} on {version.deviceLabel ?? "unknown device"}
              </p>
              <p>{version.snapshotSummary}</p>
              {(version.fieldChanges?.length ?? 0) > 0 && (
                <table className="report-change-table">
                  <tbody>
                    {version.fieldChanges?.map((change, index) => (
                      <tr key={`${version.id}-${change.field}-${index}`}>
                        <th>{change.field}</th>
                        <td>{change.before}</td>
                        <td>{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>

        <section>
          <h2>Audit Summary</h2>
          {events.length === 0 && <p>No audit events for this experiment.</p>}
          {events.map((event) => (
            <p key={event.id}>
              {event.timestamp} - {event.actor} - {event.action}
              {event.deviceLabel ? ` - ${event.deviceLabel}` : ""}
              {event.versionNumber ? ` - revision ${event.versionNumber}` : ""}
            </p>
          ))}
        </section>
      </main>
    </div>
  );
}
