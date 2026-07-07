import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentDetailView.css";
import type { AuthoringBlock, AuthoringBlockKind, ExperimentStatus, ProtocolStepStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";
import { AUTHORING_TEMPLATES, parseChecklist, parseDelimitedRows, parseKeyValueRows } from "../lib/authoringBlocks";

type PanelTab = "ai" | "review" | "comments" | "tasks" | "history" | "files";
type SaveState = "idle" | "saving" | "saved";

const STATUS_META: Record<ExperimentStatus, { dot: string; label: string }> = {
  active: { dot: "#4ade80", label: "Active" },
  review: { dot: "#f87171", label: "Review" },
  complete: { dot: "#93c5fd", label: "Complete" },
  draft: { dot: "#9ca3af", label: "Draft" },
};

const STATUS_OPTIONS: { value: ExperimentStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "complete", label: "Complete" },
];

const NOTE_SNIPPETS = [
  { label: "Timestamp", value: () => `[${new Date().toLocaleString()}] ` },
  { label: "Method Note", value: () => ["Method:", "Materials:", "Parameters:", "Rationale:"].join("\n") },
  { label: "Deviation", value: () => ["Deviation:", "Reason:", "Impact:", "Follow-up:"].join("\n") },
  { label: "Calculation", value: () => ["Calculation:", "Inputs:", "Formula:", "Result:"].join("\n") },
];

