import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentEditor.css";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIcon } from "../components/icons";
import { SecureAttachmentDownloadButton, SecureAttachmentImage } from "../components/SecureAttachment";
import type { AuthoringBlock, AuthoringBlockKind, ExperimentStatus, NoteEditEvent, ProtocolStepStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";
import { AUTHORING_TEMPLATES, parseChecklist, parseDelimitedRows, parseKeyValueRows } from "../lib/authoringBlocks";
import { getClientDeviceIdentity } from "../lib/deviceIdentity";

type PanelTab = "details" | "protocol" | "blocks" | "ai" | "comments" | "history" | "files" | "review" | "tasks";
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

const NOTE_EDIT_QUEUE_PREFIX = "labos.noteEdits.pending.";

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
    recordNoteEdit,
    subscribeNoteEdits,
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

  const [panelTab, setPanelTab] = useState<PanelTab>("details");
  const [panelOpen, setPanelOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
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
  const [saveError, setSaveError] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [uploadState, setUploadState] = useState("");
  const [noteEditEvents, setNoteEditEvents] = useState<NoteEditEvent[]>([]);
  const [noteEditError, setNoteEditError] = useState("");
  const [pendingNoteEditCount, setPendingNoteEditCount] = useState(0);
  const deviceIdentity = useMemo(() => getClientDeviceIdentity(), []);
  const isSyncingNoteEdits = useRef(false);

  const flushPendingNoteEdits = useCallback(async (experimentId: string) => {
    if (isSyncingNoteEdits.current) return;
    isSyncingNoteEdits.current = true;
    try {
      while (true) {
        const pending = readPendingNoteEdits(experimentId);
        setPendingNoteEditCount(pending.length);
        const next = pending[0];
        if (!next) {
          setNoteEditError("");
          return;
        }
        try {
          await recordNoteEdit(experimentId, next);
          const remaining = readPendingNoteEdits(experimentId).filter((event) => event.id !== next.id);
          writePendingNoteEdits(experimentId, remaining);
          setPendingNoteEditCount(remaining.length);
        } catch (error) {
          setNoteEditError(error instanceof Error ? error.message : "This edit is waiting to sync.");
          return;
        }
      }
    } finally {
      isSyncingNoteEdits.current = false;
    }
  }, [recordNoteEdit]);

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
    setNotes([
      detail.notes?.trim(),
      detail.observations?.trim() ? `Observations & interpretation\n${detail.observations.trim()}` : "",
    ].filter(Boolean).join("\n\n"));
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
    setSaveError("");
    setDraftRevision(0);
    setSavedRevision(0);
  }, [detail]);

  useEffect(() => {
    if (!id) return undefined;
    setNoteEditEvents([]);
    setNoteEditError("");
    return subscribeNoteEdits(
      id,
      (events) => {
        setNoteEditEvents((current) => {
          const merged = new Map(current.map((event) => [event.id, event]));
          events.forEach((event) => merged.set(event.id, event));
          return [...merged.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        });
      },
      (error) => {
        setNoteEditError(error.message || "The shared edit history is unavailable.");
      },
    );
  }, [id, subscribeNoteEdits]);

  useEffect(() => {
    if (!id) return;
    const pending = readPendingNoteEdits(id);
    setPendingNoteEditCount(pending.length);
    if (pending.length > 0) {
      setNoteEditEvents((current) => mergeNoteEditEvents(current, pending));
      void flushPendingNoteEdits(id);
    }
  }, [flushPendingNoteEdits, id]);

  useEffect(() => {
    if (
      !detail
      || detail.locked
      || detail.status === "review"
      || draftRevision === savedRevision
      || saveState === "saving"
    ) return undefined;

    const revisionAtSchedule = draftRevision;
    const timeout = window.setTimeout(() => {
      void (async () => {
        setSaveState("saving");
        setSaveError("");
        try {
          await saveExperiment(detail.id, {
            name: title,
            objective,
            notes,
            observations: "",
            status,
            projectId: projectId || null,
            notebook,
            dueDate: dueDate || null,
            tags: tagsDraft.split(","),
          });
          setSavedRevision(revisionAtSchedule);
          setSaveState("saved");
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : "Unable to save this experiment.");
          setSaveState("idle");
        }
      })();
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [detail, draftRevision, dueDate, notebook, notes, objective, projectId, saveExperiment, savedRevision, saveState, status, tagsDraft, title]);

  const notebookStats = useMemo(
    () => ({
      objective: textStats(objective),
      notes: textStats(notes),
    }),
    [objective, notes],
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

  const markDirty = () => {
    setSaveState("idle");
    setSaveError("");
    setDraftRevision((revision) => revision + 1);
  };
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
    if (signingIssues.length > 0 || !canAuthorSignExperiment) {
      setPanelTab("review");
      setPanelOpen(true);
      setSignatureError(
        signingIssues.length > 0
          ? `Complete these items before e-signing: ${signingIssues.join(" · ")}`
          : "An assigned independent reviewer must approve this experiment before it can be signed.",
      );
      return;
    }
    if (needsSignaturePassword && !signaturePassword) {
      setPanelTab("review");
      setPanelOpen(true);
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
      setPanelOpen(true);
      setSignatureError(err instanceof Error ? err.message : "Unable to create the electronic signature.");
    } finally {
      setIsSigning(false);
    }
  };

  const handleReviewRequest = async () => {
    if (!reviewerUid) {
      setPanelTab("review");
      setPanelOpen(true);
      setReviewError("Choose an active, independent owner, admin, or PI before requesting review.");
      return;
    }

    setReviewError("");
    setReviewAction("request");
    try {
      await submitExperimentForReview(detail.id, reviewerUid, reviewDraft, reviewDueDate || null);
    } catch (err) {
      setPanelTab("review");
      setPanelOpen(true);
      setReviewError(err instanceof Error ? err.message : "Unable to request independent review.");
    } finally {
      setReviewAction(null);
    }
  };

  const handleReviewDecision = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reviewDraft.trim()) {
      setPanelTab("review");
      setPanelOpen(true);
      setReviewError("A clear reason is required when requesting changes.");
      return;
    }
    if (needsSignaturePassword && !reviewPassword) {
      setPanelTab("review");
      setPanelOpen(true);
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
      setPanelOpen(true);
      setReviewError(err instanceof Error ? err.message : "Unable to record the independent review decision.");
    } finally {
      setReviewAction(null);
    }
  };

  const handleSave = async () => {
    if (isReadOnly) {
      setSaveError("This experiment is read-only and cannot be saved.");
      return;
    }
    if (saveState === "saving") return;
    const revisionAtSave = draftRevision;
    setSaveState("saving");
    setSaveError("");
    try {
      await saveExperiment(detail.id, {
        name: title,
        objective,
        notes,
        observations: "",
        status,
        projectId: projectId || null,
        notebook,
        dueDate: dueDate || null,
        tags: tagsDraft.split(","),
      });
      setSavedRevision(revisionAtSave);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save this experiment.");
      setSaveState("idle");
    }
  };

  const applyNoteChange = (nextNotes: string) => {
    const event = createNoteEditEvent(notes, nextNotes, {
      experimentId: detail.id,
      actorUid: activeMember?.uid ?? user?.uid ?? "unknown-user",
      actorName: activeMember?.displayName ?? user?.name ?? "Unknown editor",
      deviceId: deviceIdentity.deviceId,
      deviceLabel: deviceIdentity.deviceLabel,
      sessionId: deviceIdentity.sessionId,
    });
    setNotes(nextNotes);
    markDirty();
    if (!event) return;
    setNoteEditEvents((current) => mergeNoteEditEvents(current, [event]));
    setNoteEditError("");
    const pending = mergeNoteEditEvents(readPendingNoteEdits(detail.id), [event]);
    writePendingNoteEdits(detail.id, pending);
    setPendingNoteEditCount(pending.length);
    void flushPendingNoteEdits(detail.id);
  };

  const insertNoteSnippet = (snippet: string) => {
    const separator = notes.trim() ? "\n\n" : "";
    applyNoteChange(`${notes}${separator}${snippet}`);
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


  const openPanel = (tab: PanelTab) => {
    if (panelOpen && panelTab === tab) {
      setPanelOpen(false);
      return;
    }
    setPanelTab(tab);
    setPanelOpen(true);
  };

  const totalWords = notebookStats.objective.words + notebookStats.notes.words;
  const completedSteps = detail.protocol.filter((step) => step.status === "done").length;
  const recentDeletions = noteEditEvents.filter((event) => event.deletedText).slice(-12).reverse();

  return (
    <div className="focus-editor-shell">
      <header className="focus-editor-header">
        <button className="focus-back-button" type="button" onClick={() => navigate("/dashboard")} aria-label="Back to experiments">
          ←
        </button>
        <div className="focus-editor-identity">
          <span>{detail.project}</span>
          <strong>{detail.id}</strong>
        </div>
        <div className="focus-editor-state">
          <StatusBadge status={status} />
          <span className={`focus-save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveError ? "Save failed" : draftRevision === savedRevision ? "All changes saved" : "Unsaved changes"}</span>
        </div>
        <div className="focus-editor-actions">
          {canRequestReview && (
            <button className="focus-quiet-button" disabled={reviewAction !== null} onClick={() => void handleReviewRequest()}>
              {reviewAction === "request" ? "Requesting…" : "Send to review"}
            </button>
          )}
          {canReviewExperiment && (
            <>
              <button className="focus-quiet-button" disabled={reviewAction !== null} onClick={() => void handleReviewDecision("approved")}>Approve</button>
              <button className="focus-quiet-button" disabled={reviewAction !== null} onClick={() => void handleReviewDecision("rejected")}>Request changes</button>
            </>
          )}
          {!isLocked && detail.ownerUid === activeMember?.uid && (
            <button className="focus-quiet-button" disabled={isSigning} onClick={handleSign}>
              {isSigning ? "Signing…" : "E-sign"}
            </button>
          )}
          {isLocked && <button className="focus-quiet-button" onClick={startAmendment}>Amend</button>}
          <button className="focus-quiet-button" onClick={() => navigate(`/experiments/${detail.id}/report`)}>Report</button>
          <button className="focus-save-button" disabled={isReadOnly || saveState === "saving"} onClick={handleSave}>
            {saveState === "saving" ? "Saving" : "Save"}
          </button>
        </div>
      </header>

      {saveError && <div className="focus-save-error" role="alert">{saveError}</div>}

      <main className="focus-canvas-wrap">
        <article className="focus-paper">
          <div className="focus-paper-meta">
            <span>{notebook || "General Notebook"}</span>
            <span>{totalWords} words</span>
            <span>Edited {detail.modified}</span>
          </div>

          <input
            className="focus-title-input"
            value={title}
            disabled={isReadOnly}
            aria-label="Experiment title"
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
          />

          <label className="focus-writing-section focus-objective-section">
            <span className="focus-section-label">Objective</span>
            <textarea
              value={objective}
              disabled={isReadOnly}
              rows={3}
              placeholder="What are you trying to learn?"
              onChange={(e) => {
                setObjective(e.target.value);
                markDirty();
              }}
            />
          </label>

          <section className="focus-writing-section focus-notes-section">
            <div className="focus-notes-heading">
              <span className="focus-section-label">Experiment notes</span>
              {!isReadOnly && (
                <div className="focus-snippets">
                  {NOTE_SNIPPETS.map((snippet) => (
                    <button key={snippet.label} type="button" onClick={() => insertNoteSnippet(snippet.value())}>{snippet.label}</button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              className="focus-notes-input"
              value={notes}
              disabled={isReadOnly}
              rows={24}
              placeholder="Start writing. Capture methods, calculations, results, deviations, and anything you notice…"
              onChange={(e) => applyNoteChange(e.target.value)}
            />
            {recentDeletions.length > 0 && (
              <aside className="focus-tracked-deletions" aria-label="Tracked deletions from experiment notes">
                <div className="focus-tracked-deletions-header">
                  <span>Tracked deletions</span>
                  <small>Hover for editor, device, and time</small>
                </div>
                <div className="focus-tracked-deletions-list">
                  {recentDeletions.map((event) => (
                    <del
                      key={event.id}
                      title={`${new Date(event.occurredAt).toLocaleString()} · ${event.actorName} · Device ${event.deviceId}`}
                    >
                      {visibleEditText(event.deletedText)}
                    </del>
                  ))}
                </div>
              </aside>
            )}
          </section>

          <div className="focus-paper-end"><span>End of current entry</span></div>
        </article>
      </main>

      <aside className={`floating-workspace${panelOpen ? " open" : ""}`} aria-label="Experiment tools">
        <nav className="floating-tool-rail">
          <button className={panelTab === "details" && panelOpen ? "active" : ""} onClick={() => openPanel("details")} title="Details" aria-label="Details">⌁</button>
          <button className={panelTab === "protocol" && panelOpen ? "active" : ""} onClick={() => openPanel("protocol")} title="Protocol" aria-label="Protocol">✓<small>{completedSteps}/{detail.protocol.length}</small></button>
          <button className={panelTab === "blocks" && panelOpen ? "active" : ""} onClick={() => openPanel("blocks")} title="Structured blocks" aria-label="Structured blocks">▤<small>{detail.authoringBlocks.length}</small></button>
          <button className={panelTab === "ai" && panelOpen ? "active" : ""} onClick={() => openPanel("ai")} title="AI insights" aria-label="AI insights">✦<small>{detail.aiInsights.length}</small></button>
          <button className={panelTab === "comments" && panelOpen ? "active" : ""} onClick={() => openPanel("comments")} title="Comments" aria-label="Comments">◌<small>{detail.comments.length}</small></button>
          <button className={panelTab === "tasks" && panelOpen ? "active" : ""} onClick={() => openPanel("tasks")} title="Tasks" aria-label="Tasks">◇<small>{experimentTasks.length}</small></button>
          <button className={panelTab === "files" && panelOpen ? "active" : ""} onClick={() => openPanel("files")} title="Files" aria-label="Files">↥<small>{experimentAttachments.length}</small></button>
          <button className={panelTab === "review" && panelOpen ? "active" : ""} onClick={() => openPanel("review")} title="Review and signatures" aria-label="Review and signatures">⌾</button>
          <button className={panelTab === "history" && panelOpen ? "active" : ""} onClick={() => openPanel("history")} title="History" aria-label="History">↺<small>{noteEditEvents.length}</small></button>
        </nav>

        {panelOpen && (
          <section className="floating-panel">
            <div className="floating-panel-header">
              <div>
                <span>Experiment workspace</span>
                <h2>{panelTab === "ai" ? "AI insights" : panelTab === "blocks" ? "Structured blocks" : panelTab[0].toUpperCase() + panelTab.slice(1)}</h2>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close panel">×</button>
            </div>
            <div className="floating-panel-content">
              {panelTab === "details" && (
                <div className="focus-details-form">
                  <label><span>Status</span><select value={status} disabled={isReadOnly} onChange={(e) => { setStatus(e.target.value as ExperimentStatus); markDirty(); }}>{status === "review" && <option value="review">Review</option>}{status === "complete" && <option value="complete">Complete</option>}{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>Project</span><select value={projectId} disabled={isReadOnly} onChange={(e) => { setProjectId(e.target.value); markDirty(); }}><option value="">Unlinked</option>{projectRecords.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                  <label><span>Notebook</span><input value={notebook} disabled={isReadOnly} onChange={(e) => { setNotebook(e.target.value); markDirty(); }} /></label>
                  <label><span>Due date</span><input type="date" value={dueDate} disabled={isReadOnly} onChange={(e) => { setDueDate(e.target.value); markDirty(); }} /></label>
                  <label><span>Tags</span><input value={tagsDraft} disabled={isReadOnly} onChange={(e) => { setTagsDraft(e.target.value); markDirty(); }} placeholder="Comma separated" /></label>
                  <label><span>Protocol template</span><select value={detail.protocolTemplateId ?? ""} disabled={isReadOnly} onChange={(e) => e.target.value && attachProtocolTemplate(detail.id, e.target.value)}><option value="">Default checklist</option>{protocolTemplates.filter((template) => template.status === "active" && template.steps.some((step) => step.trim())).map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}</select></label>
                  <div className="focus-upload-row">
                    <label>{uploadState || "Upload file"}<input type="file" disabled={isReadOnly} onChange={(e) => handleUpload(e.target.files?.[0])} /></label>
                    <label>Inline image<input type="file" accept="image/*" disabled={isReadOnly} onChange={(e) => handleInlineImageUpload(e.target.files?.[0])} /></label>
                  </div>
                  {(isLocked || !canEditExperiment) && <p className="focus-readonly-note">{isLocked ? "This signed experiment is locked." : "You have read-only access to this experiment."}</p>}
                </div>
              )}

              {panelTab === "protocol" && (
                <div className="focus-protocol-list">
                  <p className="focus-panel-intro">Click a step to move it from pending to in progress to done.</p>
                  {detail.protocol.map((step) => (
                    <details key={step.id} className={`focus-protocol-step ${step.status}`}>
                      <summary>
                        <button type="button" disabled={isReadOnly} onClick={(e) => { e.preventDefault(); void toggleStep(step.id, step.status); }}>{step.status === "done" ? <CheckIcon /> : <span />}</button>
                        <strong>{step.label}</strong>
                        <em>{step.status.replace("_", " ")}</em>
                      </summary>
                      <div className="focus-step-controls">
                        {lots.length > 0 && <label><span>Reagent lot</span><select value={step.reagentLotId ?? ""} disabled={isReadOnly} onChange={(e) => linkProtocolStepLot(detail.id, step.id, e.target.value || null)}><option value="">No lot linked</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.label}</option>)}</select></label>}
                        <label><span>Timer (min)</span><input type="number" min={0} defaultValue={step.timerMinutes ?? 0} disabled={isReadOnly} onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { timerMinutes: Number(e.target.value) })} /></label>
                        <label><span>Step note</span><textarea defaultValue={step.note ?? ""} disabled={isReadOnly} onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { note: e.target.value })} /></label>
                        <label><span>Deviation</span><textarea defaultValue={step.deviation ?? ""} disabled={isReadOnly} onBlur={(e) => updateProtocolStepDetails(detail.id, step.id, { deviation: e.target.value })} /></label>
                        {!isReadOnly && <label className="focus-file-control">Attach step file<input type="file" onChange={(e) => handleUpload(e.target.files?.[0], step.id)} /></label>}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {panelTab === "blocks" && (
                <div className="focus-blocks-panel">
                  <p className="focus-panel-intro">Add structured evidence without crowding your writing surface.</p>
                  <div className="focus-template-grid">{AUTHORING_TEMPLATES.map((template, index) => <button key={template.label} type="button" disabled={isReadOnly} onClick={() => addTemplateBlock(index)}>{template.label}</button>)}</div>
                  {detail.authoringBlocks.length === 0 && <p className="authoring-empty">No structured blocks yet.</p>}
                  {detail.authoringBlocks.map((block) => (
                    <div key={block.id} className="authoring-block">
                      <div className="authoring-block-header"><div><strong>{block.title}</strong><span>{block.kind}{block.required ? " · required" : ""}</span></div>{!isReadOnly && <div className="authoring-block-actions"><button type="button" onClick={() => editAuthoringBlock(block)}>Edit</button><button type="button" onClick={() => deleteAuthoringBlock(block.id)}>Delete</button></div>}</div>
                      {renderAuthoringBlock(block)}
                    </div>
                  ))}
                  {!isReadOnly && <div className="authoring-builder"><select value={blockKind} onChange={(e) => setBlockKind(e.target.value as AuthoringBlockKind)}><option value="text">Text</option><option value="table">Table / CSV</option><option value="image">Image note</option><option value="equation">Equation</option><option value="checklist">Checklist</option><option value="data">Structured data</option></select><input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} placeholder="Block title" /><label className="authoring-required-toggle"><input type="checkbox" checked={blockRequired} onChange={(e) => setBlockRequired(e.target.checked)} />Required before signing</label><textarea value={blockContent} onChange={(e) => setBlockContent(e.target.value)} rows={5} placeholder="Add block content…" /><div className="workbench-actions"><button type="button" onClick={saveAuthoringBlock}>{editingBlockId ? "Save block" : "Add block"}</button>{editingBlockId && <button type="button" onClick={resetBlockForm}>Cancel</button>}</div></div>}
                </div>
              )}

              {panelTab === "ai" && detail.aiInsights.map((insight) => <div key={insight.id} className={`insight-card ${insight.kind}`}><div className="insight-card-title">{insight.title}</div><p className="insight-card-body">{insight.body}</p></div>)}

              {panelTab === "comments" && <>{detail.comments.map((comment) => <div key={comment.id} className="comment-card"><div className="comment-card-header"><div className="comment-avatar">{comment.initials}</div><span className="comment-author">{comment.author}</span><span className="comment-time">{comment.postedAt}</span></div><p className="comment-body">{comment.body}</p></div>)}<div className="focus-comment-composer"><input placeholder="Add a comment…" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitComment(); }} /><button type="button" onClick={() => void submitComment()}>Send</button></div></>}

              {panelTab === "tasks" && <>{experimentTasks.length === 0 && <p className="focus-panel-intro">No tasks attached to this experiment.</p>}{experimentTasks.map((task) => <div key={task.id} className="comment-card"><div className="comment-card-header"><span className="comment-author">{task.title}</span><span className="comment-time">{task.status.replace("_", " ")}</span></div><p className="comment-body">{task.description || "No description."}</p></div>)}</>}

              {panelTab === "files" && <>{experimentAttachments.length === 0 && <p className="focus-panel-intro">No files attached yet.</p>}{experimentAttachments.map((file) => <SecureAttachmentDownloadButton key={file.id} attachment={file} className="attachment-row" />)}</>}

              {panelTab === "history" && (
                <div className="note-history-panel">
                  <div className="note-history-heading">
                    <div><span>Experiment notes</span><strong>Keystroke history</strong></div>
                    <small>{noteEditEvents.length} changes</small>
                  </div>
                  <p className="focus-panel-intro">Hover over any change to see its exact timestamp, editor, and device ID.</p>
                  {(noteEditError || pendingNoteEditCount > 0) && <div className="note-history-sync-error" role="alert">{pendingNoteEditCount > 0 ? `${pendingNoteEditCount} edit${pendingNoteEditCount === 1 ? " is" : "s are"} safely queued and waiting to sync.` : ""}{noteEditError ? ` ${noteEditError}` : ""}</div>}
                  {noteEditEvents.length === 0 && <p className="note-history-empty">No note edits recorded yet. Start typing in Experiment Notes.</p>}
                  <div className="note-edit-list">
                    {[...noteEditEvents].reverse().map((event) => {
                      const tooltip = `${new Date(event.occurredAt).toLocaleString()} · ${event.actorName} · Device ${event.deviceId}`;
                      return (
                        <div key={event.id} className={`note-edit-entry ${event.kind}`} title={tooltip}>
                          <div className="note-edit-meta">
                            <strong>{event.actorName}</strong>
                            <span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                          </div>
                          <div className="note-edit-change">
                            {event.deletedText && <del>{visibleEditText(event.deletedText)}</del>}
                            {event.addedText && <ins>{visibleEditText(event.addedText)}</ins>}
                          </div>
                          <small>Position {event.position + 1} · {event.deviceLabel}</small>
                        </div>
                      );
                    })}
                  </div>
                  {detail.history.length > 0 && <div className="note-history-heading record-history"><div><span>Experiment record</span><strong>Workflow history</strong></div></div>}
                  {detail.history.map((entry) => <div key={entry.id} className="history-entry"><div className="history-action">{entry.actor} — {entry.action}</div><div className="history-meta">{entry.timestamp}{entry.deviceLabel ? ` · ${entry.deviceLabel}` : ""}</div></div>)}
                </div>
              )}

              {panelTab === "review" && (
                <div className="review-panel">
                  <div className="review-row"><span>Status</span><strong>{detail.reviewStatus ?? "none"}</strong></div>
                  <div className="review-row"><span>Reviewer</span><strong>{detail.reviewAssignedToName || "Unassigned"}</strong></div>
                  <div className="review-row"><span>Due</span><strong>{detail.reviewDueDate || "No due date"}</strong></div>
                  {signingIssues.length > 0 && <div className="signing-blocker-box"><strong>Before signing</strong>{signingIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
                  {canRequestReview && <><label className="review-control-label"><span>Independent reviewer</span><select value={reviewerUid} onChange={(e) => { setReviewerUid(e.target.value); setReviewError(""); }}><option value="">Choose reviewer</option>{eligibleReviewers.map((member) => <option key={member.uid} value={member.uid}>{member.displayName} ({member.role})</option>)}</select></label>{eligibleReviewers.length === 0 && <div className="signature-error">Add another active owner, admin, or PI to the lab before requesting independent review.</div>}<label className="review-control-label"><span>Review due date</span><input type="date" value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} /></label><button className="focus-review-action" type="button" disabled={reviewAction !== null} onClick={() => void handleReviewRequest()}>{reviewAction === "request" ? "Requesting…" : "Send to independent review"}</button></>}
                  <textarea value={reviewDraft} disabled={!canRequestReview && !canReviewExperiment} onChange={(e) => setReviewDraft(e.target.value)} placeholder={canReviewExperiment ? "Approval note or required changes…" : "Context for the reviewer…"} rows={4} />
                  {canAuthorSignExperiment && <textarea value={signatureDraft} onChange={(e) => setSignatureDraft(e.target.value)} placeholder="Signature meaning/comment…" rows={3} />}
                  {needsSignaturePassword && canReviewExperiment && <input type="password" value={reviewPassword} disabled={reviewAction !== null} onChange={(e) => { setReviewPassword(e.target.value); setReviewError(""); }} placeholder="Confirm password to review" autoComplete="current-password" />}
                  {needsSignaturePassword && canAuthorSignExperiment && <input type="password" value={signaturePassword} disabled={isLocked || isSigning} onChange={(e) => { setSignaturePassword(e.target.value); setSignatureError(""); }} placeholder="Confirm password to e-sign" autoComplete="current-password" />}
                  {!isLocked && detail.ownerUid === activeMember?.uid && <button className="focus-review-action" type="button" disabled={isSigning} onClick={handleSign}>{isSigning ? "Signing…" : "E-sign experiment"}</button>}
                  {reviewError && <div className="signature-error" role="alert">{reviewError}</div>}{signatureError && <div className="signature-error" role="alert">{signatureError}</div>}
                  {isLocked && <textarea value={amendmentDraft} onChange={(e) => setAmendmentDraft(e.target.value)} placeholder="Amendment reason…" rows={3} />}
                  <h3>Review history</h3>{(detail.reviewEvents?.length ?? 0) === 0 && <p>No review events yet.</p>}{[...(detail.reviewEvents ?? [])].reverse().map((event) => <div key={event.id} className="history-entry"><div className="history-action">{event.actorName} — {event.kind}</div><div className="history-meta">{new Date(event.occurredAt).toLocaleString()}</div>{event.comment && <div className="history-summary">{event.comment}</div>}</div>)}
                  <h3>Signatures</h3>{detail.signatures.length === 0 && <p>No signatures yet.</p>}{detail.signatures.map((signature) => <div key={signature.id} className="history-entry"><div className="history-action">{signature.signerName} — {signature.meaning}</div><div className="history-meta">{new Date(signature.signedAt).toLocaleString()}</div></div>)}
                </div>
              )}
            </div>
          </section>
        )}
      </aside>
    </div>
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

function createNoteEditEvent(
  previous: string,
  next: string,
  metadata: Omit<NoteEditEvent, "id" | "kind" | "position" | "addedText" | "deletedText" | "occurredAt">,
): NoteEditEvent | null {
  if (previous === next) return null;
  let prefixLength = 0;
  const shortestLength = Math.min(previous.length, next.length);
  while (prefixLength < shortestLength && previous[prefixLength] === next[prefixLength]) prefixLength += 1;

  let suffixLength = 0;
  while (
    suffixLength < previous.length - prefixLength
    && suffixLength < next.length - prefixLength
    && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) suffixLength += 1;

  const deletedText = previous.slice(prefixLength, previous.length - suffixLength);
  const addedText = next.slice(prefixLength, next.length - suffixLength);
  const occurredAt = new Date().toISOString();
  return {
    ...metadata,
    id: `note-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: deletedText && addedText ? "replace" : deletedText ? "delete" : "insert",
    position: prefixLength,
    addedText,
    deletedText,
    occurredAt,
  };
}

function visibleEditText(value: string) {
  return value.replace(/\n/g, "↵").replace(/ /g, "␠");
}

function noteEditQueueKey(experimentId: string) {
  return `${NOTE_EDIT_QUEUE_PREFIX}${experimentId}`;
}

function readPendingNoteEdits(experimentId: string): NoteEditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(noteEditQueueKey(experimentId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as NoteEditEvent[] : [];
  } catch {
    return [];
  }
}

function writePendingNoteEdits(experimentId: string, events: NoteEditEvent[]) {
  if (typeof window === "undefined") return;
  try {
    const key = noteEditQueueKey(experimentId);
    if (events.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(events));
  } catch {
    // Keep the in-memory history visible if browser storage is unavailable.
  }
}

function mergeNoteEditEvents(current: NoteEditEvent[], incoming: NoteEditEvent[]) {
  const merged = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => merged.set(event.id, event));
  return [...merged.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
