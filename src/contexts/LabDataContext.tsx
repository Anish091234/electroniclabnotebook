import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { db, functions, storage } from "../lib/firebase";
import { getClientDeviceIdentity, type ClientDeviceIdentity } from "../lib/deviceIdentity";
import { useAuth } from "./AuthContext";
import type { LabMember } from "../data/accountTypes";
import type {
  AIInsight,
  AuthoringBlock,
  AuditFieldChange,
  AttachmentRecord,
  AuditEvent,
  CollaborationTask,
  Comment,
  CreateExperimentInput,
  Experiment,
  ExperimentDetail,
  ExperimentIntegrityReport,
  ExperimentVersion,
  IntegrationImport,
  InventoryItem,
  InventoryLot,
  NotificationRecord,
  NoteEditEvent,
  ProtocolStep,
  ProtocolTemplate,
  ProjectRecord,
  SaveExperimentInput,
  SaveInventoryItemInput,
  SaveProjectInput,
  SaveProtocolTemplateInput,
  SaveSampleInput,
  SaveTaskInput,
  SampleRecord,
} from "../data/types";

interface LabDataState {
  members: LabMember[];
  experiments: Experiment[];
  experimentDetails: Record<string, ExperimentDetail>;
  protocolTemplates: ProtocolTemplate[];
  inventoryItems: InventoryItem[];
  sampleRecords: SampleRecord[];
  projectRecords: ProjectRecord[];
  notifications: NotificationRecord[];
  collaborationTasks: CollaborationTask[];
  integrationImports: IntegrationImport[];
  auditEvents: AuditEvent[];
  attachments: AttachmentRecord[];
  isLoading: boolean;
  error: string | null;
}

interface LabDataContextValue extends LabDataState {
  createExperiment: (input: CreateExperimentInput) => Promise<Experiment>;
  saveExperiment: (id: string, input: SaveExperimentInput) => Promise<void>;
  recordNoteEdit: (experimentId: string, event: NoteEditEvent) => Promise<void>;
  subscribeNoteEdits: (
    experimentId: string,
    onEvents: (events: NoteEditEvent[]) => void,
    onError?: (error: Error) => void,
  ) => () => void;
  attachProtocolTemplate: (experimentId: string, templateId: string) => Promise<void>;
  updateProtocolStepStatus: (experimentId: string, stepId: string, status: ProtocolStep["status"]) => Promise<void>;
  linkProtocolStepLot: (experimentId: string, stepId: string, lotId: string | null) => Promise<void>;
  addComment: (experimentId: string, body: string) => Promise<void>;
  uploadAttachment: (experimentId: string, file: File, protocolStepId?: string | null) => Promise<AttachmentRecord>;
  submitExperimentForReview: (experimentId: string, reviewerUid: string, comment?: string, reviewDueDate?: string | null) => Promise<void>;
  approveExperimentReview: (experimentId: string, comment?: string) => Promise<void>;
  rejectExperimentReview: (experimentId: string, comment: string) => Promise<void>;
  signExperiment: (experimentId: string, meaning: "author" | "reviewer" | "approver", comment: string) => Promise<void>;
  verifyExperimentIntegrity: (experimentId: string) => Promise<ExperimentIntegrityReport>;
  createExperimentAmendment: (experimentId: string, reason: string) => Promise<Experiment>;
  updateProtocolStepDetails: (experimentId: string, stepId: string, input: Partial<Pick<ProtocolStep, "note" | "deviation" | "required" | "timerMinutes">>) => Promise<void>;
  saveAuthoringBlocks: (experimentId: string, blocks: AuthoringBlock[]) => Promise<void>;
  saveProtocolTemplate: (input: SaveProtocolTemplateInput) => Promise<void>;
  deleteProtocolTemplate: (id: string) => Promise<void>;
  saveInventoryItem: (input: SaveInventoryItemInput) => Promise<void>;
  adjustInventoryLot: (itemId: string, lotId: string, quantity: number) => Promise<void>;
  saveSampleRecord: (input: SaveSampleInput) => Promise<void>;
  saveProjectRecord: (input: SaveProjectInput) => Promise<void>;
  createTask: (input: SaveTaskInput) => Promise<void>;
  updateTaskStatus: (taskId: string, status: CollaborationTask["status"]) => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  recordIntegrationImport: (
    input: Pick<IntegrationImport, "source" | "fileName" | "rowCount" | "summary"> &
      Partial<Pick<IntegrationImport, "importType" | "columns" | "previewRows" | "mapping" | "validationIssues">>,
  ) => Promise<void>;
}

const LabDataContext = createContext<LabDataContextValue | undefined>(undefined);

function requireDb(): Firestore {
  if (!db) throw new Error("Firebase is not configured.");
  return db;
}

function requireStorage(): FirebaseStorage {
  if (!storage) throw new Error("Firebase Storage is not configured.");
  return storage;
}

function requireFunctions() {
  if (!functions) throw new Error("Firebase Functions is not configured.");
  return functions;
}

function nowIso() {
  return new Date().toISOString();
}

function shortTime(value = new Date()) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(value);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function attachmentContentType(file: File) {
  const browserType = file.type.toLowerCase();
  if (Object.values(ATTACHMENT_CONTENT_TYPES).includes(browserType)) return browserType;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ATTACHMENT_CONTENT_TYPES[extension] ?? null;
}

