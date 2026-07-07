import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import { getClientDeviceIdentity, type ClientDeviceIdentity } from "../lib/deviceIdentity";
import { useAuth } from "./AuthContext";
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
  ExperimentVersion,
  HistoryEntry,
  IntegrationImport,
  InventoryItem,
  InventoryLot,
  NotificationRecord,
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
  attachProtocolTemplate: (experimentId: string, templateId: string) => Promise<void>;
  updateProtocolStepStatus: (experimentId: string, stepId: string, status: ProtocolStep["status"]) => Promise<void>;
  linkProtocolStepLot: (experimentId: string, stepId: string, lotId: string | null) => Promise<void>;
  addComment: (experimentId: string, body: string) => Promise<void>;
  uploadAttachment: (experimentId: string, file: File, protocolStepId?: string | null) => Promise<void>;
  submitExperimentForReview: (experimentId: string, comment?: string) => Promise<void>;
  approveExperimentReview: (experimentId: string, comment?: string) => Promise<void>;
  rejectExperimentReview: (experimentId: string, comment: string) => Promise<void>;
  signExperiment: (experimentId: string, meaning: "author" | "reviewer" | "approver", comment: string) => Promise<void>;
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
  recordIntegrationImport: (input: Pick<IntegrationImport, "source" | "fileName" | "rowCount" | "summary">) => Promise<void>;
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

function nowIso() {
  return new Date().toISOString();
}

function displayDate(value: string) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortTime(value = new Date()) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(value);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function createAudit(input: {
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
  const id = createId("audit");
  const timestampIso = nowIso();
  const event: AuditEvent & { timestampServer: ReturnType<typeof serverTimestamp> } = {
    id,
    kind: input.kind,
    actor: input.actor,
    actorUid: input.actorUid,
    action: input.action,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    targetType: input.targetType ?? input.kind,
    summary: input.summary,
    timestamp: displayDate(timestampIso),
    timestampIso,
    timestampServer: serverTimestamp(),
    deviceId: input.deviceIdentity.deviceId,
    deviceLabel: input.deviceIdentity.deviceLabel,
    sessionId: input.deviceIdentity.sessionId,
    versionNumber: input.versionNumber ?? null,
    fieldChanges: input.fieldChanges ?? [],
  };
  return setDoc(docFor(input.labId, "auditEvents", id), event);
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
    reviewDecisionAt: detail.reviewDecisionAt ?? null,
    reviewDecisionBy: detail.reviewDecisionBy ?? null,
    reviewComment: detail.reviewComment ?? null,
    lockedAt: detail.lockedAt ?? null,
    lockedBy: detail.lockedBy ?? null,
    dueDate: detail.dueDate ?? null,
  };
}

function createHistoryEntry(actor: string, actorUid: string, deviceIdentity: ClientDeviceIdentity, action: string, timestamp = nowIso()): HistoryEntry {
  return {
    id: createId("history"),
    actor,
    actorUid,
    action,
    timestamp: displayDate(timestamp),
    timestampIso: timestamp,
    deviceId: deviceIdentity.deviceId,
    deviceLabel: deviceIdentity.deviceLabel,
  };
}

