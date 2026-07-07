export type ExperimentStatus = "active" | "review" | "complete" | "draft";
export type ReviewStatus = "none" | "requested" | "approved" | "rejected" | "signed" | "amendment";

export interface Experiment {
  id: string;
  name: string;
  project: string;
  projectId?: string | null;
  notebook?: string;
  status: ExperimentStatus;
  modified: string;
  modifiedAt?: string;
  owner: string;
  ownerUid?: string;
  ownerInitials: string;
  piUid?: string | null;
  tags: string[];
  archived?: boolean;
  isFavorite?: boolean;
  locked?: boolean;
  reviewStatus?: ReviewStatus;
  versionNumber?: number;
  revisionNumber?: number;
  parentExperimentId?: string | null;
}

export type ProtocolStepStatus = "done" | "in_progress" | "pending";

export interface ProtocolStep {
  id: string;
  label: string;
  status: ProtocolStepStatus;
  required?: boolean;
  timerMinutes?: number;
  completedBy?: string;
  completedAt?: string;
  note?: string;
  deviation?: string;
  reagentLotId?: string | null;
}

export type AIInsightKind = "alert" | "success" | "suggestion";

export interface AIInsight {
  id: string;
  kind: AIInsightKind;
  title: string;
  body: string;
  actionLabel?: string;
}

export interface Comment {
  id: string;
  author: string;
  initials: string;
  body: string;
  postedAt: string;
}