function lineRows(text: string, charsPerLine = 78) {
  return Math.max(2, Math.min(20, (text || "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine)), 0) + 1));
}

export function ExperimentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeMember, user } = useAuth();
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
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [amendmentDraft, setAmendmentDraft] = useState("");
  const [blockKind, setBlockKind] = useState<AuthoringBlockKind>("text");
  const [blockTitle, setBlockTitle] = useState("");
  const [blockContent, setBlockContent] = useState("");
  const [blockRequired, setBlockRequired] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploadState, setUploadState] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

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
    setReviewerName(detail.reviewAssignedToName ?? "");
    setReviewDueDate(detail.reviewDueDate ?? "");
    setSignatureDraft("");
    setAmendmentDraft("");
    setEditingBlockId(null);
    setBlockKind("text");
    setBlockTitle("");
    setBlockContent("");
    setBlockRequired(false);
    setSaveState("idle");
    setExpandedSteps({});
  }, [detail]);

  if (!detail) {
    return (
      <div className="xd-not-found">
        <p>Experiment "{id}" was not found.</p>
        <button className="xd-btn-primary" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const markDirty = () => setSaveState("idle");
  const isLocked = !!detail.locked;
  const linkedProject = projectRecords.find((project) => project.id === detail.projectId);
  const projectAllowsCurrentUser =
    !linkedProject ||
    linkedProject.visibility !== "restricted" ||
    linkedProject.ownerUid === user?.uid ||
    (linkedProject.allowedMemberUids ?? []).includes(user?.uid ?? "");
  const canEditExperiment =
    !isLocked &&
    !!activeMember &&
    activeMember.status === "active" &&
    activeMember.role !== "viewer" &&
    activeMember.role !== "external" &&
    projectAllowsCurrentUser &&
    (activeMember.role === "owner" ||
      activeMember.role === "admin" ||
      detail.ownerUid === activeMember.uid ||
      detail.piUid === activeMember.uid ||
      linkedProject?.ownerUid === activeMember.uid ||
      (linkedProject?.allowedMemberUids ?? []).includes(activeMember.uid));
  const canReviewExperiment = !!activeMember && ["owner", "admin", "pi"].includes(activeMember.role);
  const isReadOnly = isLocked || !canEditExperiment;
  const signingIssues = [
    !detail.objective.trim() ? "Objective is missing" : "",
    !detail.notes.trim() ? "Notebook notes are missing" : "",
    !detail.observations.trim() ? "Observations are missing" : "",
    detail.attachmentIds.length === 0 ? "Raw files are not attached" : "",
    detail.protocol.some((step) => step.required !== false && step.status !== "done") ? "Required protocol steps are incomplete" : "",
    detail.protocol.some((step) => step.required !== false && !step.reagentLotId) ? "Required reagent lots are not linked" : "",
    detail.authoringBlocks.some((block) => block.required && !block.content.trim()) ? "Required structured blocks are incomplete" : "",
  ].filter(Boolean);

  const doneSteps = detail.protocol.filter((s) => s.status === "done").length;
  const totalSteps = detail.protocol.length;
  const stepsProgressPct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const cycleStatus = (current: ProtocolStepStatus): ProtocolStepStatus => {
    if (current === "pending") return "in_progress";
    if (current === "in_progress") return "done";
    return "pending";
  };

  const toggleStep = async (stepId: string, currentStatus: ProtocolStepStatus) => {
    if (isReadOnly) return;
    await updateProtocolStepStatus(detail.id, stepId, cycleStatus(currentStatus));
  };

  const toggleStepExpanded = (stepId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
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

  const insertNoteSnippet = (snippet: string) => {
    const separator = notes.trim() ? "\n\n" : "";
    setNotes(`${notes}${separator}${snippet}`);
    markDirty();
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

  const resetBlockForm = () => {
    setEditingBlockId(null);
    setBlockKind("text");
    setBlockTitle("");
    setBlockContent("");
    setBlockRequired(false);
  };

  const saveAuthoringBlock = async () => {
    if (!blockTitle.trim() && !blockContent.trim()) return;
    const timestamp = new Date().toISOString();
    const block: AuthoringBlock = {
      id: editingBlockId ?? `block-${Date.now()}`,
      kind: blockKind,
      title: blockTitle.trim() || blockKind,
      content: blockContent,
      required: blockRequired,
      createdAt: detail.authoringBlocks.find((item) => item.id === editingBlockId)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const nextBlocks = editingBlockId
      ? detail.authoringBlocks.map((item) => (item.id === editingBlockId ? { ...item, ...block } : item))
      : [...detail.authoringBlocks, block];
    await saveAuthoringBlocks(detail.id, nextBlocks);
    resetBlockForm();
  };

  const editAuthoringBlock = (block: AuthoringBlock) => {
    setEditingBlockId(block.id);
    setBlockKind(block.kind);
    setBlockTitle(block.title);
    setBlockContent(block.content);
    setBlockRequired(!!block.required);
  };

  const deleteAuthoringBlock = async (blockId: string) => {
    await saveAuthoringBlocks(detail.id, detail.authoringBlocks.filter((block) => block.id !== blockId));
    if (editingBlockId === blockId) resetBlockForm();
  };

  const addTemplateBlock = async (templateIndex: number) => {
    const template = AUTHORING_TEMPLATES[templateIndex];
    if (!template) return;
    const timestamp = new Date().toISOString();
    await saveAuthoringBlocks(detail.id, [
      ...detail.authoringBlocks,
      {
        id: `block-${Date.now()}`,
        kind: template.kind,
        title: template.title,
        content: template.content,
        required: template.required,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
  };

  const handleInlineImageUpload = async (file: File | undefined) => {
    if (!file) return;
    const record = await uploadAttachment(detail.id, file);
    const timestamp = new Date().toISOString();
    await saveAuthoringBlocks(detail.id, [
      ...detail.authoringBlocks,
      {
        id: `block-${Date.now()}`,
        kind: "image",
        title: file.name,
        content: record.downloadURL,
        attachmentId: record.id,
        fileName: record.fileName,
        imageUrl: record.downloadURL,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
  };

  const renderAuthoringBlock = (block: AuthoringBlock) => {
    if (block.kind === "table") {
      const rows = parseDelimitedRows(block.content);
      if (rows.length === 0) return <p className="xd-block-empty">No table rows.</p>;
      const [header, ...body] = rows;
      return (
        <div className="xd-authoring-table-wrap">
          <table className="xd-authoring-table">
            <thead>
              <tr>{header.map((cell, index) => <th key={`${block.id}-h-${index}`}>{cell || `Column ${index + 1}`}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`${block.id}-r-${rowIndex}`}>
                  {header.map((_cell, cellIndex) => <td key={`${block.id}-r-${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (block.kind === "checklist") {
      const items = parseChecklist(block.content);
      return (
        <div className="xd-authoring-checklist">
          {items.map((item, index) => (
            <label key={`${block.id}-check-${index}`}>
              <input type="checkbox" checked={item.checked} readOnly />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      );
    }

    if (block.kind === "data") {
      const rows = parseKeyValueRows(block.content);
      return (
        <dl className="xd-authoring-data">
          {rows.map((row, index) => (
            <div key={`${block.id}-data-${index}`}>
              <dt>{row.key}</dt>
              <dd>{row.value || "Empty"}</dd>
            </div>
          ))}
        </dl>
      );
    }

    if (block.kind === "image") {
      const imageUrl = block.imageUrl || block.content;
      return (
        <div className="xd-authoring-image">
          {imageUrl ? <img src={imageUrl} alt={block.title} /> : <p className="xd-block-empty">No image URL attached.</p>}
          {block.fileName && <span>{block.fileName}</span>}
        </div>
      );
    }

    if (block.kind === "equation") {
      return <div className="xd-authoring-equation">{block.content}</div>;
    }

    return (
      <div className="xd-authoring-richtext">
        {block.content.split(/\n{2,}/).map((paragraph, index) => <p key={`${block.id}-p-${index}`}>{paragraph}</p>)}
      </div>
    );
  };

  const startAmendment = async () => {
    const created = await createExperimentAmendment(detail.id, amendmentDraft || "Amendment created from signed record.");
    navigate(`/experiments/${created.id}`);
  };

  const experimentTasks = collaborationTasks.filter((task) => task.experimentId === detail.id);

  const railTabs: { key: PanelTab; label: string }[] = [
    { key: "ai", label: "AI" },
    { key: "review", label: "Review" },
    { key: "comments", label: `Comments (${detail.comments.length})` },
    { key: "tasks", label: `Tasks (${experimentTasks.length})` },
    { key: "history", label: "History" },
    { key: "files", label: `Files (${experimentAttachments.length})` },
  ];

  return (
    <div className="xd-root">
      <div className="xd-topbar">
        <div className="xd-breadcrumb">
          <span className="xd-breadcrumb-link" onClick={() => navigate("/dashboard")}>Experiments</span>
          <span>/</span>
          <span>{detail.project}</span>
          <span>/</span>
          <span className="xd-breadcrumb-current">{detail.name}</span>
        </div>
        <div className="xd-topbar-actions">
          <span className="xd-status-pill" style={{ color: meta.dot }}>{meta.label}</span>
          {isLocked && <span className="xd-pill-muted">Signed / Locked</span>}
          {!isLocked && !canEditExperiment && <span className="xd-pill-muted">Read Only</span>}
          {!isReadOnly && (
            <button className="xd-btn-ghost" onClick={() => submitExperimentForReview(detail.id, reviewDraft, null, reviewerName || null, reviewDueDate || null)}>
              Submit Review
            </button>
          )}
          {!isLocked && canReviewExperiment && detail.reviewStatus === "requested" && (
            <>
              <button className="xd-btn-ghost" onClick={() => approveExperimentReview(detail.id, reviewDraft)}>Approve</button>
              <button className="xd-btn-ghost" onClick={() => rejectExperimentReview(detail.id, reviewDraft || "Changes requested.")}>Reject</button>
            </>
          )}
          {!isReadOnly && (
            <button className="xd-btn-ghost" disabled={signingIssues.length > 0} onClick={() => signExperiment(detail.id, "author", signatureDraft || "Signed as complete and accurate.")}>
              E-Sign
            </button>
          )}
          {isLocked && (
            <button className="xd-btn-ghost" onClick={startAmendment}>Create Amendment</button>
          )}
          <button className="xd-btn-ghost" onClick={() => navigate(`/experiments/${detail.id}/report`)}>Print Report</button>
          <button className="xd-btn-primary" disabled={isReadOnly} onClick={handleSave}>
            {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="xd-body">
        <div className="xd-main">
          <div className="xd-main-inner">
            <textarea
              className="xd-title"
              value={title}
              disabled={isReadOnly}
              rows={lineRows(title, 42)}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
            />

            <div className="xd-props">
              <div className="xd-prop">
                <span className="xd-prop-label">Project</span>
                <span className="xd-prop-value">{detail.project}</span>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Owner</span>
                <span className="xd-prop-value">{detail.owner}</span>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Modified</span>
                <span className="xd-prop-value">{detail.modified}</span>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">ID</span>
                <span className="xd-prop-value mono">{detail.id}</span>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Tags</span>
                <input
                  value={tagsDraft}
                  disabled={isReadOnly}
                  placeholder="Comma separated"
                  onChange={(e) => {
                    setTagsDraft(e.target.value);
                    markDirty();
                  }}
                  style={{ width: 160 }}
                />
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Status</span>
                <select
                  className="xd-status-select"
                  style={{ color: meta.dot }}
                  value={status}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setStatus(e.target.value as ExperimentStatus);
                    markDirty();
                  }}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Linked Project</span>
                <select
                  value={projectId}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    markDirty();
                  }}
                >
                  <option value="">Unlinked</option>
                  {projectRecords.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Notebook</span>
                <input
                  value={notebook}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setNotebook(e.target.value);
                    markDirty();
                  }}
                  style={{ width: 140 }}
                />
              </div>
              <div className="xd-prop">
                <span className="xd-prop-label">Due</span>
                <input
                  type="date"
                  value={dueDate}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    markDirty();
                  }}
                />
              </div>
            </div>

            <div className="xd-toolbar">
              <label className="xd-toolbar-picker">
                <span>Protocol</span>
                <select
                  value={detail.protocolTemplateId ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) => e.target.value && attachProtocolTemplate(detail.id, e.target.value)}
                >
                  <option value="">Default checklist</option>
                  {protocolTemplates
                    .filter((template) => template.status === "active")
                    .map((template) => (
                      <option key={template.id} value={template.id}>{template.name} v{template.version}</option>
                    ))}
                </select>
              </label>
              <label className="xd-file-btn">
                {uploadState || "Upload File"}
                <input type="file" disabled={isReadOnly} onChange={(e) => handleUpload(e.target.files?.[0])} />
              </label>
              <label className="xd-file-btn">
                Inline Image
                <input type="file" accept="image/*" disabled={isReadOnly} onChange={(e) => handleInlineImageUpload(e.target.files?.[0])} />
              </label>
            </div>

            <div className="xd-section">
              <span className="xd-section-label">Objective</span>
              <textarea
                className="xd-textarea"
                value={objective}
                disabled={isReadOnly}
                rows={lineRows(objective)}
                placeholder="State the hypothesis, expected outcome, and success criteria..."
                onChange={(e) => {
                  setObjective(e.target.value);
                  markDirty();
                }}
              />
            </div>

            <div className="xd-section">
              <span className="xd-section-label">Protocol · {doneSteps}/{totalSteps}</span>
              <div className="xd-progress-track">
                <div className="xd-progress-fill" style={{ width: `${stepsProgressPct}%` }} />
              </div>
              <div className="xd-steps">
                {detail.protocol.map((step) => {
                  const isDone = step.status === "done";
                  const isProgress = step.status === "in_progress";
                  const isExpanded = !!expandedSteps[step.id];
                  return (
                    <div className="xd-step" key={step.id}>
                      <div className="xd-step-row">
                        <button
                          type="button"
                          className="xd-step-check"
                          style={{
                            background: isDone ? "#22d3ee" : "transparent",
                            border: isDone ? "none" : isProgress ? "1.5px solid #fbbf24" : "1.5px solid #2c333d",
                          }}
                          onClick={() => toggleStep(step.id, step.status)}
                        >
                          {isDone ? "✓" : ""}
                        </button>
                        <button
                          type="button"
                          className="xd-step-label"
                          style={{ color: isDone ? "#6b7280" : "#e7e9ec", textDecoration: isDone ? "line-through" : "none" }}
                          onClick={() => toggleStep(step.id, step.status)}
                        >
                          {step.label}
                        </button>
                        <span className="xd-step-meta">
                          {isDone ? `${step.completedBy ?? ""} ${step.completedAt ?? ""}`.trim() : isProgress ? "In progress" : ""}
                        </span>
                        <button type="button" className="xd-step-expand-btn" onClick={() => toggleStepExpanded(step.id)}>
                          {isExpanded ? "Hide details ▲" : "Details ▼"}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="xd-step-details">
                          <label>
                            <input
                              type="checkbox"
                              checked={step.required !== false}
                              disabled={isReadOnly}
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
                              disabled={isReadOnly}
                              onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { timerMinutes: Number(e.target.value) })}
                            />
                          </label>
                          {lots.length > 0 && (
                            <select
                              value={step.reagentLotId ?? ""}
                              disabled={isReadOnly}
                              onChange={(e) => linkProtocolStepLot(detail.id, step.id, e.target.value || null)}
                            >
                              <option value="">No lot linked</option>
                              {lots.map((lot) => (
                                <option key={lot.id} value={lot.id}>{lot.label}</option>
                              ))}
                            </select>
                          )}
                          <input
                            defaultValue={step.note ?? ""}
                            disabled={isReadOnly}
                            placeholder="Step note"
                            onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { note: e.target.value })}
                          />
                          <input
                            defaultValue={step.deviation ?? ""}
                            disabled={isReadOnly}
                            placeholder="Deviation"
                            onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { deviation: e.target.value })}
                          />
                          {!isReadOnly && (
                            <label className="xd-step-file-btn">
                              Step file
                              <input type="file" onChange={(e) => handleUpload(e.target.files?.[0], step.id)} />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="xd-section">
              <span className="xd-section-label">Notebook Notes</span>
              {!isReadOnly && (
                <div className="xd-snippets">
                  {NOTE_SNIPPETS.map((snippet) => (
                    <button key={snippet.label} type="button" className="xd-chip" onClick={() => insertNoteSnippet(snippet.value())}>
                      {snippet.label}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="xd-textarea"
                value={notes}
                disabled={isReadOnly}
                rows={lineRows(notes)}
                placeholder="Methods, calculations, deviations, and running notes..."
                onChange={(e) => {
                  setNotes(e.target.value);
                  markDirty();
                }}
              />
            </div>

            <div className="xd-section">
              <span className="xd-section-label">Observations</span>
              <textarea
                className="xd-textarea"
                value={observations}
                disabled={isReadOnly}
                rows={lineRows(observations)}
                placeholder="Results, anomalies, images reviewed, and interpretation..."
                onChange={(e) => {
                  setObservations(e.target.value);
                  markDirty();
                }}
              />
            </div>

            <div className="xd-section">
              <div className="xd-section-row">
                <span className="xd-section-label">Structured Blocks</span>
              </div>
              <div className="xd-block-templates">
                {AUTHORING_TEMPLATES.map((template, index) => (
                  <button key={template.label} type="button" className="xd-chip" disabled={isReadOnly} onClick={() => addTemplateBlock(index)}>
                    {template.label}
                  </button>
                ))}
              </div>
              <div className="xd-block-list">
                {detail.authoringBlocks.length === 0 && <p className="xd-block-empty">No rich blocks yet.</p>}
                {detail.authoringBlocks.map((block) => (
                  <div key={block.id} className="xd-block">
                    <div className="xd-block-head">
                      <div>
                        <span className="xd-block-title">{block.title}</span>
                        <span className="xd-block-kind">{block.kind}{block.required ? " · required" : ""}</span>
                      </div>
                      {!isReadOnly && (
                        <div className="xd-block-actions">
                          <button type="button" onClick={() => editAuthoringBlock(block)}>Edit</button>
                          <button type="button" onClick={() => deleteAuthoringBlock(block.id)}>Delete</button>
                        </div>
                      )}
                    </div>
                    <div className="xd-block-body">{renderAuthoringBlock(block)}</div>
                  </div>
                ))}
              </div>
              {!isReadOnly && (
                <div className="xd-block-builder">
                  <div className="xd-block-builder-row">
                    <select value={blockKind} onChange={(e) => setBlockKind(e.target.value as AuthoringBlockKind)}>
                      <option value="text">Text</option>
                      <option value="table">Table / CSV</option>
                      <option value="image">Image Note</option>
                      <option value="equation">Equation</option>
                      <option value="checklist">Checklist</option>
                      <option value="data">Structured Data</option>
                    </select>
                    <input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} placeholder="Block title" />
                    <label className="xd-checkbox-label">
                      <input type="checkbox" checked={blockRequired} onChange={(e) => setBlockRequired(e.target.checked)} />
                      Required before signing
                    </label>
                  </div>
                  <textarea value={blockContent} onChange={(e) => setBlockContent(e.target.value)} rows={3} placeholder="Paste table data, equation, checklist, or structured observations..." />
                  <div className="xd-block-builder-row">
                    <button type="button" className="xd-btn-ghost" onClick={saveAuthoringBlock}>{editingBlockId ? "Save Block" : "Add Block"}</button>
                    {editingBlockId && <button type="button" className="xd-btn-ghost" onClick={resetBlockForm}>Cancel Edit</button>}
                  </div>
                </div>
              )}
            </div>

            {detail.aiInsights.length > 0 && (
              <div className="xd-section">
                <span className="xd-section-label">AI Insights</span>
                <div className="xd-insights">
                  {detail.aiInsights.map((insight) => {
                    const dot = insight.kind === "alert" ? "#f87171" : insight.kind === "success" ? "#4ade80" : "#93c5fd";
                    const bg = insight.kind === "alert" ? "#1e1315" : insight.kind === "success" ? "#0f1e15" : "#0f1c2e";
                    const border = insight.kind === "alert" ? "#3a1e21" : insight.kind === "success" ? "#1c3d2a" : "#1c2e45";
                    return (
                      <div key={insight.id} className="xd-insight" style={{ background: bg, border: `1px solid ${border}` }}>
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                          <circle cx="7.5" cy="7.5" r="3" fill={dot} />
                          <path d="M7.5 2v1.5M7.5 11.5V13M2 7.5h1.5M11.5 7.5H13" stroke={dot} strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                        <div>
                          <div className="xd-insight-title">{insight.title}</div>
                          <div className="xd-insight-body">{insight.body}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="xd-rail">
          <div className="xd-rail-tabs">
            {railTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`xd-rail-tab${panelTab === tab.key ? " active" : ""}`}
                onClick={() => setPanelTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="xd-rail-content">
            {panelTab === "ai" && (
              detail.aiInsights.length === 0
                ? <p className="xd-rail-empty">No AI insights yet.</p>
                : detail.aiInsights.map((insight) => (
                    <div key={insight.id} className="xd-history-entry">
                      <div className="xd-history-action">{insight.title}</div>
                      <div className="xd-history-summary">{insight.body}</div>
                    </div>
                  ))
            )}

            {panelTab === "review" && (
              <>
                <div className="xd-review-row"><span>Status</span><strong>{detail.reviewStatus ?? "none"}</strong></div>
                <div className="xd-review-row"><span>Requested</span><strong>{detail.reviewRequestedBy || "Not requested"}</strong></div>
                <div className="xd-review-row"><span>Reviewer</span><strong>{detail.reviewAssignedToName || "Unassigned"}</strong></div>
                <div className="xd-review-row"><span>Due</span><strong>{detail.reviewDueDate || "No due date"}</strong></div>
                {signingIssues.length > 0 && (
                  <div className="xd-signing-blockers">
                    <strong>Signing Blockers</strong>
                    {signingIssues.map((issue) => <span key={issue}>{issue}</span>)}
                  </div>
                )}
                <input className="xd-review-input" value={reviewerName} disabled={isReadOnly} onChange={(e) => setReviewerName(e.target.value)} placeholder="Assigned reviewer name" />
                <input className="xd-review-input" type="date" value={reviewDueDate} disabled={isReadOnly} onChange={(e) => setReviewDueDate(e.target.value)} />
                <textarea className="xd-review-input" value={reviewDraft} disabled={isReadOnly && !canReviewExperiment} onChange={(e) => setReviewDraft(e.target.value)} placeholder="Review note or rejection reason..." rows={3} />
                <textarea className="xd-review-input" value={signatureDraft} disabled={isReadOnly} onChange={(e) => setSignatureDraft(e.target.value)} placeholder="Signature meaning/comment..." rows={2} />
                {isLocked && (
                  <textarea className="xd-review-input" value={amendmentDraft} onChange={(e) => setAmendmentDraft(e.target.value)} placeholder="Amendment reason..." rows={2} />
                )}
                <span className="xd-rail-subhead">Signatures</span>
                {detail.signatures.length === 0 && <p className="xd-rail-empty">No signatures yet.</p>}
                {detail.signatures.map((signature) => (
                  <div key={signature.id} className="xd-history-entry">
                    <div className="xd-history-action">{signature.signerName} — {signature.meaning}</div>
                    <div className="xd-history-meta">{new Date(signature.signedAt).toLocaleString()}</div>
                  </div>
                ))}
                <span className="xd-rail-subhead">Versions</span>
                {detail.versions.length === 0 && <p className="xd-rail-empty">No version history yet.</p>}
                {detail.versions.map((version) => (
                  <div key={version.id} className="xd-history-entry">
                    <div className="xd-history-action">v{version.versionNumber}.{version.revisionNumber ?? 0} — {version.label}</div>
                    <div className="xd-history-meta">
                      {new Date(version.createdAt).toLocaleString()} by {version.createdBy} on {version.deviceLabel ?? "unknown device"}
                    </div>
                    <div className="xd-history-summary">{version.snapshotSummary}</div>
                    {(version.fieldChanges?.length ?? 0) > 0 && (
                      <div className="xd-change-list">
                        {version.fieldChanges?.map((change, index) => (
                          <div key={`${version.id}-${change.field}-${index}`} className="xd-change">
                            <strong>{change.field}</strong>
                            <span>{change.before}</span>
                            <span>→</span>
                            <span>{change.after}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {panelTab === "comments" && (
              detail.comments.length === 0
                ? <p className="xd-rail-empty">No comments yet.</p>
                : detail.comments.map((c) => (
                    <div key={c.id} className="xd-comment">
                      <div className="xd-comment-head">
                        <div className="xd-avatar">{c.initials}</div>
                        <span className="xd-comment-author">{c.author}</span>
                        <span className="xd-comment-time">{c.postedAt}</span>
                      </div>
                      <p className="xd-comment-body">{c.body}</p>
                    </div>
                  ))
            )}

            {panelTab === "tasks" && (
              experimentTasks.length === 0
                ? <p className="xd-rail-empty">No linked tasks.</p>
                : experimentTasks.map((task) => (
                    <div key={task.id} className="xd-task">
                      <div className="xd-task-head">
                        <span className="xd-task-title">{task.title}</span>
                        <span className="xd-task-status">{task.status.replace("_", " ")}</span>
                      </div>
                      <p className="xd-task-desc">{task.description || "No description."}</p>
                    </div>
                  ))
            )}

            {panelTab === "history" && (
              detail.history.length === 0
                ? <p className="xd-rail-empty">No history yet.</p>
                : detail.history.map((h) => (
                    <div key={h.id} className="xd-history-entry">
                      <div className="xd-history-action">{h.actor} — {h.action}</div>
                      <div className="xd-history-meta">{h.timestamp}{h.deviceLabel ? ` · ${h.deviceLabel}` : ""}</div>
                    </div>
                  ))
            )}

            {panelTab === "files" && (
              <>
                {experimentAttachments.length === 0
                  ? <p className="xd-rail-empty">No files attached yet.</p>
                  : experimentAttachments.map((file) => (
                      <a key={file.id} className="xd-file-row" href={file.downloadURL} target="_blank" rel="noreferrer">
                        <span>{file.fileName}</span>
                        <small>{Math.ceil(file.size / 1024)} KB</small>
                      </a>
                    ))}
                {!isReadOnly && (
                  <label className="xd-file-btn xd-upload-row">
                    {uploadState || "Upload File"}
                    <input type="file" onChange={(e) => handleUpload(e.target.files?.[0])} />
                  </label>
                )}
              </>
            )}
          </div>

          {panelTab === "comments" && (
            <div className="xd-rail-footer">
              <input
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
    </div>
  );
}
