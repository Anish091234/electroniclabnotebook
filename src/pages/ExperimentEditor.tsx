import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentEditor.css";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIcon } from "../components/icons";
import type { AuthoringBlock, AuthoringBlockKind, ExperimentStatus, ProtocolStepStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";

type PanelTab = "ai" | "comments" | "history" | "files" | "review" | "tasks";
type SaveState = "idle" | "saving" | "saved";

const STATUS_OPTIONS: { value: ExperimentStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "complete", label: "Complete" },
];

export function ExperimentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    experimentDetails,
    protocolTemplates,
    inventoryItems,
    projectRecords,
    attachments,
    collaborationTasks,
    saveExperiment,
    attachProtocolTemplate,
    updateProtocolStepStatus,
    linkProtocolStepLot,
    addComment,
    uploadAttachment,
    submitExperimentForReview,
    approveExperimentReview,
    rejectExperimentReview,
    signExperiment,
    createExperimentAmendment,
    updateProtocolStepDetails,
    saveAuthoringBlocks,
  } = useLabData();
  const detail = id ? experimentDetails[id] : undefined;
  const experimentAttachments = attachments.filter((item) => item.experimentId === id);

  const [panelTab, setPanelTab] = useState<PanelTab>("ai");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
  const [observations, setObservations] = useState("");
  const [status, setStatus] = useState<ExperimentStatus>("draft");
  const [projectId, setProjectId] = useState("");
  const [notebook, setNotebook] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [reviewDraft, setReviewDraft] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [amendmentDraft, setAmendmentDraft] = useState("");
  const [blockKind, setBlockKind] = useState<AuthoringBlockKind>("text");
  const [blockTitle, setBlockTitle] = useState("");
  const [blockContent, setBlockContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploadState, setUploadState] = useState("");

  const lots = useMemo(
    () =>
      inventoryItems.flatMap((item) =>
        item.lots.map((lot) => ({
          id: lot.id,
          label: `${item.name} / ${lot.lotNumber} (${lot.quantity} ${lot.unit})`,
        })),
      ),
    [inventoryItems],
  );

  useEffect(() => {
    if (!detail) return;
    setTitle(detail.name);
    setObjective(detail.objective);
    setNotes(detail.notes || "");
    setObservations(detail.observations || "");
    setStatus(detail.status);
    setProjectId(detail.projectId ?? "");
    setNotebook(detail.notebook ?? "General Notebook");
    setDueDate(detail.dueDate ?? "");
    setTagsDraft(detail.tags.join(", "));
    setReviewDraft(detail.reviewComment ?? "");
    setSignatureDraft("");
    setAmendmentDraft("");
    setSaveState("idle");
  }, [detail]);

  if (!detail) {
    return (
      <div className="editor-not-found">
        <p>Experiment "{id}" was not found.</p>
        <button className="btn-primary" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const markDirty = () => setSaveState("idle");
  const isLocked = !!detail.locked;

  const cycleStatus = (current: ProtocolStepStatus): ProtocolStepStatus => {
    if (current === "pending") return "in_progress";
    if (current === "in_progress") return "done";
    return "pending";
  };

  const toggleStep = async (stepId: string, currentStatus: ProtocolStepStatus) => {
    if (isLocked) return;
    await updateProtocolStepStatus(detail.id, stepId, cycleStatus(currentStatus));
  };

  const handleSave = async () => {
    if (isLocked) return;
    setSaveState("saving");
    await saveExperiment(detail.id, {
      name: title,
      objective,
      notes,
      observations,
      status,
      projectId: projectId || null,
      notebook,
      dueDate: dueDate || null,
      tags: tagsDraft.split(","),
    });
    setSaveState("saved");
  };

  const submitComment = async () => {
    if (!commentDraft.trim()) return;
    await addComment(detail.id, commentDraft);
    setCommentDraft("");
  };

  const handleUpload = async (file: File | undefined, protocolStepId?: string | null) => {
    if (!file) return;
    setUploadState("Uploading...");
    await uploadAttachment(detail.id, file, protocolStepId);
    setUploadState("");
    setPanelTab("files");
  };

  const addAuthoringBlock = async () => {
    if (!blockTitle.trim() && !blockContent.trim()) return;
    const timestamp = new Date().toISOString();
    const block: AuthoringBlock = {
      id: `block-${Date.now()}`,
      kind: blockKind,
      title: blockTitle.trim() || blockKind,
      content: blockContent,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveAuthoringBlocks(detail.id, [...detail.authoringBlocks, block]);
    setBlockTitle("");
    setBlockContent("");
  };

  const startAmendment = async () => {
    const created = await createExperimentAmendment(detail.id, amendmentDraft || "Amendment created from signed record.");
    navigate(`/experiments/${created.id}`);
  };

  const experimentTasks = collaborationTasks.filter((task) => task.experimentId === detail.id);

  return (
    <>
      <div className="editor-topbar">
        <div className="editor-breadcrumb">
          <a onClick={() => navigate("/dashboard")}>Experiments</a>
          <span>&gt;</span>
          <span>{detail.project}</span>
          <span>&gt;</span>
          <span className="current">{detail.name}</span>
        </div>
        <div className="editor-topbar-actions">
          <StatusBadge status={status} />
          {isLocked && <span className="editor-lock-pill">Signed / Locked</span>}
          {!isLocked && (
            <button className="btn-secondary" onClick={() => submitExperimentForReview(detail.id, reviewDraft)}>
              Submit Review
            </button>
          )}
          {!isLocked && detail.reviewStatus === "requested" && (
            <>
              <button className="btn-secondary" onClick={() => approveExperimentReview(detail.id, reviewDraft)}>
                Approve
              </button>
              <button className="btn-secondary" onClick={() => rejectExperimentReview(detail.id, reviewDraft || "Changes requested.")}>
                Reject
              </button>
            </>
          )}
          {!isLocked && (
            <button className="btn-secondary" onClick={() => signExperiment(detail.id, "author", signatureDraft || "Signed as complete and accurate.")}>
              E-Sign
            </button>
          )}
          {isLocked && (
            <button className="btn-secondary" onClick={startAmendment}>
              Create Amendment
            </button>
          )}
          <button className="btn-secondary" onClick={() => navigate(`/experiments/${detail.id}/report`)}>
            Print Report
          </button>
          <button className="btn-save" disabled={isLocked} onClick={handleSave}>
            {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          <input
            className="editor-title-input"
            value={title}
            disabled={isLocked}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
          />

          <div className="editor-meta-row">
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Project</span>
              <span className="editor-meta-field-value">{detail.project}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Modified</span>
              <span className="editor-meta-field-value">{detail.modified}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">ID</span>
              <span className="editor-meta-field-value mono">{detail.id}</span>
            </div>
            <label className="editor-status-field">
              <span>Status</span>
              <select
                value={status}
                disabled={isLocked}
                onChange={(e) => {
                  setStatus(e.target.value as ExperimentStatus);
                  markDirty();
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-tags-field">
              <span>Tags</span>
              <input
                value={tagsDraft}
                disabled={isLocked}
                onChange={(e) => {
                  setTagsDraft(e.target.value);
                  markDirty();
                }}
                placeholder="Comma separated"
              />
            </label>
            <label className="editor-status-field">
              <span>Project</span>
              <select
                value={projectId}
                disabled={isLocked}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  markDirty();
                }}
              >
                <option value="">Unlinked</option>
                {projectRecords.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-tags-field">
              <span>Notebook</span>
              <input
                value={notebook}
                disabled={isLocked}
                onChange={(e) => {
                  setNotebook(e.target.value);
                  markDirty();
                }}
              />
            </label>
            <label className="editor-status-field">
              <span>Due</span>
              <input
                type="date"
                value={dueDate}
                disabled={isLocked}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  markDirty();
                }}
              />
            </label>
          </div>

          <div className="editor-toolbar">
            <label className="editor-template-picker">
              <span>Protocol</span>
              <select
                value={detail.protocolTemplateId ?? ""}
                disabled={isLocked}
                onChange={(e) => e.target.value && attachProtocolTemplate(detail.id, e.target.value)}
              >
                <option value="">Default checklist</option>
                {protocolTemplates
                  .filter((template) => template.status === "active")
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} v{template.version}
                    </option>
                  ))}
              </select>
            </label>
            <label className="toolbar-ai-btn file-upload-btn">
              {uploadState || "Upload File"}
              <input type="file" disabled={isLocked} onChange={(e) => handleUpload(e.target.files?.[0])} />
            </label>
          </div>

          <div className="editor-card">
            <h3>Objective</h3>
            <textarea
              className="objective-textarea"
              value={objective}
              disabled={isLocked}
              onChange={(e) => {
                setObjective(e.target.value);
                markDirty();
              }}
              rows={4}
            />
            <h3>Notebook Notes</h3>
            <textarea
              className="objective-textarea"
              value={notes}
              disabled={isLocked}
              onChange={(e) => {
                setNotes(e.target.value);
                markDirty();
              }}
              rows={7}
              placeholder="Methods, calculations, deviations, and running notes..."
            />
            <h3>Observations</h3>
            <textarea
              className="objective-textarea"
              value={observations}
              disabled={isLocked}
              onChange={(e) => {
                setObservations(e.target.value);
                markDirty();
              }}
              rows={4}
              placeholder="Results, anomalies, images reviewed, and interpretation..."
            />
            <h3>Structured Blocks</h3>
            <div className="authoring-block-list">
              {detail.authoringBlocks.length === 0 && <p className="authoring-empty">No rich blocks yet.</p>}
              {detail.authoringBlocks.map((block) => (
                <div key={block.id} className="authoring-block">
                  <div className="authoring-block-header">
                    <strong>{block.title}</strong>
                    <span>{block.kind}</span>
                  </div>
                  <pre>{block.content}</pre>
                </div>
              ))}
            </div>
            {!isLocked && (
              <div className="authoring-builder">
                <select value={blockKind} onChange={(e) => setBlockKind(e.target.value as AuthoringBlockKind)}>
                  <option value="text">Text</option>
                  <option value="table">Table / CSV</option>
                  <option value="image">Image Note</option>
                  <option value="equation">Equation</option>
                  <option value="checklist">Checklist</option>
                  <option value="data">Structured Data</option>
                </select>
                <input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} placeholder="Block title" />
                <textarea value={blockContent} onChange={(e) => setBlockContent(e.target.value)} rows={3} placeholder="Paste table data, equation, checklist, or structured observations..." />
                <button className="btn-secondary" type="button" onClick={addAuthoringBlock}>Add Block</button>
              </div>
            )}
            <h3>Protocol Steps</h3>
            <div className="protocol-steps">
              {detail.protocol.map((step) => (
                <div key={step.id} className={`protocol-step ${step.status}`}>
                  <div className="protocol-step-check" onClick={() => toggleStep(step.id, step.status)}>
                    {step.status === "done" && <CheckIcon />}
                  </div>
                  <span className="protocol-step-label" onClick={() => toggleStep(step.id, step.status)}>
                    {step.label}
                  </span>
                  {lots.length > 0 && (
                    <select
                      className="step-lot-select"
                      value={step.reagentLotId ?? ""}
                      disabled={isLocked}
                      onChange={(e) => linkProtocolStepLot(detail.id, step.id, e.target.value || null)}
                    >
                      <option value="">No lot linked</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {step.status === "done" && (
                    <span className="protocol-step-meta">
                      {step.completedBy} {step.completedAt}
                    </span>
                  )}
                  {step.status === "in_progress" && <span className="protocol-step-meta progress">In progress</span>}
                  <div className="protocol-step-details">
                    <label>
                      <input
                        type="checkbox"
                        checked={step.required !== false}
                        disabled={isLocked}
                        onChange={(e) => updateProtocolStepDetails(detail.id, step.id, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <label>
                      Timer
                      <input
                        type="number"
                        min={0}
                        defaultValue={step.timerMinutes ?? 0}
                        disabled={isLocked}
                        onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { timerMinutes: Number(e.target.value) })}
                      />
                    </label>
                    <input
                      defaultValue={step.note ?? ""}
                      disabled={isLocked}
                      placeholder="Step note"
                      onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { note: e.target.value })}
                    />
                    <input
                      defaultValue={step.deviation ?? ""}
                      disabled={isLocked}
                      placeholder="Deviation"
                      onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { deviation: e.target.value })}
                    />
                    {!isLocked && (
                      <label className="step-file-upload">
                        Step file
                        <input type="file" onChange={(e) => handleUpload(e.target.files?.[0], step.id)} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="editor-side-panel">
          <div className="side-panel-tabs">
            {(["ai", "review", "comments", "tasks", "history", "files"] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                className={`side-panel-tab${panelTab === tab ? " active" : ""}`}
                onClick={() => setPanelTab(tab)}
              >
                {tab === "ai"
                  ? "AI"
                  : tab === "review"
                    ? "Review"
                    : tab === "comments"
                      ? `Comments (${detail.comments.length})`
                      : tab === "tasks"
                        ? `Tasks (${experimentTasks.length})`
                        : tab === "files"
                          ? `Files (${experimentAttachments.length})`
                          : "History"}
              </button>
            ))}
          </div>

          <div className="side-panel-content">
            {panelTab === "ai" &&
              detail.aiInsights.map((insight) => (
                <div key={insight.id} className={`insight-card ${insight.kind}`}>
                  <div className="insight-card-title">{insight.title}</div>
                  <p className="insight-card-body">{insight.body}</p>
                </div>
              ))}

            {panelTab === "review" && (
              <div className="review-panel">
                <div className="review-row"><span>Status</span><strong>{detail.reviewStatus ?? "none"}</strong></div>
                <div className="review-row"><span>Requested</span><strong>{detail.reviewRequestedBy || "Not requested"}</strong></div>
                <textarea value={reviewDraft} disabled={isLocked} onChange={(e) => setReviewDraft(e.target.value)} placeholder="Review note or rejection reason..." rows={4} />
                <textarea value={signatureDraft} disabled={isLocked} onChange={(e) => setSignatureDraft(e.target.value)} placeholder="Signature meaning/comment..." rows={3} />
                {isLocked && <textarea value={amendmentDraft} onChange={(e) => setAmendmentDraft(e.target.value)} placeholder="Amendment reason..." rows={3} />}
                <h3>Signatures</h3>
                {detail.signatures.length === 0 && <p>No signatures yet.</p>}
                {detail.signatures.map((signature) => (
                  <div key={signature.id} className="history-entry">
                    <div className="history-action">{signature.signerName} - {signature.meaning}</div>
                    <div className="history-meta">{new Date(signature.signedAt).toLocaleString()}</div>
                  </div>
                ))}
                <h3>Versions</h3>
                {detail.versions.length === 0 && <p>No version history yet.</p>}
                {detail.versions.map((version) => (
                  <div key={version.id} className="history-entry">
                    <div className="history-action">
                      v{version.versionNumber}.{version.revisionNumber ?? 0} - {version.label}
                    </div>
                    <div className="history-meta">
                      {new Date(version.createdAt).toLocaleString()} by {version.createdBy} on {version.deviceLabel ?? "unknown device"}
                    </div>
                    <div className="history-summary">{version.snapshotSummary}</div>
                    {(version.fieldChanges?.length ?? 0) > 0 && (
                      <div className="revision-change-list">
                        {version.fieldChanges?.map((change, index) => (
                          <div key={`${version.id}-${change.field}-${index}`} className="revision-change">
                            <strong>{change.field}</strong>
                            <span>{change.before}</span>
                            <span>{change.after}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {panelTab === "comments" &&
              detail.comments.map((c) => (
                <div key={c.id} className="comment-card">
                  <div className="comment-card-header">
                    <div className="comment-avatar">{c.initials}</div>
                    <span className="comment-author">{c.author}</span>
                    <span className="comment-time">{c.postedAt}</span>
                  </div>
                  <p className="comment-body">{c.body}</p>
                </div>
              ))}

            {panelTab === "tasks" &&
              experimentTasks.map((task) => (
                <div key={task.id} className="comment-card">
                  <div className="comment-card-header">
                    <span className="comment-author">{task.title}</span>
                    <span className="comment-time">{task.status.replace("_", " ")}</span>
                  </div>
                  <p className="comment-body">{task.description || "No description."}</p>
                </div>
              ))}

            {panelTab === "history" &&
              detail.history.map((h) => (
                <div key={h.id} className="history-entry">
                  <div className="history-action">
                    {h.actor} - {h.action}
                  </div>
                  <div className="history-meta">
                    {h.timestamp}
                    {h.deviceLabel ? ` - ${h.deviceLabel}` : ""}
                  </div>
                </div>
              ))}

            {panelTab === "files" &&
              experimentAttachments.map((file) => (
                <a key={file.id} className="attachment-row" href={file.downloadURL} target="_blank" rel="noreferrer">
                  <span>{file.fileName}</span>
                  <small>{Math.ceil(file.size / 1024)} KB</small>
                </a>
              ))}
          </div>

          {panelTab === "comments" && (
            <div className="side-panel-footer">
              <input
                className="comment-input"
                placeholder="Add a comment..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitComment();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
