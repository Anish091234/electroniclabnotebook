import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentReport.css";
import { SecureAttachmentImage } from "../components/SecureAttachment";
import type { AttachmentRecord, AuthoringBlock, ExperimentIntegrityReport } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { parseChecklist, parseDelimitedRows, parseKeyValueRows } from "../lib/authoringBlocks";

function renderReportBlock(block: AuthoringBlock, attachmentsById: Map<string, AttachmentRecord>) {
  if (block.kind === "table") {
    const rows = parseDelimitedRows(block.content);
    const [header, ...body] = rows;
    if (!header) return <p>No table rows.</p>;
    return (
      <table className="report-data-table">
        <thead>
          <tr>{header.map((cell, index) => <th key={`${block.id}-h-${index}`}>{cell || `Column ${index + 1}`}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`${block.id}-r-${rowIndex}`}>
              {header.map((_cell, cellIndex) => <td key={`${block.id}-${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (block.kind === "checklist") {
    return (
      <ul className="report-checklist">
        {parseChecklist(block.content).map((item, index) => <li key={`${block.id}-c-${index}`}>{item.checked ? "[x]" : "[ ]"} {item.label}</li>)}
      </ul>
    );
  }

  if (block.kind === "data") {
    return (
      <table className="report-change-table">
        <tbody>
          {parseKeyValueRows(block.content).map((row, index) => (
            <tr key={`${block.id}-d-${index}`}>
              <th>{row.key}</th>
              <td>{row.value || "Empty"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (block.kind === "image") {
    return <SecureAttachmentImage className="report-block-image" attachment={block.attachmentId ? attachmentsById.get(block.attachmentId) : undefined} alt={block.title} />;
  }

  if (block.kind === "equation") {
    return <div className="report-equation">{block.content}</div>;
  }

  return <p>{block.content || "Empty block."}</p>;
}

export function ExperimentReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { experimentDetails, attachments, auditEvents, inventoryItems, verifyExperimentIntegrity } = useLabData();
  const detail = id ? experimentDetails[id] : undefined;
  const [integrityReport, setIntegrityReport] = useState<ExperimentIntegrityReport | null>(null);
  const [integrityError, setIntegrityError] = useState("");
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);

  const handleIntegrityVerification = async () => {
    if (!detail) return;
    setIsVerifyingIntegrity(true);
    setIntegrityError("");
    try {
      setIntegrityReport(await verifyExperimentIntegrity(detail.id));
    } catch (error) {
      setIntegrityReport(null);
      setIntegrityError(error instanceof Error ? error.message : "Could not verify this signed record.");
    } finally {
      setIsVerifyingIntegrity(false);
    }
  };

  if (!detail) {
    return (
      <div className="report-page">
        <button className="report-back" onClick={() => navigate("/dashboard")}>Back</button>
        <p>Experiment not found.</p>
      </div>
    );
  }

  const files = attachments.filter((item) => item.experimentId === detail.id);
  const attachmentsById = new Map(files.map((attachment) => [attachment.id, attachment]));
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
              <strong>{block.title} ({block.kind}{block.required ? ", required" : ""})</strong>
              {renderReportBlock(block, attachmentsById)}
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
          <p>Assigned reviewer: {detail.reviewAssignedToName || "Unassigned"}</p>
          <p>Review due date: {detail.reviewDueDate || "No due date"}</p>
          {detail.reviewComment && <p>Review note: {detail.reviewComment}</p>}
          {(detail.reviewEvents?.length ?? 0) > 0 && (
            <div className="report-review-history">
              <h3>Immutable review history</h3>
              {[...(detail.reviewEvents ?? [])].map((event) => (
                <p key={event.id}>
                  <strong>{event.actorName}</strong> {event.kind === "requested" ? `requested review from ${event.reviewerName}` : event.kind === "approved" ? "approved review" : "requested changes"} on {new Date(event.occurredAt).toLocaleString()}.
                  {event.comment ? ` ${event.comment}` : ""}
                </p>
              ))}
            </div>
          )}
          {detail.signatures.length === 0 && <p>No electronic signatures.</p>}
          {detail.signatures.map((signature) => (
            <p key={signature.id}>
              <strong>{signature.signerName}</strong> signed as {signature.meaning} on {new Date(signature.signedAt).toLocaleString()}. {signature.comment}
              {signature.manifestSha256 && <> Evidence manifest SHA-256: <code>{signature.manifestSha256}</code>.</>}
            </p>
          ))}
          {detail.locked && (
            <div className={`report-integrity ${integrityReport ? (integrityReport.verified ? "verified" : "failed") : ""}`}>
              <div>
                <h3>Record integrity verification</h3>
                <p>Rebuild the signed evidence manifest and validate the finalized attachment metadata against immutable Cloud Storage objects.</p>
              </div>
              <button type="button" className="report-verify" onClick={() => void handleIntegrityVerification()} disabled={isVerifyingIntegrity}>
                {isVerifyingIntegrity ? "Verifying…" : "Verify signed record"}
              </button>
              <div aria-live="polite">
                {integrityError && <p className="report-integrity-error">{integrityError}</p>}
                {integrityReport && (
                  integrityReport.verified ? (
                    <p className="report-integrity-success">
                      Verified: the signed manifest matches the current record and {integrityReport.attachmentCount} finalized attachment{integrityReport.attachmentCount === 1 ? "" : "s"}.
                    </p>
                  ) : (
                    <>
                      <p className="report-integrity-error">Verification found an integrity mismatch. Do not rely on this record until it is investigated.</p>
                      <ul>
                        {integrityReport.failures.map((failure) => <li key={failure}>{failure}</li>)}
                      </ul>
                    </>
                  )
                )}
              </div>
            </div>
          )}
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