function mockInsights(detail: Pick<ExperimentDetail, "protocol" | "status" | "objective" | "attachmentIds" | "reviewStatus" | "locked">): AIInsight[] {
  const done = detail.protocol.filter((step) => step.status === "done").length;
  const total = Math.max(detail.protocol.length, 1);
  const missingLots = detail.protocol.filter((step) => step.required !== false && !step.reagentLotId).length;
  const deviations = detail.protocol.filter((step) => step.deviation?.trim()).length;
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
      id: "ai-review",
      kind: detail.reviewStatus === "signed" || detail.locked ? "success" : detail.status === "review" ? "alert" : "suggestion",
      title: detail.reviewStatus === "signed" || detail.locked ? "Signed record locked" : detail.status === "review" ? "Ready for PI review" : "Review readiness",
      body: "Mock AI check: objective, protocol run, notes, attachments, signatures, and comments are tracked for the report.",
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
    history: [...detail.history, createHistoryEntry(actor, actorUid, deviceIdentity, action, timestamp)],
    versions: [...detail.versions, revision],
    revisionNumber: revision.revisionNumber ?? (detail.revisionNumber ?? detail.versions.length) + 1,
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
  return template.steps.map((label, index) => ({
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
    const unsubscribers = [
      onSnapshot(query(pathFor(activeLab.id, "experiments"), orderBy("modifiedAt", "desc")), (snapshot) => {
        const details = snapshot.docs.map((item) => normalizedDetail(item.data() as ExperimentDetail));
        setState((prev) => ({
          ...prev,
          experiments: details.map(detailToExperiment),
          experimentDetails: Object.fromEntries(details.map((detail) => [detail.id, { ...detail, aiInsights: mockInsights(detail) }])),
          isLoading: false,
        }));
      }),
      onSnapshot(query(pathFor(activeLab.id, "protocolTemplates"), orderBy("updatedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, protocolTemplates: snapshot.docs.map((item) => item.data() as ProtocolTemplate) }));
      }),
      onSnapshot(query(pathFor(activeLab.id, "inventoryItems"), orderBy("updatedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, inventoryItems: snapshot.docs.map((item) => item.data() as InventoryItem) }));
      }),
      onSnapshot(pathFor(activeLab.id, "sampleRecords"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as SampleRecord)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setState((prev) => ({ ...prev, sampleRecords: records }));
      }),
      onSnapshot(pathFor(activeLab.id, "projectRecords"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as ProjectRecord)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setState((prev) => ({ ...prev, projectRecords: records }));
      }),
      onSnapshot(pathFor(activeLab.id, "notifications"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as NotificationRecord)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setState((prev) => ({ ...prev, notifications: records }));
      }),
      onSnapshot(pathFor(activeLab.id, "collaborationTasks"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as CollaborationTask)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setState((prev) => ({ ...prev, collaborationTasks: records }));
      }),
      onSnapshot(pathFor(activeLab.id, "integrationImports"), (snapshot) => {
        const records = snapshot.docs
          .map((item) => item.data() as IntegrationImport)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setState((prev) => ({ ...prev, integrationImports: records }));
      }),
      onSnapshot(pathFor(activeLab.id, "auditEvents"), (snapshot) => {
        const events = snapshot.docs.map((item) => item.data() as AuditEvent).sort((a, b) => eventTime(b) - eventTime(a));
        setState((prev) => ({ ...prev, auditEvents: events }));
      }),
      onSnapshot(query(pathFor(activeLab.id, "attachments"), orderBy("uploadedAt", "desc")), (snapshot) => {
        setState((prev) => ({ ...prev, attachments: snapshot.docs.map((item) => item.data() as AttachmentRecord) }));
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeLab]);

  const actor = user?.name ?? "Unknown user";
  const actorUid = user?.uid ?? "";
  const initials = user?.initials ?? "??";
  const activePiUid = activeMember?.role === "owner" || activeMember?.role === "pi" ? activeMember.uid : activeMember?.piUid ?? null;

  const value = useMemo<LabDataContextValue>(() => {
    const labId = activeLab?.id;
    const createNotification = async (input: Omit<NotificationRecord, "id" | "createdAt" | "readBy">) => {
      if (!labId) return;
      const id = createId("notification");
      const record: NotificationRecord = {
        id,
        ...input,
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
          reviewDecisionAt: null,
          reviewDecisionBy: null,
          reviewComment: null,
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
        const revision = versionSnapshot(detail, actor, actorUid, deviceIdentity, "Created experiment", fieldChanges, timestamp);
        detail.revisionNumber = revision.revisionNumber;
        detail.history = [createHistoryEntry(actor, actorUid, deviceIdentity, "Created experiment", timestamp)];
        detail.versions = [revision];
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
          versionNumber: revision.revisionNumber,
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
      },
      uploadAttachment: async (experimentId, file, protocolStepId = null) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) throw new Error("Experiment not found");
        if (detail.locked) throw new Error("Signed experiments are locked. Create an amendment before uploading files.");
        const id = createId("attachment");
        const storagePath = `labs/${labId}/experiments/${experimentId}/${id}-${file.name}`;
        const fileRef = ref(requireStorage(), storagePath);
        await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(fileRef);
        const timestamp = nowIso();
        const record: AttachmentRecord = {
          id,
          experimentId,
          protocolStepId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          storagePath,
          downloadURL,
          uploadedBy: actor,
          uploadedByUid: actorUid,
          uploadedAt: timestamp,
        };
        const fieldChanges = [
          fieldChange("Attachment count", detail.attachmentIds.length, detail.attachmentIds.length + 1),
          fieldChange("Attachment file", null, file.name),
          fieldChange("Attachment size", null, `${file.size} bytes`),
          fieldChange("Protocol step attachment", null, protocolStepId ?? "Experiment"),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Uploaded attachment", fieldChanges, timestamp);
        await setDoc(docFor(labId, "attachments", id), record);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          attachmentIds: [...detail.attachmentIds, id],
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
          kind: "experiment",
          actor,
          action: "Uploaded attachment",
          targetId: experimentId,
          targetLabel: file.name,
          targetType: "attachment",
          summary: `Uploaded ${file.name}.`,
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      submitExperimentForReview: async (experimentId, comment = "") => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Signed experiments are already locked.");
        const timestamp = nowIso();
        const fieldChanges = [
          fieldChange("Status", detail.status, "review"),
          fieldChange("Review status", detail.reviewStatus, "requested"),
          fieldChange("Review requested by", detail.reviewRequestedBy, actor),
          fieldChange("Review note", detail.reviewComment, comment.trim() || null),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Submitted for PI review", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          status: "review",
          reviewStatus: "requested",
          reviewRequestedAt: timestamp,
          reviewRequestedBy: actor,
          reviewComment: comment.trim() || null,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createNotification({
          kind: "review",
          title: "Experiment ready for review",
          body: `${actor} submitted ${detail.name} for PI review.`,
          targetType: "experiment",
          targetId: experimentId,
          priority: "high",
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Submitted for review",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: comment.trim() || "Requested PI review.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      approveExperimentReview: async (experimentId, comment = "") => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        const timestamp = nowIso();
        const fieldChanges = [
          fieldChange("Review status", detail.reviewStatus, "approved"),
          fieldChange("Review decision by", detail.reviewDecisionBy, actor),
          fieldChange("Review comment", detail.reviewComment, comment.trim() || "Approved for signature."),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Approved review", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          reviewStatus: "approved",
          reviewDecisionAt: timestamp,
          reviewDecisionBy: actor,
          reviewComment: comment.trim() || "Approved for signature.",
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createNotification({
          kind: "review",
          title: "Review approved",
          body: `${actor} approved ${detail.name}.`,
          targetType: "experiment",
          targetId: experimentId,
          priority: "normal",
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Approved review",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: comment.trim() || "Approved experiment review.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      rejectExperimentReview: async (experimentId, comment) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        const timestamp = nowIso();
        const fieldChanges = [
          fieldChange("Status", detail.status, "active"),
          fieldChange("Review status", detail.reviewStatus, "rejected"),
          fieldChange("Review decision by", detail.reviewDecisionBy, actor),
          fieldChange("Review comment", detail.reviewComment, comment.trim()),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Rejected review", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          status: "active",
          reviewStatus: "rejected",
          reviewDecisionAt: timestamp,
          reviewDecisionBy: actor,
          reviewComment: comment.trim(),
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
        });
        await createNotification({
          kind: "review",
          title: "Review changes requested",
          body: `${actor} requested changes on ${detail.name}.`,
          targetType: "experiment",
          targetId: experimentId,
          priority: "high",
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Rejected review",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: comment.trim() || "Requested changes before signature.",
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      signExperiment: async (experimentId, meaning, comment) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) return;
        if (detail.locked) throw new Error("Experiment is already signed and locked.");
        const timestamp = nowIso();
        const signature = {
          id: createId("signature"),
          signerUid: actorUid,
          signerName: actor,
          meaning,
          comment: comment.trim(),
          signedAt: timestamp,
        };
        const fieldChanges = [
          fieldChange("Status", detail.status, "complete"),
          fieldChange("Review status", detail.reviewStatus, "signed"),
          fieldChange("Locked", detail.locked, true),
          fieldChange("Locked by", detail.lockedBy, actor),
          fieldChange("Signature count", detail.signatures.length, detail.signatures.length + 1),
          fieldChange("Signature meaning", null, meaning),
          fieldChange("Signature comment", null, comment.trim()),
        ].filter((change): change is AuditFieldChange => Boolean(change));
        const changePatch = experimentChangePatch(detail, actor, actorUid, deviceIdentity, "Electronically signed and locked", fieldChanges, timestamp);
        await updateDoc(docFor(labId, "experiments", experimentId), {
          status: "complete",
          reviewStatus: "signed",
          locked: true,
          lockedAt: timestamp,
          lockedBy: actor,
          signatures: [...detail.signatures, signature],
          versions: changePatch.versions,
          revisionNumber: changePatch.revisionNumber,
          modified: "Just now",
          modifiedAt: timestamp,
          history: changePatch.history,
        });
        await createNotification({
          kind: "signature",
          title: "Experiment signed",
          body: `${detail.name} was signed and locked by ${actor}.`,
          targetType: "experiment",
          targetId: experimentId,
          priority: "normal",
        });
        await createAudit({
          labId,
          actorUid,
          deviceIdentity,
          kind: "experiment",
          actor,
          action: "Signed experiment",
          targetId: experimentId,
          targetLabel: detail.name,
          targetType: "experiment",
          summary: `${actor} signed as ${meaning}. ${comment.trim()}`,
          fieldChanges,
          versionNumber: changePatch.revision.revisionNumber,
        });
      },
      createExperimentAmendment: async (experimentId, reason) => {
        if (!labId) throw new Error("No active lab");
        const detail = state.experimentDetails[experimentId];
        if (!detail) throw new Error("Experiment not found");
        const id = createId("EXP");
        const timestamp = nowIso();
        const nextVersion = (detail.versionNumber ?? 1) + 1;
        const amendment: ExperimentDetail = {
          ...detail,
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
          reviewDecisionAt: null,
          reviewDecisionBy: null,
          reviewComment: reason.trim(),
          signatures: [],
          versions: [...detail.versions],
          versionNumber: nextVersion,
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
        const revision = versionSnapshot(amendment, actor, actorUid, deviceIdentity, `Created amendment v${nextVersion}`, fieldChanges, timestamp);
        amendment.revisionNumber = revision.revisionNumber;
        amendment.versions = [...amendment.versions, revision];
        amendment.history = [createHistoryEntry(actor, actorUid, deviceIdentity, "Created amendment", timestamp)];
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
          versionNumber: revision.revisionNumber,
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
        const template: ProtocolTemplate = {
          id,
          name: input.name.trim(),
          description: input.description.trim(),
          version: input.version ?? (existing ? existing.version + 1 : 1),
          status: input.status,
          steps: input.steps.map((step) => step.trim()).filter(Boolean),
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
          createdBy: actor,
          createdAt: nowIso(),
        };
        const fieldChanges = [
          fieldChange("Source", null, record.source),
          fieldChange("File", null, record.fileName),
          fieldChange("Rows", null, record.rowCount),
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
