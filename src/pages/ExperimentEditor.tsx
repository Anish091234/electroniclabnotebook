import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentEditor.css";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIcon } from "../components/icons";
import { SecureAttachmentDownloadButton, SecureAttachmentImage } from "../components/SecureAttachment";
import type { AuthoringBlock, AuthoringBlockKind, ExperimentStatus, ProtocolStepStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";
import { AUTHORING_TEMPLATES, parseChecklist, parseDelimitedRows, parseKeyValueRows } from "../lib/authoringBlocks";

type PanelTab = "ai" | "comments" | "history" | "files" | "review" | "tasks";
type SaveState = "idle" | "saving" | "saved";

const STATUS_OPTIONS: { value: ExperimentStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
];

const NOTE_SNIPPETS = [
  {
    label: "Timestamp",
    value: () => `[${new Date().toLocaleString()}] `,
  },
  {
    label: "Method Note",
    value: () => ["Method:", "Materials:", "Parameters:", "Rationale:"].join("\n"),
  },
  {
    label: "Deviation",
    value: () => ["Deviation:", "Reason:", "Impact:", "Follow-up:"].join("\n"),
  },
  {
    label: "Calculation",
    value: () => ["Calculation:", "Inputs:", "Formula:", "Result:"].join("\n"),
  },
];

export function ExperimentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeMember, firebaseUser, reauthenticateForSignature, user } = useAuth();
  const {
    experimentDetails,
    protocolTemplates,
    inventoryItems,
    projectRecords,
    members,
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
  const [reviewerUid, setReviewerUid] = useState("");
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [signaturePassword, setSignaturePassword] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const [reviewAction, setReviewAction] = useState<"request" | "approve" | "reject" | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [amendmentDraft, setAmendmentDraft] = useState("");
  const [blockKind, setBlockKind] = useState<AuthoringBlockKind>("text");
  const [blockTitle, setBlockTitle] = useState("");
  const [blockContent, setBlockContent] = useState("");
  const [blockRequired, setBlockRequired] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
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
    setReviewerUid(detail.reviewAssignedToUid ?? "");
    setReviewDueDate(detail.reviewDueDate ?? "");
    setSignatureDraft("");
    setReviewPassword("");
    setReviewAction(null);
    setReviewError("");
    setAmendmentDraft("");
    setEditingBlockId(null);
    setBlockKind("text");
    setBlockTitle("");
    setBlockContent("");
    setBlockRequired(false);
    setSaveState("idle");
  }, [detail]);

  const notebookStats = useMemo(
    () => ({
      objective: textStats(objective),
      notes: textStats(notes),
      observations: textStats(observations),
    }),
    [objective, notes, observations],
  );

  const eligibleReviewers = useMemo(
    () => members.filter((member) => (
      member.status === "active"
      && ["owner", "admin", "pi"].includes(member.role)
      && member.uid !== detail?.ownerUid
    )),
    [detail?.ownerUid, members],
  );

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
  const canRequestReview =
    !isLocked
    && activeMember?.status === "active"
    && detail.ownerUid === activeMember.uid
    && ["owner", "admin", "pi", "researcher"].includes(activeMember.role)
    && !["requested", "approved"].includes(detail.reviewStatus ?? "none");
  const canReviewExperiment =
    activeMember?.status === "active"
    && ["owner", "admin", "pi"].includes(activeMember.role)
    && detail.reviewStatus === "requested"
    && detail.reviewAssignedToUid === activeMember.uid
    && detail.ownerUid !== activeMember.uid;
  const canAuthorSignExperiment =
    !isLocked
    && activeMember?.status === "active"
    && ["owner", "admin", "pi", "researcher"].includes(activeMember.role)
    && detail.ownerUid === activeMember.uid
    && detail.reviewStatus === "approved";
  const needsSignaturePassword = firebaseUser?.providerData.some((provider) => provider.providerId === "password") ?? false;
  const isReadOnly = isLocked || detail.status === "review" || !canEditExperiment;
  const signingIssues = [
    !detail.objective.trim() ? "Objective is missing" : "",
    !detail.notes.trim() ? "Notebook notes are missing" : "",
    !detail.observations.trim() ? "Observations are missing" : "",
    detail.attachmentIds.length === 0 ? "Raw files are not attached" : "",
    detail.reviewStatus !== "approved" ? "Independent review has not been approved" : "",
    detail.protocol.some((step) => step.status !== "done") ? "Protocol steps are incomplete" : "",
    detail.protocol.some((step) => !step.reagentLotId) ? "Protocol reagent lots are not linked" : "",
    detail.authoringBlocks.some((block) => block.required && !block.content.trim()) ? "Required structured blocks are incomplete" : "",
  ].filter(Boolean);
  const cycleStatus = (current: ProtocolStepStatus): ProtocolStepStatus => {
    if (current === "pending") return "in_progress";
    if (current === "in_progress") return "done";
    return "pending";
  };

  const toggleStep = async (stepId: string, currentStatus: ProtocolStepStatus) => {
    if (isReadOnly) return;
    await updateProtocolStepStatus(detail.id, stepId, cycleStatus(currentStatus));
  };

  const handleSign = async () => {
    if (needsSignaturePassword && !signaturePassword) {
      setPanelTab("review");
      setSignatureError("Enter your account password below to confirm this electronic signature.");
      return;
    }

    setSignatureError("");
    setIsSigning(true);
    try {
      await reauthenticateForSignature(signaturePassword);
      await signExperiment(detail.id, "author", signatureDraft || "Signed as complete and accurate.");
      setSignaturePassword("");
      setSignatureDraft("");
    } catch (err) {
      setPanelTab("review");
      setSignatureError(err instanceof Error ? err.message : "Unable to create the electronic signature.");
    } finally {
      setIsSigning(false);
    }
  };

  const handleReviewRequest = async () => {
    if (!reviewerUid) {
      setPanelTab("review");
      setReviewError("Choose an active, independent owner, admin, or PI before requesting review.");
      return;
    }

    setReviewError("");
    setReviewAction("request");
    try {
      await submitExperimentForReview(detail.id, reviewerUid, reviewDraft, reviewDueDate || null);
    } catch (err) {
      setPanelTab("review");
      setReviewError(err instanceof Error ? err.message : "Unable to request independent review.");
    } finally {
      setReviewAction(null);
    }
  };

  const handleReviewDecision = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reviewDraft.trim()) {
      setPanelTab("review");
      setReviewError("A clear reason is required when requesting changes.");
      return;
    }
    if (needsSignaturePassword && !reviewPassword) {
      setPanelTab("review");
      setReviewError("Enter your account password below to confirm this independent review decision.");
      return;
    }

    setReviewError("");
    setReviewAction(decision === "approved" ? "approve" : "reject");
    try {
      await reauthenticateForSignature(reviewPassword);
      if (decision === "approved") {
        await approveExperimentReview(detail.id, reviewDraft);
      } else {
        await rejectExperimentReview(detail.id, reviewDraft);
      }
      setReviewPassword("");
    } catch (err) {
      setPanelTab("review");
      setReviewError(err instanceof Error ? err.message : "Unable to record the independent review decision.");
    } finally {
      setReviewAction(null);
    }
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
        content: `Authenticated attachment: ${record.fileName}`,
        attachmentId: record.id,
        fileName: record.fileName,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
  };

  const renderAuthoringBlock = (block: AuthoringBlock) => {
    if (block.kind === "table") {
      const rows = parseDelimitedRows(block.content);
      if (rows.length === 0) return <p className="authoring-empty">No table rows.</p>;
      const [header, ...body] = rows;
      return (
        <div className="authoring-table-wrap">
          <table className="authoring-table">
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
        <div className="authoring-checklist">
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
        <dl className="authoring-data-grid">
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
      const attachment = block.attachmentId ? experimentAttachments.find((item) => item.id === block.attachmentId) : undefined;
      return (
        <div className="authoring-image-block">
          <SecureAttachmentImage attachment={attachment} alt={block.title} />
          {block.fileName && <span>{block.fileName}</span>}
        </div>
      );
    }

    if (block.kind === "equation") {
      return <div className="authoring-equation">{block.content}</div>;
    }

    return <div className="authoring-rich-text">{block.content.split(/\n{2,}/).map((paragraph, index) => <p key={`${block.id}-p-${index}`}>{paragraph}</p>)}</div>;
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
          {!isLocked && detail.status === "review" && <span className="editor-lock-pill muted">Review controls record changes</span>}
          {!isLocked && !canEditExperiment && <span className="editor-lock-pill muted">Read Only</span>}
          {canRequestReview && (
            <button className="btn-secondary" disabled={!reviewerUid || reviewAction !== null} onClick={() => void handleReviewRequest()}>
              {reviewAction === "request" ? "Requesting..." : "Submit for Review"}
            </button>
          )}
          {canReviewExperiment && (
            <>
              <button className="btn-secondary" disabled={reviewAction !== null} onClick={() => void handleReviewDecision("approved")}>
                {reviewAction === "approve" ? "Approving..." : "Approve"}
              </button>
              <button className="btn-secondary" disabled={reviewAction !== null} onClick={() => void handleReviewDecision("rejected")}>
                {reviewAction === "reject" ? "Rejecting..." : "Request Changes"}
              </button>
            </>
          )}
          {!isLocked && detail.ownerUid === activeMember?.uid && (
            <button className="btn-secondary" disabled={signingIssues.length > 0 || !canAuthorSignExperiment || isSigning} onClick={handleSign}>
              {isSigning ? "Signing..." : "E-Sign"}
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
          <button className="btn-save" disabled={isReadOnly} onClick={handleSave}>
            {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          <input
            className="editor-title-input"
            value={title}
            disabled={isReadOnly}
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
                disabled={isReadOnly}
                onChange={(e) => {
                  setStatus(e.target.value as ExperimentStatus);
                  markDirty();
                }}
              >
                {status === "review" && <option value="review">Review (workflow controlled)</option>}
                {status === "complete" && <option value="complete">Complete (signed)</option>}
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
                disabled={isReadOnly}
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
                disabled={isReadOnly}
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
                disabled={isReadOnly}
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
                disabled={isReadOnly}
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
                disabled={isReadOnly}
                onChange={(e) => e.target.value && attachProtocolTemplate(detail.id, e.target.value)}
              >
                <option value="">Default checklist</option>
                {protocolTemplates
                  .filter((template) => template.status === "active" && template.steps.some((step) => step.trim()))
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} v{template.version}
                    </option>
                  ))}
              </select>
            </label>
            <label className="toolbar-ai-btn file-upload-btn">
              {uploadState || "Upload File"}
              <input type="file" disabled={isReadOnly} onChange={(e) => handleUpload(e.target.files?.[0])} />
            </label>
            <label className="toolbar-ai-btn file-upload-btn">
              Inline Image
              <input type="file" accept="image/*" disabled={isReadOnly} onChange={(e) => handleInlineImageUpload(e.target.files?.[0])} />
            </label>
          </div>

          <div className="editor-card notebook-card">
            <div className="notebook-header">
              <div>
                <span className="notebook-kicker">Experiment Notebook</span>
                <h3>Record Notes</h3>
                <p>Capture the hypothesis, live run notes, and final interpretation in one review-ready notebook surface.</p>
              </div>
              <div className="notebook-summary">
                <strong>{notebookStats.objective.words + notebookStats.notes.words + notebookStats.observations.words}</strong>
                <span>Total words</span>
              </div>
            </div>

            <div className="notebook-grid">
              <section className="notebook-editor-pane">
                <NotebookField
                  label="Objective"
                  eyebrow="Why this experiment exists"
                  value={objective}
                  disabled={isReadOnly}
                  rows={4}
                  stats={notebookStats.objective}
                  placeholder="State the hypothesis, expected outcome, and success criteria..."
                  onChange={(value) => {
                    setObjective(value);
                    markDirty();
                  }}
                />

                <div className="notebook-field">
                  <div className="notebook-field-header">
                    <div>
                      <span>Live notebook</span>
                      <strong>Notebook Notes</strong>
                    </div>
                    <small>{notebookStats.notes.words} words / {notebookStats.notes.lines} lines</small>
                  </div>
                  {!isReadOnly && (
                    <div className="notebook-snippet-row">
                      {NOTE_SNIPPETS.map((snippet) => (
                        <button key={snippet.label} type="button" className="notebook-chip" onClick={() => insertNoteSnippet(snippet.value())}>
                          {snippet.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    className="objective-textarea notebook-textarea large"
                    value={notes}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      markDirty();
                    }}
                    rows={9}
                    placeholder="Methods, calculations, deviations, and running notes..."
                  />
                </div>

                <NotebookField
                  label="Observations"
                  eyebrow="What happened and what it means"
                  value={observations}
                  disabled={isReadOnly}
                  rows={5}
                  stats={notebookStats.observations}
                  placeholder="Results, anomalies, images reviewed, and interpretation..."
                  onChange={(value) => {
                    setObservations(value);
                    markDirty();
                  }}
                />
              </section>

              <aside className="notebook-preview-pane">
                <div className="notebook-preview-header">
                  <span>Preview</span>
                  <strong>{notebook || "General Notebook"}</strong>
                </div>
                <NotebookPreview title="Objective" value={objective} empty="No objective recorded yet." />
                <NotebookPreview title="Notebook Notes" value={notes} empty="No running notes recorded yet." />
                <NotebookPreview title="Observations" value={observations} empty="No observations recorded yet." />
              </aside>
            </div>

            <h3>Structured Blocks</h3>
            <div className="authoring-template-row">
              {AUTHORING_TEMPLATES.map((template, index) => (
                <button key={template.label} className="btn-secondary" type="button" disabled={isReadOnly} onClick={() => addTemplateBlock(index)}>
                  {template.label}
                </button>
              ))}
            </div>
            <div className="authoring-block-list">
              {detail.authoringBlocks.length === 0 && <p className="authoring-empty">No rich blocks yet.</p>}
              {detail.authoringBlocks.map((block) => (
                <div key={block.id} className="authoring-block">
                  <div className="authoring-block-header">
                    <div>
                      <strong>{block.title}</strong>
                      <span>{block.kind}{block.required ? " required" : ""}</span>
                    </div>
                    {!isReadOnly && (
                      <div className="authoring-block-actions">
                        <button className="btn-secondary" type="button" onClick={() => editAuthoringBlock(block)}>Edit</button>
                        <button className="btn-secondary" type="button" onClick={() => deleteAuthoringBlock(block.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                  {renderAuthoringBlock(block)}
                </div>
              ))}
            </div>
            {!isReadOnly && (
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
                <label className="authoring-required-toggle">
                  <input type="checkbox" checked={blockRequired} onChange={(e) => setBlockRequired(e.target.checked)} />
                  Required before signing
                </label>
                <textarea value={blockContent} onChange={(e) => setBlockContent(e.target.value)} rows={3} placeholder="Paste table data, equation, checklist, or structured observations..." />
                <div className="workbench-actions">
                  <button className="btn-secondary" type="button" onClick={saveAuthoringBlock}>{editingBlockId ? "Save Block" : "Add Block"}</button>
                  {editingBlockId && <button className="btn-secondary" type="button" onClick={resetBlockForm}>Cancel Edit</button>}
                </div>
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
                      disabled={isReadOnly}
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
                <div className="review-row"><span>Reviewer</span><strong>{detail.reviewAssignedToName || "Unassigned"}</strong></div>
                <div className="review-row"><span>Due</span><strong>{detail.reviewDueDate || "No due date"}</strong></div>
                {signingIssues.length > 0 && (
                  <div className="signing-blocker-box">
                    <strong>Signing Blockers</strong>
                    {signingIssues.map((issue) => <span key={issue}>{issue}</span>)}
                  </div>
                )}
                {canRequestReview && (
                  <>
                    <label className="review-control-label">
                      <span>Independent reviewer</span>
                      <select value={reviewerUid} onChange={(e) => setReviewerUid(e.target.value)}>
                        <option value="">Choose an owner, admin, or PI</option>
                        {eligibleReviewers.map((member) => (
                          <option key={member.uid} value={member.uid}>{member.displayName} ({member.role})</option>
                        ))}
                      </select>
                    </label>
                    <label className="review-control-label">
                      <span>Review due date (optional)</span>
                      <input type="date" value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} />
                    </label>
                  </>
                )}
                <textarea
                  value={reviewDraft}
                  disabled={!canRequestReview && !canReviewExperiment}
                  onChange={(e) => setReviewDraft(e.target.value)}
                  placeholder={canReviewExperiment ? "Approval note or required changes..." : "Context for the independent reviewer..."}
                  rows={4}
                />
                {canAuthorSignExperiment && (
                  <textarea value={signatureDraft} onChange={(e) => setSignatureDraft(e.target.value)} placeholder="Signature meaning/comment..." rows={3} />
                )}
                {needsSignaturePassword && canReviewExperiment && (
                  <input
                    type="password"
                    value={reviewPassword}
                    disabled={reviewAction !== null}
                    onChange={(e) => {
                      setReviewPassword(e.target.value);
                      setReviewError("");
                    }}
                    placeholder="Confirm account password to review"
                    autoComplete="current-password"
                  />
                )}
                {needsSignaturePassword && canAuthorSignExperiment && (
                  <input
                    type="password"
                    value={signaturePassword}
                    disabled={isLocked || !canAuthorSignExperiment || isSigning}
                    onChange={(e) => {
                      setSignaturePassword(e.target.value);
                      setSignatureError("");
                    }}
                    placeholder="Confirm account password to e-sign"
                    autoComplete="current-password"
                  />
                )}
                <p>Only the assigned independent reviewer can approve or request changes. Electronic signatures require an approved review, fresh account confirmation, and lock the record after signing.</p>
                {reviewError && <div className="signature-error" role="alert">{reviewError}</div>}
                {signatureError && <div className="signature-error" role="alert">{signatureError}</div>}
                {isLocked && <textarea value={amendmentDraft} onChange={(e) => setAmendmentDraft(e.target.value)} placeholder="Amendment reason..." rows={3} />}
                <h3>Review History</h3>
                {(detail.reviewEvents?.length ?? 0) === 0 && <p>No independent review events yet.</p>}
                {[...(detail.reviewEvents ?? [])].reverse().map((event) => (
                  <div key={event.id} className="history-entry">
                    <div className="history-action">
                      {event.actorName} - {event.kind === "requested" ? "requested review" : event.kind === "approved" ? "approved review" : "requested changes"}
                    </div>
                    <div className="history-meta">
                      {new Date(event.occurredAt).toLocaleString()} {event.kind === "requested" ? `- assigned to ${event.reviewerName}` : ""}
                    </div>
                    {event.dueDate && event.kind === "requested" && <div className="history-summary">Due {event.dueDate}</div>}
                    {event.comment && <div className="history-summary">{event.comment}</div>}
                  </div>
                ))}
                <h3>Signatures</h3>
                {detail.signatures.length === 0 && <p>No signatures yet.</p>}
                {detail.signatures.map((signature) => (
                  <div key={signature.id} className="history-entry">
                    <div className="history-action">{signature.signerName} - {signature.meaning}</div>
                    <div className="history-meta">{new Date(signature.signedAt).toLocaleString()}</div>
                    {signature.manifestSha256 && <div className="history-summary mono">Evidence manifest SHA-256: {signature.manifestSha256}</div>}
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
                <SecureAttachmentDownloadButton key={file.id} attachment={file} className="attachment-row" />
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

type TextStats = {
  words: number;
  lines: number;
};

function textStats(value: string): TextStats {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const lines = value.trim() ? value.split(/\r?\n/).length : 0;
  return { words, lines };
}

function NotebookField({
  label,
  eyebrow,
  value,
  disabled,
  rows,
  stats,
  placeholder,
  onChange,
}: {
  label: string;
  eyebrow: string;
  value: string;
  disabled: boolean;
  rows: number;
  stats: TextStats;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="notebook-field">
      <div className="notebook-field-header">
        <div>
          <span>{eyebrow}</span>
          <strong>{label}</strong>
        </div>
        <small>{stats.words} words / {stats.lines} lines</small>
      </div>
      <textarea
        className="objective-textarea notebook-textarea"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    </label>
  );
}

function NotebookPreview({ title, value, empty }: { title: string; value: string; empty: string }) {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <section className="notebook-preview-section">
      <h4>{title}</h4>
      {paragraphs.length === 0 ? (
        <p className="notebook-preview-empty">{empty}</p>
      ) : (
        paragraphs.map((paragraph, index) => <p key={`${title}-${index}`}>{paragraph}</p>)
      )}
    </section>
  );
}