export interface HistoryEntry {
  id: string;
  actor: string;
  actorUid?: string;
  action: string;
  timestamp: string;
  timestampIso?: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface AuditFieldChange {
  field: string;
  before: string;
  after: string;
}

export type AuthoringBlockKind = "text" | "table" | "image" | "equation" | "checklist" | "data";

export interface AuthoringBlock {
  id: string;
  kind: AuthoringBlockKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignatureRecord {
  id: string;
  signerUid: string;
  signerName: string;
  meaning: "author" | "reviewer" | "approver";
  comment: string;
  signedAt: string;
}

export interface ExperimentVersion {
  id: string;
  versionNumber: number;
  revisionNumber?: number;
  label: string;
  action?: string;
  createdBy: string;
  createdByUid?: string;
  createdAt: string;
  deviceId?: string;
  deviceLabel?: string;
  fieldChanges?: AuditFieldChange[];
  snapshotSummary: string;
}

export interface ExperimentDetail extends Experiment {
  objective: string;
  notes: string;
  observations: string;
  protocolTemplateId?: string | null;
  protocolTemplateVersion?: number | null;
  protocol: ProtocolStep[];
  aiInsights: AIInsight[];
  comments: Comment[];
  history: HistoryEntry[];
  attachmentIds: string[];
  authoringBlocks: AuthoringBlock[];
  signatures: SignatureRecord[];
  versions: ExperimentVersion[];
  reviewRequestedAt?: string | null;
  reviewRequestedBy?: string | null;
  reviewDecisionAt?: string | null;
  reviewDecisionBy?: string | null;
  reviewComment?: string | null;
  lockedAt?: string | null;
  lockedBy?: string | null;
  dueDate?: string | null;
}

export type AuditEventKind = "experiment" | "protocol" | "comment" | "system";

export type AuditTargetType =
  | "experiment"
  | "protocol"
  | "comment"
  | "inventory"
  | "sample"
  | "project"
  | "task"
  | "notification"
  | "integration"
  | "attachment"
  | "team"
  | "system";

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  actor: string;
  actorUid?: string;
  action: string;
  targetId: string;
  targetLabel: string;
  targetType?: AuditTargetType;
  summary: string;
  timestamp: string;
  timestampIso?: string;
  timestampServer?: unknown;
  deviceId?: string;
  deviceLabel?: string;
  sessionId?: string;
  versionNumber?: number | null;
  fieldChanges?: AuditFieldChange[];
}

export interface CreateExperimentInput {
  name: string;
  project: string;
  objective: string;
  tags: string[];
  protocolTemplateId?: string;
  projectId?: string;
  notebook?: string;
  dueDate?: string;
}

export interface SaveExperimentInput {
  name: string;
  objective: string;
  notes: string;
  observations: string;
  status: ExperimentStatus;
  tags: string[];
  projectId?: string | null;
  notebook?: string;
  dueDate?: string | null;
}

export type ProtocolTemplateStatus = "draft" | "active" | "retired";

export interface ProtocolTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  status: ProtocolTemplateStatus;
  steps: string[];
  createdBy: string;
  createdByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export type InventoryLotStatus = "available" | "low" | "expired" | "depleted";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  vendor: string;
  catalogNumber: string;
  unit: string;
  lots: InventoryLot[];
  createdByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLot {
  id: string;
  lotNumber: string;
  location: string;
  quantity: number;
  unit: string;
  expirationDate: string;
  status: InventoryLotStatus;
  notes: string;
}

export interface AttachmentRecord {
  id: string;
  experimentId: string;
  protocolStepId?: string | null;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadURL: string;
  uploadedBy: string;
  uploadedByUid?: string;
  uploadedAt: string;
}

export interface SaveProtocolTemplateInput {
  id?: string;
  name: string;
  description: string;
  version?: number;
  status: ProtocolTemplateStatus;
  steps: string[];
}

export interface SaveInventoryItemInput {
  id?: string;
  name: string;
  category: string;
  vendor: string;
  catalogNumber: string;
  unit: string;
  lots: InventoryLot[];
}

export type SampleKind = "sample" | "plasmid" | "cell_line" | "antibody" | "compound" | "organism" | "dataset" | "aliquot";
export type SampleStatus = "available" | "in_use" | "consumed" | "archived";

export interface SampleRecord {
  id: string;
  name: string;
  kind: SampleKind;
  registryId: string;
  owner: string;
  ownerUid: string;
  projectId?: string | null;
  location: string;
  status: SampleStatus;
  parentSampleId?: string | null;
  source: string;
  metadata: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSampleInput {
  id?: string;
  name: string;
  kind: SampleKind;
  registryId: string;
  projectId?: string | null;
  location: string;
  status: SampleStatus;
  parentSampleId?: string | null;
  source: string;
  metadata: string;
}

export type ProjectStatus = "active" | "paused" | "archived";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerUid: string;
  ownerName: string;
  notebooks: string[];
  folders: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveProjectInput {
  id?: string;
  name: string;
  description: string;
  status: ProjectStatus;
  notebooks: string[];
  folders: string[];
  tags: string[];
}

export type NotificationKind = "review" | "comment" | "inventory" | "invite" | "signature" | "task" | "system";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  targetType: "experiment" | "inventory" | "team" | "project" | "task" | "system";
  targetId?: string | null;
  readBy: string[];
  createdAt: string;
  priority: "low" | "normal" | "high";
}

export type TaskStatus = "open" | "in_progress" | "done";

export interface CollaborationTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeUid?: string | null;
  assigneeName?: string | null;
  experimentId?: string | null;
  dueDate?: string | null;
  createdBy: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTaskInput {
  id?: string;
  title: string;
  description: string;
  assigneeUid?: string | null;
  assigneeName?: string | null;
  experimentId?: string | null;
  dueDate?: string | null;
}

export interface IntegrationImport {
  id: string;
  source: "csv" | "instrument" | "drive";
  fileName: string;
  rowCount: number;
  summary: string;
  createdBy: string;
  createdAt: string;
}

export interface TemplateLibraryItem {
  id: string;
  category: string;
  name: string;
  description: string;
  steps: string[];
  tags: string[];
}

export interface ProtocolStepTemplate {
  id: string;
  order: number;
  title: string;
  description: string;
  duration?: string;
  reagents?: string[];
}

export interface ProtocolVersionEntry {
  id: string;
  version: string;
  changeSummary: string;
  author: string;
  date: string;
}

export interface ProtocolUsage {
  experimentId: string;
  experimentName: string;
  usedAt: string;
}

export interface Protocol {
  id: string;
  name: string;
  category: string;
  version: string;
  stepCount: number;
  lastUpdated: string;
  updatedBy: string;
  usedCount: number;
  successRate?: number;
}

export interface ProtocolDetail extends Protocol {
  description: string;
  steps: ProtocolStepTemplate[];
  usedIn: ProtocolUsage[];
  versionHistory: ProtocolVersionEntry[];
  aiInsight?: {
    title: string;
    body: string;
  };
}