function normalizeTags(tags: string[]) {
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function summarizeAuditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((item) => typeof item === "string")) return value.join(", ");
    return `${value.length} entries`;
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      return text.length > 180 ? `${text.slice(0, 177)}...` : text;
    } catch {
      return "Object changed";
    }
  }
  const text = String(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function comparableAuditValue(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function fieldChange(field: string, before: unknown, after: unknown): AuditFieldChange | null {
  if (comparableAuditValue(before) === comparableAuditValue(after)) return null;
  return {
    field,
    before: summarizeAuditValue(before),
    after: summarizeAuditValue(after),
  };
}

function changesFromFields<T extends object>(
  before: T | null | undefined,
  after: T,
  fields: { key: keyof T; label: string }[],
) {
  return fields
    .map(({ key, label }) => fieldChange(label, before?.[key], after[key]))
    .filter((change): change is AuditFieldChange => Boolean(change));
}

function pathFor(labId: string, name: string) {
  return collection(requireDb(), "labs", labId, name);
}

function docFor(labId: string, name: string, id: string) {
  return doc(requireDb(), "labs", labId, name, id);
}

function createAudit(_input: {
  labId: string;
  kind: AuditEvent["kind"];
  actor: string;
  actorUid: string;
  deviceIdentity: ClientDeviceIdentity;
  action: string;
  targetId: string;
  targetLabel: string;
  targetType?: AuditEvent["targetType"];
  summary: string;
  fieldChanges?: AuditFieldChange[];
  versionNumber?: number;
}) {
  // Auditing is deliberately server-owned. Keeping this compatibility helper
  // preserves the existing call sites while the Firestore trigger records the
  // authenticated mutation with a server timestamp.
  return Promise.resolve();
}

function eventTime(event: AuditEvent) {
  const parsed = Date.parse(event.timestampIso ?? event.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizedDetail(detail: ExperimentDetail): ExperimentDetail {
  return {
    ...detail,
    projectId: detail.projectId ?? null,
    notebook: detail.notebook ?? "General Notebook",
    archived: detail.archived ?? false,
    isFavorite: detail.isFavorite ?? false,
    locked: detail.locked ?? false,
    reviewStatus: detail.reviewStatus ?? "none",
    versionNumber: detail.versionNumber ?? 1,
    revisionNumber: detail.revisionNumber ?? detail.versions.length,
    parentExperimentId: detail.parentExperimentId ?? null,
    authoringBlocks: detail.authoringBlocks ?? [],
    signatures: detail.signatures ?? [],
    versions: detail.versions ?? [],
    attachmentIds: detail.attachmentIds ?? [],
    comments: detail.comments ?? [],
    history: detail.history ?? [],
    protocol: (detail.protocol ?? []).map((step) => ({ required: true, ...step })),
    reviewRequestedAt: detail.reviewRequestedAt ?? null,
    reviewRequestedBy: detail.reviewRequestedBy ?? null,
    reviewRequestedByUid: detail.reviewRequestedByUid ?? null,
    reviewDecisionAt: detail.reviewDecisionAt ?? null,
    reviewDecisionBy: detail.reviewDecisionBy ?? null,
    reviewDecisionByUid: detail.reviewDecisionByUid ?? null,
    reviewAssignedToUid: detail.reviewAssignedToUid ?? null,
    reviewAssignedToName: detail.reviewAssignedToName ?? null,
    reviewDueDate: detail.reviewDueDate ?? null,
    reviewComment: detail.reviewComment ?? null,
    reviewEvents: detail.reviewEvents ?? [],
    lockedAt: detail.lockedAt ?? null,
    lockedBy: detail.lockedBy ?? null,
    dueDate: detail.dueDate ?? null,
  };
}

function readinessInsights(
  detail: Pick<
    ExperimentDetail,
    "protocol" | "status" | "objective" | "notes" | "observations" | "attachmentIds" | "reviewStatus" | "locked" | "authoringBlocks" | "versions" | "reviewDueDate"
  >,
): AIInsight[] {
  const done = detail.protocol.filter((step) => step.status === "done").length;
  const total = Math.max(detail.protocol.length, 1);
  const missingLots = detail.protocol.filter((step) => step.required !== false && !step.reagentLotId).length;
  const deviations = detail.protocol.filter((step) => step.deviation?.trim()).length;
  const missingFields = [
    !detail.objective.trim() ? "objective" : "",
    !detail.notes.trim() ? "notebook notes" : "",
    !detail.observations.trim() ? "observations" : "",
    detail.attachmentIds.length === 0 ? "raw files" : "",
    detail.authoringBlocks.filter((block) => block.required && !block.content.trim()).length > 0 ? "required structured blocks" : "",
  ].filter(Boolean);
  const overdueReview = detail.reviewDueDate ? Date.parse(detail.reviewDueDate) < Date.now() && detail.reviewStatus === "requested" : false;
  const recentChange = detail.versions.at(-1);
  return [
    {
      id: "ai-progress",
      kind: done === total ? "success" : "suggestion",
      title: done === total ? "Protocol complete" : "Protocol progress",
      body: `${done}/${total} protocol steps are complete. Add observations and attach raw files before review.`,
    },
    {
      id: "ai-quality",
      kind: missingLots > 0 ? "alert" : "success",
      title: missingLots > 0 ? "Missing reagent links" : "Materials traceable",
      body: missingLots > 0 ? `${missingLots} required protocol steps have no reagent lot linked.` : "Required protocol steps have reagent lot traceability.",
    },
    {
      id: "ai-deviations",
      kind: deviations > 0 ? "suggestion" : "success",
      title: deviations > 0 ? "Deviation review needed" : "No deviations recorded",
      body: deviations > 0 ? `${deviations} protocol deviations should be explained before signing.` : "No protocol deviations are currently recorded.",
    },
    {
      id: "ai-missing-data",
      kind: missingFields.length > 0 ? "alert" : "success",
      title: missingFields.length > 0 ? "Signing blockers detected" : "Required record fields present",
      body: missingFields.length > 0 ? `Before signing, complete: ${missingFields.join(", ")}.` : "Objective, notes, observations, files, and required blocks are present.",
    },
    {
      id: "ai-last-change",
      kind: recentChange ? "suggestion" : "success",
      title: recentChange ? "What changed most recently" : "No revisions yet",
      body: recentChange ? recentChange.snapshotSummary : "Revision history will summarize field-level edits as they happen.",
    },
    {
      id: "ai-review-due",
      kind: overdueReview ? "alert" : "suggestion",
      title: overdueReview ? "Review overdue" : "Review timing",
      body: detail.reviewDueDate ? `Review due date: ${detail.reviewDueDate}.` : "Assign a reviewer and due date when submitting for review.",
    },
    {
      id: "ai-review",
      kind: detail.reviewStatus === "signed" || detail.locked ? "success" : detail.status === "review" ? "alert" : "suggestion",
      title: detail.reviewStatus === "signed" || detail.locked ? "Signed record locked" : detail.status === "review" ? "Ready for PI review" : "Review readiness",
      body: "Deterministic check: objective, protocol run, notes, attachments, signatures, and comments are tracked for the report.",
    },
  ];
}

function versionSnapshot(
  detail: ExperimentDetail,
  actor: string,
  actorUid: string,
  deviceIdentity: ClientDeviceIdentity,
  label: string,
  fieldChanges: AuditFieldChange[] = [],
  timestamp = nowIso(),
): ExperimentVersion {
  const revisionNumber = (detail.revisionNumber ?? detail.versions.length) + 1;
  return {
    id: createId("version"),
    versionNumber: detail.versionNumber ?? Math.max(detail.versions.length + 1, 1),
    revisionNumber,
    label,
    action: label,
    createdBy: actor,
    createdByUid: actorUid,
    createdAt: timestamp,
    deviceId: deviceIdentity.deviceId,
    deviceLabel: deviceIdentity.deviceLabel,
    fieldChanges,
    snapshotSummary:
      fieldChanges.length > 0
        ? fieldChanges.map((change) => `${change.field}: ${change.before} -> ${change.after}`).join("; ")
        : `${detail.name}: ${detail.protocol.filter((step) => step.status === "done").length}/${detail.protocol.length} steps complete, ${detail.signatures.length} signatures.`,
  };
}

function experimentChangePatch(
  detail: ExperimentDetail,
  actor: string,
  actorUid: string,
  deviceIdentity: ClientDeviceIdentity,
  action: string,
  fieldChanges: AuditFieldChange[],
  timestamp = nowIso(),
) {
  const revision = versionSnapshot(detail, actor, actorUid, deviceIdentity, action, fieldChanges, timestamp);
  return {
    // Client edits are intentionally not allowed to fabricate version or
    // history evidence. The trusted backend appends canonical entries for
    // signing, review, and attachment-finalization transitions; the server
    // audit trigger records ordinary draft mutations.
    history: detail.history,
    versions: detail.versions,
    revisionNumber: detail.revisionNumber,
    revision,
  };
}

function detailToExperiment(detail: ExperimentDetail): Experiment {
  return {
    id: detail.id,
    name: detail.name,
    project: detail.project,
    projectId: detail.projectId,
    notebook: detail.notebook,
    status: detail.status,
    modified: detail.modified,
    modifiedAt: detail.modifiedAt,
    owner: detail.owner,
    ownerUid: detail.ownerUid,
    ownerInitials: detail.ownerInitials,
    piUid: detail.piUid,
    tags: detail.tags,
    archived: detail.archived,
    isFavorite: detail.isFavorite,
    locked: detail.locked,
    reviewStatus: detail.reviewStatus,
    versionNumber: detail.versionNumber,
    revisionNumber: detail.revisionNumber,
    parentExperimentId: detail.parentExperimentId,
  };
}

function defaultProtocol(experimentId: string): ProtocolStep[] {
  return [
    { id: `${experimentId}-step-1`, label: "Define objective and success criteria", status: "pending", required: true, timerMinutes: 0 },
    { id: `${experimentId}-step-2`, label: "Record materials, reagent lots, and instrument settings", status: "pending", required: true, timerMinutes: 0 },
    { id: `${experimentId}-step-3`, label: "Capture observations, deviations, and attachments", status: "pending", required: true, timerMinutes: 0 },
  ];
}

function protocolFromTemplate(template: ProtocolTemplate): ProtocolStep[] {
  const steps = template.steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) {
    throw new Error(`Protocol template "${template.name}" has no usable steps. Update the template before using it in an experiment.`);
  }

  return steps.map((label, index) => ({
    id: `${template.id}-run-${index + 1}-${Date.now()}`,
    label,
    status: "pending",
    required: true,
    timerMinutes: 0,
  }));
}

function lotStatus(lot: InventoryLot): InventoryLot["status"] {
  if (lot.quantity <= 0) return "depleted";
  if (lot.expirationDate && new Date(lot.expirationDate) < new Date()) return "expired";
  if (lot.quantity <= 1) return "low";
  return "available";
}

export function LabDataProvider({ children }: { children: ReactNode }) {
  const { activeLab, activeMember, user } = useAuth();
  const deviceIdentity = useMemo(() => getClientDeviceIdentity(), []);
  const [state, setState] = useState<LabDataState>({
    members: [],
    experiments: [],
    experimentDetails: {},
    protocolTemplates: [],
    inventoryItems: [],
    sampleRecords: [],
    projectRecords: [],
    notifications: [],
    collaborationTasks: [],
    integrationImports: [],
    auditEvents: [],
    attachments: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!activeLab) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return undefined;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const handleSnapshotError = (error: Error) => {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message.includes("Missing or insufficient permissions") || error.message.includes("permission-denied")
          ? "Firebase permissions denied this lab data request. Deploy the Firestore rules from this repo to your Firebase project."
          : error.message,
      }));
    };
    const publicProjectsById = new Map<string, ProjectRecord>();
    const accessibleProjectsById = new Map<string, ProjectRecord>();
    const syncProjectRecords = () => {
      const records = [...new Map([...publicProjectsById, ...accessibleProjectsById]).values()]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      setState((prev) => ({ ...prev, projectRecords: records }));
    };

    const unsubscribers = [
      onSnapshot(query(pathFor(activeLab.id, "members"), orderBy("displayName", "asc")), (snapshot) => {
        setState((prev) => ({ ...prev, members: snapshot.docs.map((item) => item.data() as LabMember) }));
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "experiments"), orderBy("modifiedAt", "desc")), (snapshot) => {
        const details = snapshot.docs.map((item) => normalizedDetail(item.data() as ExperimentDetail));
        setState((prev) => ({
          ...prev,
          experiments: details.map(detailToExperiment),
          experimentDetails: Object.fromEntries(details.map((detail) => [detail.id, { ...detail, aiInsights: readinessInsights(detail) }])),
          isLoading: false,
        }));
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "protocolTemplates"), orderBy("updatedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, protocolTemplates: snapshot.docs.map((item) => item.data() as ProtocolTemplate) }));
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "inventoryItems"), orderBy("updatedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, inventoryItems: snapshot.docs.map((item) => item.data() as InventoryItem) }));
      }, handleSnapshotError),
      onSnapshot(pathFor(activeLab.id, "sampleRecords"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as SampleRecord)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setState((prev) => ({ ...prev, sampleRecords: records }));
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "projectRecords"), where("visibility", "==", "lab")), (snapshot) => {
        publicProjectsById.clear();
        snapshot.docs.forEach((item) => publicProjectsById.set(item.id, item.data() as ProjectRecord));
        syncProjectRecords();
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "projectRecords"), where("allowedMemberUids", "array-contains", activeMember?.uid ?? "")), (snapshot) => {
        accessibleProjectsById.clear();
        snapshot.docs.forEach((item) => accessibleProjectsById.set(item.id, item.data() as ProjectRecord));
        syncProjectRecords();
      }, handleSnapshotError),
      onSnapshot(pathFor(activeLab.id, "notifications"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as NotificationRecord)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setState((prev) => ({ ...prev, notifications: records }));
      }, handleSnapshotError),
      onSnapshot(pathFor(activeLab.id, "collaborationTasks"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as CollaborationTask)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setState((prev) => ({ ...prev, collaborationTasks: records }));
      }, handleSnapshotError),
      onSnapshot(pathFor(activeLab.id, "integrationImports"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as IntegrationImport)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setState((prev) => ({ ...prev, integrationImports: records }));
      }, handleSnapshotError),
      onSnapshot(pathFor(activeLab.id, "auditEvents"), (snapshot) => {
        const events = snapshot.docs.map((item) => item.data() as AuditEvent).sort((a, b) => eventTime(b) - eventTime(a));
        setState((prev) => ({ ...prev, auditEvents: events }));
      }, handleSnapshotError),
      onSnapshot(query(pathFor(activeLab.id, "attachments"), orderBy("uploadedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, attachments: snapshot.docs.map((item) => item.data() as AttachmentRecord) }));
      }, handleSnapshotError),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeLab, activeMember?.uid]);

  const actor = user?.name ?? "Unknown user";
  const actorUid = user?.uid ?? "";
  const initials = user?.initials ?? "??";
  const activePiUid = activeMember?.role === "owner" || activeMember?.role === "pi" ? activeMember.uid : activeMember?.piUid ?? null;

  const value = useMemo<LabDataContextValue>(() => {
    const labId = activeLab?.id;
    const createNotification = async (input: Omit<NotificationRecord, "id" | "createdAt" | "createdByUid" | "readBy">) => {
      if (!labId) return;
      const id = createId("notification");
      const record: NotificationRecord = {
        id,
        ...input,
        createdByUid: actorUid,
        readBy: [],
        createdAt: nowIso(),
      };
      await setDoc(docFor(labId, "notifications", id), record);
    };

    return {
      ...state,
      createExperiment: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = createId("EXP");
        const timestamp = nowIso();
        let protocol: ProtocolStep[] = defaultProtocol(id);
        let protocolTemplateVersion: number | null = null;
        if (input.protocolTemplateId) {
          const template = state.protocolTemplates.find((item) => item.id === input.protocolTemplateId);
          if (template) {
            protocol = protocolFromTemplate(template);
            protocolTemplateVersion = template.version;
          }
        }
        const detail: ExperimentDetail & { modifiedAt: string } = {
          id,
          name: input.name.trim(),
          project: input.project.trim(),
          projectId: input.projectId ?? null,
          notebook: input.notebook?.trim() || "General Notebook",
          status: "draft",
          modified: "Just now",
          modifiedAt: timestamp,
          owner: actor,
          ownerUid: actorUid,
          ownerInitials: initials,
          piUid: activePiUid,
          tags: normalizeTags(input.tags),
          archived: false,
          isFavorite: false,
          locked: false,
          reviewStatus: "none",
          versionNumber: 1,
          revisionNumber: 0,
          parentExperimentId: null,
          objective: input.objective.trim(),
          notes: "",
          observations: "",
          protocolTemplateId: input.protocolTemplateId ?? null,
          protocolTemplateVersion,
          protocol,
          aiInsights: [],
          comments: [],
          history: [],
          attachmentIds: [],
          authoringBlocks: [],
          signatures: [],
          versions: [],
          reviewRequestedAt: null,
          reviewRequestedBy: null,
          reviewRequestedByUid: null,
          reviewDecisionAt: null,
          reviewDecisionBy: null,
          reviewDecisionByUid: null,
          reviewAssignedToUid: null,
          reviewAssignedToName: null,
          reviewDueDate: null,
          reviewComment: null,
          reviewEvents: [],
          lockedAt: null,
          lockedBy: null,
          dueDate: input.dueDate || null,
        };
        const fieldChanges = [
          fieldChange("Record", null, "Created"),
          fieldChange("Name", null, detail.name),
          fieldChange("Project", null, detail.project),
          fieldChange("Objective", null, detail.objective),
          fieldChange("Tags", [], detail.tags),
          fieldChange("Protocol template", null, detail.protocolTemplateId ?? "Default protocol"),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        await setDoc(docFor(labId, "experiments", id), detail);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Created experiment",
          targetId: id,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: `Created ${detail.name} in ${detail.project}.`,
          fieldChanges,
          versionNumber: detail.revisionNumber,
        });
        return detailToExperiment(detail);
      },
      saveExperiment: async (id, input) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[id];
        if (!detail) throw new Error("Experiment not found");
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before editing.");
        const timestamp = nowIso();
        const nextTags = normalizeTags(input.tags);
        const nextName = input.name.trim();
        const nextObjective = input.objective.trim();
        const nextProjectId = input.projectId ?? detail.projectId ?? null;
        const nextNotebook = input.notebook?.trim() || detail.notebook || "General Notebook";
        const nextDueDate = input.dueDate ?? detail.dueDate ?? null;
        const fieldChanges = [
          fieldChange("Name", detail.name, nextName),
          fieldChange("Objective", detail.objective, nextObjective),
          fieldChange("Notes", detail.notes, input.notes),
          fieldChange("Observations", detail.observations, input.observations),
          fieldChange("Status", detail.status, input.status),
          fieldChange("Project", detail.projectId, nextProjectId),
          fieldChange("Notebook", detail.notebook, nextNotebook),
          fieldChange("Due date", detail.dueDate, nextDueDate),
          fieldChange("Tags", detail.tags, nextTags),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Saved experiment", fieldChanges, timestamp);
        const updated = {
          ...detail,
          name: nextName,
          objective: nextObjective,
          notes: input.notes,
          observations: input.observations,
          status: input.status,
          projectId: nextProjectId,
          notebook: nextNotebook,
          dueDate: nextDueDate,
          tags: nextTags,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        };
        await setDoc(docFor(labId, "experiments", id), updated);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Saved experiment",
          targetId: id,
          targetLabel: updated.name,
          targetType: "experiment",
          summary: fieldChanges.length > 0 ? `Updated ${fieldChanges.map((change) => change.field).join(", ")}.` : "Saved experiment with no tracked field changes.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      recordNoteEdit: async (experimentId, event) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) throw new Error("Experiment not found");
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before editing.");
        await setDoc(doc(docFor(labId, "experiments", experimentId), "noteEdits", event.id), event);
      },
      subscribeNoteEdits: (experimentId, onEvents, onError) => {
        if (!labId) return () => undefined;
        return onSnapshot(
          query(collection(docFor(labId, "experiments", experimentId), "noteEdits"), orderBy("occurredAt", "asc")),
          (snapshot) => onEvents(snapshot.docs.map((item) => item.data() as NoteEditEvent)),
          (error) => onError?.(error),
        );
      },
      attachProtocolTemplate: async (experimentId, templateId) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        const template = state.protocolTemplates.find((item) => item.id === templateId);
        if (!detail || !template) return;
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before changing protocols.");
        const timestamp = nowIso();
        const protocol = protocolFromTemplate(template);
        const fieldChanges = [
          fieldChange("Protocol template", detail.protocolTemplateId, template.id),
          fieldChange("Protocol template version", detail.protocolTemplateVersion, template.version),
          fieldChange("Protocol steps", detail.protocol.length, protocol.length),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Attached protocol template", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          protocolTemplateId: template.id,
          protocolTemplateVersion: template.version,
          protocol,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: "Attached protocol template",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "protocol",
          summary: `Attached ${template.name} v${template.version} as an immutable run snapshot.`,
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      updateProtocolStepStatus: async (experimentId, stepId, status) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before changing protocol steps.");
        const timestamp = nowIso();
        const protocol = detail.protocol.map((step) => {
          if (step.id !== stepId) return step;
          if (status === "done") return { ...step, status, completedBy: initials, completedAt: shortTime() };

          const rest = { ...step };
          delete rest.completedBy;
          delete rest.completedAt;
          return { ...rest, status };
        });
        const previousStep = detail.protocol.find((step) => step.id === stepId);
        const nextStep = protocol.find((step) => step.id === stepId);
        const fieldChanges = [
          fieldChange("Protocol step", previousStep?.label, nextStep?.label),
          fieldChange("Step status", previousStep?.status, nextStep?.status),
          fieldChange("Step completed by", previousStep?.completedBy, nextStep?.completedBy),
          fieldChange("Step completed at", previousStep?.completedAt, nextStep?.completedAt),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Updated protocol step", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          protocol,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: "Updated protocol step",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "protocol",
          summary: `Moved a protocol step to ${status.replace("_", " ")}.`,
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      linkProtocolStepLot: async (experimentId, stepId, lotId) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before changing reagent links.");
        const timestamp = nowIso();
        const linkedLot = lotId
          ? state.inventoryItems
              .flatMap((item) => item.lots.map((lot) => ({ item, lot })))
              .find(({ lot }) => lot.id === lotId)
          : null;
        const protocol = detail.protocol.map((step) => {
          if (step.id !== stepId) return step;
          if (!lotId) {
            const rest = { ...step };
            delete rest.reagentLotId;
            return rest;
          }
          return { ...step, reagentLotId: lotId };
        });
        const previousStep = detail.protocol.find((step) => step.id === stepId);
        const nextStep = protocol.find((step) => step.id === stepId);
        const label = linkedLot ? `${linkedLot.item.name} / ${linkedLot.lot.lotNumber}` : "reagent lot";
        const fieldChanges = [
          fieldChange("Protocol step", previousStep?.label, nextStep?.label),
          fieldChange("Reagent lot", previousStep?.reagentLotId, lotId ? label : null),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, lotId ? "Linked reagent lot" : "Cleared reagent lot", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          protocol,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: lotId ? "Linked reagent lot" : "Cleared reagent lot",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "protocol",
          summary: lotId ? `Linked ${label} to a protocol step.` : "Cleared a reagent lot from a protocol step.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      addComment: async (experimentId, body) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail || !body.trim()) return;
        const timestamp = nowIso();
        const comment: Comment = {
          id: createId("comment"),
          author: actor,
          initials,
          body: body.trim(),
          postedAt: "Just now",
        };
        const fieldChanges = [
          fieldChange("Comment count", detail.comments.length, detail.comments.length + 1),
          fieldChange("Comment", null, comment.body),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Added comment", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          comments: [...detail.comments, comment],
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
          modified: "Just now",
          modifiedAt: timestamp,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "comment",
          actor,
          action: "Added comment",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "comment",
          summary: "Added a comment to the experiment.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
        if (body.includes("@")) {
          await createNotification({
            kind: "comment",
            title: "Mention in comment",
            body: `${actor} mentioned someone on ${detail.name}: ${body.trim().slice(0, 140)}`,
            targetType: "experiment",
            targetId: experimentId,
            priority: "normal",
          });
        }
      },
      uploadAttachment: async (experimentId, file, protocolStepId = null) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) throw new Error("Experiment not found");
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before uploading files.");
        if (!["none", "rejected", "amendment"].includes(detail.reviewStatus ?? "none")) {
          throw new Error("Attachments cannot change while independent review is in progress. Request changes or create an amendment first.");
        }
        const contentType = attachmentContentType(file);
        if (!contentType) {
          throw new Error("Use a PDF, ZIP, Excel, text/CSV, PNG, JPEG, or TIFF attachment. Instrument-file support requires the secure ingestion workflow.");
        }
        if (file.size <= 0 || file.size >= 25 * 1024 * 1024) {
          throw new Error("Attachments must be between 1 byte and 25 MB.");
        }
        const id = createId("attachment");
        const storagePath = `labs/${labId}/experiments/${experimentId}/${id}`;
        const fileRef = ref(requireStorage(), storagePath);
        await uploadBytes(fileRef, file, {
          contentType,
          customMetadata: {
            labId,
            experimentId,
            attachmentId: id,
            uploaderUid: actorUid,
          },
        });
        const finalize = httpsCallable<
          { labId: string; experimentId: string; attachmentId: string; fileName: string; protocolStepId: string | null },
          { attachment: AttachmentRecord }
        >(requireFunctions(), "finalizeAttachment");
        const result = await finalize({
          labId,
          experimentId,
          attachmentId: id,
          fileName: file.name,
          protocolStepId,
        });
        return result.data.attachment;
      },
      submitExperimentForReview: async (experimentId, reviewerUid, comment = "", reviewDueDate = null) => {
        if (!labId) throw new Error("No active lab");
        const requestReview = httpsCallable<
          { labId: string; experimentId: string; reviewerUid: string; comment: string; reviewDueDate: string | null },
          { experimentId: string; reviewStatus: "requested" }
        >(requireFunctions(), "requestExperimentReview");
        await requestReview({
          labId,
          experimentId,
          reviewerUid,
          comment: comment.trim(),
          reviewDueDate,
        });
      },
      approveExperimentReview: async (experimentId, comment = "") => {
        if (!labId) throw new Error("No active lab");
        const decideReview = httpsCallable<
          { labId: string; experimentId: string; decision: "approved" | "rejected"; comment: string },
          { experimentId: string; reviewStatus: "approved" | "rejected" }
        >(requireFunctions(), "decideExperimentReview", { limitedUseAppCheckTokens: true });
        await decideReview({ labId, experimentId, decision: "approved", comment: comment.trim() });
      },
      rejectExperimentReview: async (experimentId, comment) => {
        if (!labId) throw new Error("No active lab");
        const decideReview = httpsCallable<
          { labId: string; experimentId: string; decision: "approved" | "rejected"; comment: string },
          { experimentId: string; reviewStatus: "approved" | "rejected" }
        >(requireFunctions(), "decideExperimentReview", { limitedUseAppCheckTokens: true });
        await decideReview({ labId, experimentId, decision: "rejected", comment: comment.trim() });
      },
      signExperiment: async (experimentId, meaning, comment) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Experiment is already signed and locked.");
        const sign = httpsCallable<
          { labId: string; experimentId: string; meaning: "author" | "reviewer" | "approver"; comment: string },
          { revisionNumber: number }
        >(requireFunctions(), "signExperiment", { limitedUseAppCheckTokens: true });
        await sign({ labId, experimentId, meaning, comment: comment.trim() });
      },
      verifyExperimentIntegrity: async (experimentId) => {
        if (!labId) throw new Error("No active lab");
        const verify = httpsCallable<
          { labId: string; experimentId: string },
          ExperimentIntegrityReport
        >(requireFunctions(), "verifyExperimentIntegrity");
        const result = await verify({ labId, experimentId });
        return result.data;
      },
      createExperimentAmendment: async (experimentId, reason) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) throw new Error("Experiment not found");
        const id = createId("EXP");
        const timestamp = nowIso();
        const nextVersion = (detail.versionNumber ?? 1) + 1;
        // Signed records can contain server-only provenance fields. An amendment
        // starts a distinct client-creatable record, so never carry those
        // privileged fields across from the immutable source document.
        const {
          lockedByUid: _lockedByUid,
          lockedAtServer: _lockedAtServer,
          modifiedAtServer: _modifiedAtServer,
          ...amendmentSource
        } = detail as ExperimentDetail & {
          lockedByUid?: unknown;
          lockedAtServer?: unknown;
          modifiedAtServer?: unknown;
        };
        const amendment: ExperimentDetail = {
          ...amendmentSource,
          id,
          name: `${detail.name} Amendment v${nextVersion}`,
          status: "draft",
          modified: "Just now",
          modifiedAt: timestamp,
          owner: actor,
          ownerUid: actorUid,
          ownerInitials: initials,
          locked: false,
          lockedAt: null,
          lockedBy: null,
          reviewStatus: "amendment",
          reviewRequestedAt: null,
          reviewRequestedBy: null,
          reviewRequestedByUid: null,
          reviewDecisionAt: null,
          reviewDecisionBy: null,
          reviewDecisionByUid: null,
          reviewAssignedToUid: null,
          reviewAssignedToName: null,
          reviewDueDate: null,
          reviewComment: reason.trim(),
          reviewEvents: [],
          signatures: [],
          versions: [],
          versionNumber: nextVersion,
          revisionNumber: 0,
          parentExperimentId: detail.id,
          comments: [],
          history: [],
          attachmentIds: [],
        };
        const fieldChanges = [
          fieldChange("Source experiment", null, detail.id),
          fieldChange("Version", detail.versionNumber, nextVersion),
          fieldChange("Review status", detail.reviewStatus, "amendment"),
          fieldChange("Amendment reason", null, reason.trim()),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        await setDoc(docFor(labId, "experiments", id), amendment);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Created amendment",
          targetId: id,
          targetLabel: amendment.name,
          targetType: "experiment",
          summary: reason.trim() || `Created amendment from ${detail.id}.`,
          fieldChanges,
          versionNumber: amendment.revisionNumber,
        });
        return detailToExperiment(amendment);
      },
      updateProtocolStepDetails: async (experimentId, stepId, input) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before changing protocol details.");
        const timestamp = nowIso();
        const protocol = detail.protocol.map((step) => (step.id === stepId ? { ...step, ...input } : step));
        const previousStep = detail.protocol.find((step) => step.id === stepId);
        const nextStep = protocol.find((step) => step.id === stepId);
        const fieldChanges = [
          fieldChange("Protocol step", previousStep?.label, nextStep?.label),
          fieldChange("Step note", previousStep?.note, nextStep?.note),
          fieldChange("Step deviation", previousStep?.deviation, nextStep?.deviation),
          fieldChange("Step required", previousStep?.required, nextStep?.required),
          fieldChange("Step timer", previousStep?.timerMinutes, nextStep?.timerMinutes),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Updated protocol step details", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          protocol,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: "Updated protocol details",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "protocol",
          summary: "Updated step note, deviation, timer, or required flag.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      saveAuthoringBlocks: async (experimentId, blocks) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before editing blocks.");
        const timestamp = nowIso();
        const fieldChanges = [
          fieldChange("Structured block count", detail.authoringBlocks.length, blocks.length),
          fieldChange("Structured block titles", detail.authoringBlocks.map((block) => block.title), blocks.map((block) => block.title)),
          fieldChange("Structured block kinds", detail.authoringBlocks.map((block) => block.kind), blocks.map((block) => block.kind)),
          fieldChange("Required structured blocks", detail.authoringBlocks.filter((block) => block.required).map((block) => block.title), blocks.filter((block) => block.required).map((block) => block.title)),
          fieldChange("Structured block content", detail.authoringBlocks.map((block) => block.content), blocks.map((block) => block.content)),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Updated structured authoring blocks", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          authoringBlocks: blocks,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Updated authoring blocks",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: `Saved ${blocks.length} structured authoring blocks.`,
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      saveProtocolTemplate: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = input.id || createId("protocol");
        const existing = state.protocolTemplates.find((item) => item.id === id);
        const timestamp = nowIso();
        const steps = input.steps.map((step) => step.trim()).filter(Boolean);
        if (steps.length === 0) {
          throw new Error("A protocol template needs at least one non-empty step.");
        }
        const template: ProtocolTemplate = {
          id,
          name: input.name.trim(),
          description: input.description.trim(),
          version: input.version ?? (existing ? existing.version + 1 : 1),
          status: input.status,
          steps,
          documentHtml: input.documentHtml ?? existing?.documentHtml,
          locked: input.locked ?? existing?.locked ?? false,
          createdBy: existing?.createdBy || actor,
          createdByUid: existing?.createdByUid || actorUid,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        const fieldChanges = changesFromFields(existing, template, [
          { key: "name", label: "Name" },
          { key: "description", label: "Description" },
          { key: "version", label: "Version" },
          { key: "status", label: "Status" },
          { key: "steps", label: "Steps" },
        ]);
        await setDoc(docFor(labId, "protocolTemplates", id), template);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: existing ? "Updated protocol template" : "Created protocol template",
          targetId: id,
          targetLabel: template.name,
          targetType: "protocol",
          summary: `Saved ${template.name} v${template.version}.`,
          fieldChanges,
        });
      },
      deleteProtocolTemplate: async (id) => {
        if (!labId) throw new Error("No active lab");
        const template = state.protocolTemplates.find((item) => item.id === id);
        const fieldChanges = [fieldChange("Record", template?.name ?? id, "Deleted")].filter((change): change is AuditFieldChange => Boolean(change));
        await deleteDoc(docFor(labId, "protocolTemplates", id));
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "protocol",
          actor,
          action: "Deleted protocol template",
          targetId: id,
          targetLabel: template?.name ?? id,
          targetType: "protocol",
          summary: `Deleted protocol template ${template?.name ?? id}.`,
          fieldChanges,
        });
      },
      saveInventoryItem: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = input.id || createId("inventory");
        const existing = state.inventoryItems.find((item) => item.id === id);
        const timestamp = nowIso();
        const item: InventoryItem = {
          id,
          name: input.name.trim(),
          category: input.category.trim(),
          vendor: input.vendor.trim(),
          catalogNumber: input.catalogNumber.trim(),
          unit: input.unit.trim(),
          lots: input.lots.map((lot) => ({ ...lot, status: lotStatus(lot) })),
          createdByUid: existing?.createdByUid || actorUid,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        const fieldChanges = [
          ...changesFromFields(existing, item, [
            { key: "name", label: "Name" },
            { key: "category", label: "Category" },
            { key: "vendor", label: "Vendor" },
            { key: "catalogNumber", label: "Catalog number" },
            { key: "unit", label: "Unit" },
          ]),
          fieldChange("Lot count", existing?.lots.length, item.lots.length),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        await setDoc(docFor(labId, "inventoryItems", id), item);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: existing ? "Updated inventory" : "Created inventory",
          targetId: id,
          targetLabel: item.name,
          targetType: "inventory",
          summary: `Saved inventory item ${item.name}.`,
          fieldChanges,
        });
      },
      adjustInventoryLot: async (itemId, lotId, quantity) => {
        if (!labId) throw new Error("No active lab");
        const item = state.inventoryItems.find((entry) => entry.id === itemId);
        if (!item) return;
        const lots = item.lots.map((lot) => (lot.id === lotId ? { ...lot, quantity, status: lotStatus({ ...lot, quantity }) } : lot));
        const beforeLot = item.lots.find((lot) => lot.id === lotId);
        const afterLot = lots.find((lot) => lot.id === lotId);
        const timestamp = nowIso();
        const fieldChanges = [
          fieldChange("Lot quantity", beforeLot?.quantity, afterLot?.quantity),
          fieldChange("Lot status", beforeLot?.status, afterLot?.status),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        await updateDoc(docFor(labId, "inventoryItems", itemId), { lots, updatedAt: timestamp });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: "Adjusted inventory lot",
          targetId: itemId,
          targetLabel: item.name,
          targetType: "inventory",
          summary: `Adjusted lot ${lotId} quantity to ${quantity}.`,
          fieldChanges,
        });
      },
      saveSampleRecord: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = input.id || createId("sample");
        const existing = state.sampleRecords.find((sample) => sample.id === id);
        const timestamp = nowIso();
        const record: SampleRecord = {
          id,
          name: input.name.trim(),
          kind: input.kind,
          registryId: input.registryId.trim() || id,
          owner: existing?.owner || actor,
          ownerUid: existing?.ownerUid || actorUid,
          projectId: input.projectId ?? null,
          location: input.location.trim(),
          status: input.status,
          parentSampleId: input.parentSampleId || null,
          source: input.source.trim(),
          metadata: input.metadata,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        const fieldChanges = changesFromFields(existing, record, [
          { key: "name", label: "Name" },
          { key: "kind", label: "Kind" },
          { key: "registryId", label: "Registry ID" },
          { key: "projectId", label: "Project" },
          { key: "location", label: "Location" },
          { key: "status", label: "Status" },
          { key: "parentSampleId", label: "Parent sample" },
          { key: "source", label: "Source" },
          { key: "metadata", label: "Metadata" },
        ]);
        await setDoc(docFor(labId, "sampleRecords", id), record);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: existing ? "Updated sample registry" : "Created sample registry",
          targetId: id,
          targetLabel: record.name,
          targetType: "sample",
          summary: `Saved ${record.kind.replace("_", " ")} ${record.registryId}.`,
          fieldChanges,
        });
      },
      saveProjectRecord: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = input.id || createId("project");
        const existing = state.projectRecords.find((project) => project.id === id);
        const timestamp = nowIso();
        const record: ProjectRecord = {
          id,
          name: input.name.trim(),
          description: input.description.trim(),
          status: input.status,
          visibility: input.visibility ?? existing?.visibility ?? "lab",
          allowedMemberUids: Array.from(new Set([actorUid, ...(input.allowedMemberUids ?? existing?.allowedMemberUids ?? [])])),
          ownerUid: existing?.ownerUid || actorUid,
          ownerName: existing?.ownerName || actor,
          notebooks: input.notebooks.map((item) => item.trim()).filter(Boolean),
          folders: input.folders.map((item) => item.trim()).filter(Boolean),
          tags: normalizeTags(input.tags),
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        const fieldChanges = changesFromFields(existing, record, [
          { key: "name", label: "Name" },
          { key: "description", label: "Description" },
          { key: "status", label: "Status" },
          { key: "visibility", label: "Visibility" },
          { key: "allowedMemberUids", label: "Project members" },
          { key: "notebooks", label: "Notebooks" },
          { key: "folders", label: "Folders" },
          { key: "tags", label: "Tags" },
        ]);
        await setDoc(docFor(labId, "projectRecords", id), record);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: existing ? "Updated project" : "Created project",
          targetId: id,
          targetLabel: record.name,
          targetType: "project",
          summary: `Saved project hierarchy for ${record.name}.`,
          fieldChanges,
        });
      },
      createTask: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = input.id || createId("task");
        const existing = state.collaborationTasks.find((task) => task.id === id);
        const timestamp = nowIso();
        const record: CollaborationTask = {
          id,
          title: input.title.trim(),
          description: input.description.trim(),
          status: existing?.status || "open",
          assigneeUid: input.assigneeUid ?? null,
          assigneeName: input.assigneeName ?? null,
          experimentId: input.experimentId ?? null,
          dueDate: input.dueDate ?? null,
          createdBy: existing?.createdBy || actor,
          createdByUid: existing?.createdByUid || actorUid,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        const fieldChanges = changesFromFields(existing, record, [
          { key: "title", label: "Title" },
          { key: "description", label: "Description" },
          { key: "status", label: "Status" },
          { key: "assigneeName", label: "Assignee" },
          { key: "experimentId", label: "Experiment" },
          { key: "dueDate", label: "Due date" },
        ]);
        await setDoc(docFor(labId, "collaborationTasks", id), record);
        await createNotification({
          kind: "task",
          title: "Task assigned",
          body: record.assigneeName ? `${record.title} assigned to ${record.assigneeName}.` : record.title,
          targetType: "task",
          targetId: id,
          priority: record.dueDate ? "high" : "normal",
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: existing ? "Updated task" : "Created task",
          targetId: id,
          targetLabel: record.title,
          targetType: "task",
          summary: record.description || "Collaboration task updated.",
          fieldChanges,
        });
      },
      updateTaskStatus: async (taskId, status) => {
        if (!labId) throw new Error("No active lab");
        const task = state.collaborationTasks.find((item) => item.id === taskId);
        if (!task) return;
        const timestamp = nowIso();
        const fieldChanges = [fieldChange("Task status", task.status, status)].filter((change): change is AuditFieldChange => Boolean(change));
        await updateDoc(docFor(labId, "collaborationTasks", taskId), { status, updatedAt: timestamp });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: "Updated task status",
          targetId: taskId,
          targetLabel: task.title,
          targetType: "task",
          summary: `Moved task to ${status.replace("_", " ")}.`,
          fieldChanges,
        });
      },
      markNotificationRead: async (notificationId) => {
        if (!labId || !actorUid) return;
        const notification = state.notifications.find((item) => item.id === notificationId);
        if (!notification || notification.readBy.includes(actorUid)) return;
        const fieldChanges = [fieldChange("Read by", notification.readBy, [...notification.readBy, actorUid])].filter((change): change is AuditFieldChange => Boolean(change));
        await updateDoc(docFor(labId, "notifications", notificationId), {
          readBy: arrayUnion(actorUid),
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: "Read notification",
          targetId: notificationId,
          targetLabel: notification.title,
          targetType: "notification",
          summary: `Marked notification as read: ${notification.title}.`,
          fieldChanges,
        });
      },
      recordIntegrationImport: async (input) => {
        if (!labId) throw new Error("No active lab");
        const id = createId("import");
        const record: IntegrationImport = {
          id,
          source: input.source,
          fileName: input.fileName,
          rowCount: input.rowCount,
          summary: input.summary,
          importType: input.importType ?? "unknown",
          columns: input.columns ?? [],
          previewRows: input.previewRows ?? [],
          mapping: input.mapping ?? {},
          validationIssues: input.validationIssues ?? [],
          createdBy: actor,
          createdByUid: actorUid,
          createdAt: nowIso(),
        };
        const fieldChanges = [
          fieldChange("Source", null, record.source),
          fieldChange("File", null, record.fileName),
          fieldChange("Rows", null, record.rowCount),
          fieldChange("Import type", null, record.importType),
          fieldChange("Columns", null, record.columns),
          fieldChange("Validation issues", null, record.validationIssues),
          fieldChange("Summary", null, record.summary),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        await setDoc(docFor(labId, "integrationImports", id), record);
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "system",
          actor,
          action: "Recorded integration import",
          targetId: id,
          targetLabel: input.fileName,
          targetType: "integration",
          summary: input.summary,
          fieldChanges,
        });
      },
    };
  }, [activeLab?.id, activePiUid, actor, actorUid, deviceIdentity, initials, state]);

  return <LabDataContext.Provider value={value}>{children}</LabDataContext.Provider>;
}

export function useLabData() {
  const ctx = useContext(LabDataContext);
  if (!ctx) throw new Error("useLabData must be used within a LabDataProvider");
  return ctx;
}
