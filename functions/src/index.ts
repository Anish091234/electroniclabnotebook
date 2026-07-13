import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineBoolean, defineString } from "firebase-functions/params";

const functionsRegion = defineString("FUNCTIONS_REGION", { default: "us-central1" });

// The attachment finalizer downloads and hashes evidence files. Keep a bounded
// concurrency/instance ceiling so a burst of uploads cannot exhaust an
// unlimited amount of memory or spend, while still allowing normal lab work.
setGlobalOptions({
  region: functionsRegion,
  memory: "512MiB",
  timeoutSeconds: 60,
  concurrency: 10,
  maxInstances: 20,
});

initializeApp();

const database = getFirestore();
const storage = getStorage();
// Deploy with ENFORCE_APP_CHECK=true only after the corresponding Firebase
// App Check app/site key has been verified in that environment.
const enforceAppCheck = defineBoolean("ENFORCE_APP_CHECK", { default: false });
const publicAppOrigin = defineString("PUBLIC_APP_ORIGIN");
const MAX_AUDIT_VALUE_LENGTH = 220;
const MAX_AUDIT_CHANGES = 30;
const MAX_REVIEW_EVENTS = 100;
const MAX_SIGNATURE_AUTH_AGE_SECONDS = 15 * 60;
const MAX_INVITE_NAME_LENGTH = 160;
const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 14;
const OWNERSHIP_TRANSFER_TTL_HOURS = 24;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// External collaborators are deliberately unavailable until a scoped-share
// workflow can enforce resource-level access in both Firestore and Storage.
// Keep the legacy value recognized below so an owner can promote an existing
// external member to a supported role instead of leaving the account stranded.
const ASSIGNABLE_MEMBER_ROLES = new Set(["admin", "pi", "researcher", "viewer"]);
const MANAGED_MEMBER_ROLES = new Set(["admin", "pi", "researcher", "viewer", "external"]);
const SENSITIVE_AUDIT_FIELD = /(token|secret|password|email|download.*url|share.*url|invite.*url|api.?key)/i;
// Audit logs should explain that a record changed without copying scientific
// narrative, reviewer feedback, or potentially sensitive content into a
// second, lab-wide record.
const AUDIT_SUMMARY_ONLY_FIELD = /^(objective|notes|observations|comments|protocol|authoringBlocks|aiInsights|reviewComment|description|content|body)$/i;
const SAFE_AUDIT_VALUE_FIELD = /^(status|reviewStatus|role|archived|isFavorite|visibility|priority|dueDate|locked|versionNumber|revisionNumber|attachmentIds|tags|readBy|state|contentType|size|quantity|unit|expiresAt|updatedAt|modifiedAt)$/i;
const PERMITTED_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "image/png",
  "image/jpeg",
  "image/tiff",
]);

type RecordData = Record<string, unknown>;

function asRecord(value: DocumentData | undefined): RecordData {
  return (value ?? {}) as RecordData;
}

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "string") return value.length > MAX_AUDIT_VALUE_LENGTH ? `${value.slice(0, MAX_AUDIT_VALUE_LENGTH - 3)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.length === 0 ? "None" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  // Nested objects can contain PII, tokens, or unbounded scientific content.
  // Keep the ledger structural rather than serializing an arbitrary payload.
  return "Structured value changed";
}

function sameValue(before: unknown, after: unknown) {
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

function fieldChanges(before: RecordData, after: RecordData) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !sameValue(before[key], after[key]))
    .slice(0, MAX_AUDIT_CHANGES)
    .map((field) => {
      const redact = SENSITIVE_AUDIT_FIELD.test(field) || AUDIT_SUMMARY_ONLY_FIELD.test(field);
      const summarize = !redact && SAFE_AUDIT_VALUE_FIELD.test(field);
      return {
        field,
        before: redact ? "Redacted" : summarize ? text(before[field]) : "Changed",
        after: redact ? "Redacted" : summarize ? text(after[field]) : "Changed",
      };
    });
}

function auditKind(collectionId: string) {
  if (collectionId === "experiments") return "experiment";
  if (collectionId === "protocolTemplates") return "protocol";
  if (collectionId === "attachments") return "attachment";
  if (collectionId === "projectRecords") return "project";
  if (collectionId === "collaborationTasks") return "task";
  if (collectionId === "notifications") return "notification";
  if (collectionId === "integrationImports") return "integration";
  return "system";
}

function targetLabel(data: RecordData, fallback: string) {
  return typeof data.name === "string"
    ? data.name
    : typeof data.title === "string"
      ? data.title
      : typeof data.fileName === "string"
        ? data.fileName
        : fallback;
}

function auditAction(beforeExists: boolean, afterExists: boolean, collectionId: string) {
  if (!beforeExists) return `Created ${collectionId}`;
  if (!afterExists) return `Deleted ${collectionId}`;
  return `Updated ${collectionId}`;
}

function isTrustedSignature(collectionId: string, before: RecordData, after: RecordData) {
  return collectionId === "experiments"
    && before.locked !== true
    && after.locked === true
    && typeof after.lockedByUid === "string";
}

function hasExplicitTrustedAudit(collectionId: string, authType: string, _signed: boolean) {
  if (authType !== "service_account") return false;
  // Every current trusted mutation in these collections writes its evidence in
  // the same Firestore transaction. Any future service-account job that
  // changes them must do the same rather than relying on asynchronous audit
  // delivery.
  return collectionId === "members"
    || collectionId === "piGroups"
    || collectionId === "experiments";
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return value.trim();
}

function requireDocumentId(value: unknown, field: string) {
  const id = requireString(value, field);
  if (id.length > 128 || id.includes("/")) {
    throw new HttpsError("invalid-argument", `${field} must be a single Firestore document ID.`);
  }
  return id;
}

function activeMemberRole(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const member = value as RecordData;
  if (member.status !== "active" || typeof member.role !== "string") return null;
  return member.role;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requireEmail(value: unknown, field: string) {
  const email = requireString(value, field).toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", `${field} must be a valid email address.`);
  }
  return email;
}

function requireInviteRole(value: unknown) {
  const role = requireString(value, "role");
  if (role === "external") {
    throw new HttpsError("failed-precondition", "External collaborator invitations are disabled until scoped sharing is available.");
  }
  if (!ASSIGNABLE_MEMBER_ROLES.has(role)) {
    throw new HttpsError("invalid-argument", "role must be an allowed lab role.");
  }
  return role;
}

function requireManagedMemberRole(value: unknown) {
  const role = requireString(value, "role");
  if (role === "external") {
    throw new HttpsError("failed-precondition", "External collaborator access is disabled until scoped sharing is available.");
  }
  if (!ASSIGNABLE_MEMBER_ROLES.has(role)) {
    throw new HttpsError("invalid-argument", "role must be a non-owner lab role.");
  }
  return role;
}

function requireMemberStatus(value: unknown) {
  if (value !== "active" && value !== "disabled") {
    throw new HttpsError("invalid-argument", "status must be active or disabled.");
  }
  return value;
}

function requireConfirmation(value: unknown, expected: string, action: string) {
  if (value !== expected) {
    throw new HttpsError("failed-precondition", `Explicit confirmation is required to ${action}.`);
  }
}

async function verifiedAccountEmail(uid: string, subject: string) {
  try {
    const account = await getAuth().getUser(uid);
    if (account.emailVerified !== true || !account.email) {
      throw new HttpsError("failed-precondition", `${subject} must have a verified email address.`);
    }
    return requireEmail(account.email, `${subject} email`);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", `${subject} no longer has a verified Firebase Authentication account.`);
  }
}

function inviteDisplayName(value: unknown, email: string) {
  if (value === undefined || value === null || value === "") return email.split("@")[0];
  const name = requireString(value, "displayName");
  if (name.length > MAX_INVITE_NAME_LENGTH) {
    throw new HttpsError("invalid-argument", `displayName must be ${MAX_INVITE_NAME_LENGTH} characters or fewer.`);
  }
  return name;
}

function requireInviteToken(value: unknown) {
  const token = requireString(value, "invite token");
  if (token.length < 32 || token.length > 512) {
    throw new HttpsError("invalid-argument", "Invite token is invalid.");
  }
  return token;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest();
}

function inviteTokenMatches(token: string, expectedHash: unknown) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const actual = tokenHash(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isValidFutureDate(value: unknown, nowMillis: number) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > nowMillis;
}

function inviteUrl(input: { labId: string; inviteId: string; token: string }) {
  const origin = requireString(publicAppOrigin.value(), "PUBLIC_APP_ORIGIN");
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new HttpsError("invalid-argument", "appOrigin must be a valid absolute URL.");
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalhost) {
    throw new HttpsError("invalid-argument", "Invite links must use HTTPS outside local development.");
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/login`;
  // Keep the bearer token out of HTTP request URLs and their hosting/access
  // logs. Login captures the fragment into session storage and immediately
  // replaces the visible URL before initiating any authenticated action.
  url.hash = new URLSearchParams({
    invite: input.token,
    inviteId: input.inviteId,
    labId: input.labId,
  }).toString();
  return url.toString();
}

function writeTrustedInviteAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    auditId: string;
    actorUid: string;
    actor: string;
    action: string;
    inviteId: string;
    timestamp: Timestamp;
    fieldChanges?: Array<{ field: string; before: string; after: string }>;
  },
) {
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(input.auditId);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: input.auditId,
    kind: "system",
    actor: input.actor,
    actorUid: input.actorUid,
    action: input.action,
    targetId: input.inviteId,
    targetLabel: `Invitation ${input.inviteId}`,
    targetType: "team",
    summary: `Server-authorized ${input.action.toLowerCase()}.`,
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: input.fieldChanges ?? [],
  });
}

function requireAttachmentFileName(value: unknown) {
  const fileName = requireString(value, "fileName");
  const containsControlCharacter = [...fileName].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
  if (fileName.length > 240 || containsControlCharacter) {
    throw new HttpsError("invalid-argument", "fileName is invalid.");
  }
  return fileName;
}

function reviewComment(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpsError("invalid-argument", "review comment must be text.");
  const comment = value.trim();
  if (comment.length > 2_000) throw new HttpsError("invalid-argument", "review comment must be 2,000 characters or fewer.");
  return comment;
}

function reviewDueDate(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "reviewDueDate must use YYYY-MM-DD.");
  }
  return value;
}

function permittedAttachmentContentType(value: unknown) {
  return typeof value === "string" && PERMITTED_ATTACHMENT_CONTENT_TYPES.has(value.toLowerCase());
}

function writeTrustedAttachmentAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    attachmentId: string;
    experimentId: string;
    actorUid: string;
    actor: string;
    fileName: string;
    size: number;
    timestamp: Timestamp;
  },
) {
  const auditId = `attachment-${input.attachmentId}-finalized`;
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(auditId);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: auditId,
    kind: "attachment",
    actor: input.actor,
    actorUid: input.actorUid,
    action: "Finalized immutable attachment",
    targetId: input.attachmentId,
    targetLabel: input.fileName,
    targetType: "attachment",
    summary: "Server-validated attachment metadata, object generation, and SHA-256 were recorded.",
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: [
      { field: "Experiment", before: "Empty", after: input.experimentId },
      { field: "Size", before: "Empty", after: `${input.size} bytes` },
      { field: "Integrity", before: "Empty", after: "SHA-256 recorded" },
    ],
  });
}

function writeTrustedMembershipAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    targetUid: string;
    actorUid: string;
    actor: string;
    timestamp: Timestamp;
    fieldChanges: Array<{ field: string; before: string; after: string }>;
  },
) {
  const auditId = `member-${input.targetUid}-${input.timestamp.toMillis()}`;
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(auditId);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: auditId,
    kind: "system",
    actor: input.actor,
    actorUid: input.actorUid,
    action: "Updated lab member access",
    targetId: input.targetUid,
    targetLabel: `Lab member ${input.targetUid}`,
    targetType: "team",
    summary: "An owner updated a member role, status, or PI assignment through the trusted access workflow.",
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: input.fieldChanges,
  });
}

function writeTrustedOwnershipTransferAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    transferId: string;
    targetUid: string;
    targetName: string;
    actorUid: string;
    actor: string;
    auditKey: string;
    action: string;
    summary: string;
    timestamp: Timestamp;
    fieldChanges: Array<{ field: string; before: string; after: string }>;
  },
) {
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(`ownership-${input.transferId}-${input.auditKey}`);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: auditRef.id,
    kind: "system",
    actor: input.actor,
    actorUid: input.actorUid,
    action: input.action,
    targetId: input.targetUid,
    targetLabel: input.targetName,
    targetType: "team",
    summary: input.summary,
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: input.fieldChanges,
  });
}

function reviewTransition(
  experiment: RecordData,
  input: {
    actor: string;
    actorUid: string;
    action: string;
    timestamp: Timestamp;
    fieldChanges: Array<{ field: string; before: string; after: string }>;
  },
) {
  const timestamp = input.timestamp.toDate().toISOString();
  const history = Array.isArray(experiment.history) ? experiment.history : [];
  const versions = Array.isArray(experiment.versions) ? experiment.versions : [];
  const revisionNumber = typeof experiment.revisionNumber === "number" ? experiment.revisionNumber + 1 : 1;
  const versionNumber = typeof experiment.versionNumber === "number" ? experiment.versionNumber : 1;

  return {
    history: [
      ...history,
      {
        id: `history-${input.timestamp.toMillis()}-${input.actorUid.slice(0, 8)}`,
        actor: input.actor,
        actorUid: input.actorUid,
        action: input.action,
        timestamp,
        timestampIso: timestamp,
        source: "trusted-server",
      },
    ],
    versions: [
      ...versions,
      {
        id: `version-${input.timestamp.toMillis()}-${input.actorUid.slice(0, 8)}`,
        versionNumber,
        revisionNumber,
        label: `v${versionNumber}.${revisionNumber}`,
        action: input.action,
        createdBy: input.actor,
        createdByUid: input.actorUid,
        createdAt: timestamp,
        snapshotSummary: "Server-authorized independent review transition recorded.",
        fieldChanges: input.fieldChanges,
      },
    ],
    revisionNumber,
    modified: "Just now",
    modifiedAt: timestamp,
    modifiedAtServer: input.timestamp,
  };
}

function writeTrustedReviewAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    experimentId: string;
    actorUid: string;
    actor: string;
    action: string;
    targetLabel: string;
    timestamp: Timestamp;
    fieldChanges: Array<{ field: string; before: string; after: string }>;
  },
) {
  const auditId = `review-${input.experimentId}-${input.timestamp.toMillis()}-${input.actorUid.slice(0, 8)}`;
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(auditId);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: auditId,
    kind: "experiment",
    actor: input.actor,
    actorUid: input.actorUid,
    action: input.action,
    targetId: input.experimentId,
    targetLabel: input.targetLabel,
    targetType: "experiment",
    summary: `Server-authorized ${input.action.toLowerCase()}.`,
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: input.fieldChanges,
  });
}

function writeTrustedSignatureAudit(
  transaction: import("firebase-admin/firestore").Transaction,
  input: {
    labId: string;
    experimentId: string;
    signatureId: string;
    actorUid: string;
    actor: string;
    targetLabel: string;
    timestamp: Timestamp;
    fieldChanges: Array<{ field: string; before: string; after: string }>;
  },
) {
  const auditId = `signature-${input.experimentId}-${input.signatureId}`;
  const auditRef = database.collection("labs").doc(input.labId).collection("auditEvents").doc(auditId);
  const timestamp = input.timestamp.toDate().toISOString();
  transaction.set(auditRef, {
    id: auditId,
    kind: "experiment",
    actor: input.actor,
    actorUid: input.actorUid,
    action: "Electronically signed and locked",
    targetId: input.experimentId,
    targetLabel: input.targetLabel,
    targetType: "experiment",
    summary: "Server-authorized electronic signature recorded and the experiment was locked.",
    timestamp,
    timestampIso: timestamp,
    timestampServer: input.timestamp,
    authType: "trusted-function",
    fieldChanges: input.fieldChanges,
  });
}

function signatureReadinessIssues(experiment: RecordData, knownLotIds: Set<string>) {
  const issues: string[] = [];
  if (typeof experiment.objective !== "string" || experiment.objective.trim().length === 0) issues.push("Objective is missing.");
  if (typeof experiment.notes !== "string" || experiment.notes.trim().length === 0) issues.push("Notebook notes are missing.");
  if (typeof experiment.observations !== "string" || experiment.observations.trim().length === 0) issues.push("Observations are missing.");
  if (!Array.isArray(experiment.attachmentIds) || experiment.attachmentIds.length === 0) issues.push("At least one raw attachment is required.");

  if (!Array.isArray(experiment.protocol) || experiment.protocol.length === 0) {
    issues.push("At least one protocol step is required.");
  } else {
    const stepIds = new Set<string>();
    const hasIncompleteStep = experiment.protocol.some((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const step = value as RecordData;
      const stepId = typeof step.id === "string" ? step.id : "";
      const label = typeof step.label === "string" ? step.label.trim() : "";
      const validStatus = step.status === "pending" || step.status === "in_progress" || step.status === "done";
      if (!stepId || stepId.length > 128 || stepId.includes("/") || !label || label.length > 500 || !validStatus || stepIds.has(stepId)) {
        return true;
      }
      stepIds.add(stepId);
      return step.status !== "done";
    });
    if (hasIncompleteStep) issues.push("Protocol steps are incomplete or malformed.");

    const hasInvalidLot = experiment.protocol.some((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const step = value as RecordData;
      return !step.reagentLotId
        || typeof step.reagentLotId !== "string"
        || step.reagentLotId.length > 128
        || step.reagentLotId.includes("/")
        || !knownLotIds.has(step.reagentLotId);
    });
    if (hasInvalidLot) issues.push("Protocol reagent lots are missing or do not match lab inventory.");
  }

  return issues;
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Timestamp) return JSON.stringify(value.toDate().toISOString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as RecordData;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function signatureManifest(
  labId: string,
  experimentId: string,
  experiment: RecordData,
  attachments: Array<{ id: string; data: RecordData }>,
) {
  const protocol = Array.isArray(experiment.protocol) ? experiment.protocol : [];
  const authoringBlocks = Array.isArray(experiment.authoringBlocks) ? experiment.authoringBlocks : [];
  const comments = Array.isArray(experiment.comments) ? experiment.comments : [];
  const reviewEvents = Array.isArray(experiment.reviewEvents) ? experiment.reviewEvents : [];

  return {
    schemaVersion: 1,
    labId,
    experimentId,
    record: {
      id: stringValue(experiment.id, experimentId),
      ownerUid: stringValue(experiment.ownerUid),
      owner: stringValue(experiment.owner),
      piUid: experiment.piUid ?? null,
      parentExperimentId: experiment.parentExperimentId ?? null,
      versionNumber: experiment.versionNumber ?? null,
      name: stringValue(experiment.name),
      project: stringValue(experiment.project),
      projectId: experiment.projectId ?? null,
      notebook: stringValue(experiment.notebook),
      dueDate: experiment.dueDate ?? null,
      tags: Array.isArray(experiment.tags) ? experiment.tags : [],
      objective: stringValue(experiment.objective),
      notes: stringValue(experiment.notes),
      observations: stringValue(experiment.observations),
      protocolTemplateId: experiment.protocolTemplateId ?? null,
      protocolTemplateVersion: experiment.protocolTemplateVersion ?? null,
      protocol,
      authoringBlocks,
      comments,
      review: {
        status: stringValue(experiment.reviewStatus),
        requestedAt: experiment.reviewRequestedAt ?? null,
        requestedByUid: experiment.reviewRequestedByUid ?? null,
        reviewerUid: experiment.reviewAssignedToUid ?? null,
        decisionAt: experiment.reviewDecisionAt ?? null,
        decisionByUid: experiment.reviewDecisionByUid ?? null,
        comment: experiment.reviewComment ?? null,
        events: reviewEvents,
      },
    },
    attachments: attachments
      .map(({ id, data }) => ({
        id,
        experimentId: data.experimentId ?? null,
        protocolStepId: data.protocolStepId ?? null,
        fileName: data.fileName ?? null,
        contentType: data.contentType ?? null,
        size: data.size ?? null,
        storagePath: data.storagePath ?? null,
        generation: data.generation ?? null,
        sha256: data.sha256 ?? null,
        state: data.state ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function finalizedAttachmentReadinessIssues(
  labId: string,
  experimentId: string,
  attachments: Array<{ id: string; exists: boolean; data: RecordData }>,
) {
  const checkAttachment = async (attachment: { id: string; exists: boolean; data: RecordData }) => {
    const issues: string[] = [];
    if (!attachment.exists) {
      issues.push(`Attachment ${attachment.id} is missing its finalized metadata.`);
      return issues;
    }
    const data = attachment.data;
    const expectedPath = `labs/${labId}/experiments/${experimentId}/${attachment.id}`;
    if (
      data.id !== attachment.id
      || data.experimentId !== experimentId
      || data.storagePath !== expectedPath
      || data.state !== "finalized"
      || typeof data.generation !== "string"
      || !/^[a-f0-9]{64}$/i.test(stringValue(data.sha256))
    ) {
      issues.push(`Attachment ${attachment.id} does not have valid finalized integrity metadata.`);
      return issues;
    }

    try {
      const [metadata] = await storage.bucket().file(expectedPath).getMetadata();
      if (
        stringValue(metadata.generation) !== data.generation
        || Number(metadata.size) !== data.size
        || stringValue(metadata.contentType).toLowerCase() !== stringValue(data.contentType).toLowerCase()
        || metadata.metadata?.labId !== labId
        || metadata.metadata?.experimentId !== experimentId
        || metadata.metadata?.attachmentId !== attachment.id
      ) {
        issues.push(`Attachment ${attachment.id} no longer matches its immutable object evidence.`);
      }
    } catch {
      issues.push(`Attachment ${attachment.id} object evidence is unavailable.`);
    }
    return issues;
  };

  // Object metadata reads are network-bound. Check in small batches instead
  // of serially (slow for instrument-heavy records) or all at once (which can
  // spike Storage requests and memory under concurrent Functions instances).
  const issues: string[] = [];
  const batchSize = 12;
  for (let index = 0; index < attachments.length; index += batchSize) {
    const results = await Promise.all(attachments.slice(index, index + batchSize).map(checkAttachment));
    results.forEach((result) => issues.push(...result));
  }

  return issues;
}

function authorSignatureFrom(experiment: RecordData) {
  if (!Array.isArray(experiment.signatures)) return null;
  // A signed LabOS record currently has one author signature. Keep the lookup
  // ordered by the immutable array in case historic records contain more than
  // one author entry.
  const signatures = experiment.signatures
    .filter((value): value is RecordData => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .filter((signature) => signature.meaning === "author");
  return signatures.at(-1) ?? null;
}

/**
 * Rebuilds the canonical evidence manifest for a locked record and checks the
 * immutable attachment metadata against Cloud Storage. This is deliberately a
 * read-only verification command: it provides an audit-ready answer without
 * changing the record or creating audit noise every time someone inspects it.
 */
export const verifyExperimentIntegrity = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before verifying a signed experiment.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before verifying signed evidence.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const experimentId = requireDocumentId(request.data?.experimentId, "experimentId");
  const labRef = database.collection("labs").doc(labId);
  const [memberSnapshot, experimentSnapshot] = await Promise.all([
    labRef.collection("members").doc(authenticated.uid).get(),
    labRef.collection("experiments").doc(experimentId).get(),
  ]);
  if (!activeMemberRole(memberSnapshot.data())) {
    throw new HttpsError("permission-denied", "You are not an active member of this lab.");
  }
  if (!experimentSnapshot.exists) {
    throw new HttpsError("not-found", "Experiment not found.");
  }

  const experiment = asRecord(experimentSnapshot.data());
  const signature = authorSignatureFrom(experiment);
  const expectedManifestSha256 = stringValue(signature?.manifestSha256).toLowerCase();
  const failures: string[] = [];

  if (experiment.locked !== true || experiment.reviewStatus !== "signed") {
    failures.push("This record is not in the signed and locked state.");
  }
  if (!signature) {
    failures.push("No author signature is present on this record.");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) {
    failures.push("The author signature does not contain a valid evidence manifest hash.");
  }
  if (signature && signature.signerUid !== experiment.ownerUid) {
    failures.push("The author signature no longer matches the record owner.");
  }
  if (signature && typeof signature.signedAt !== "string") {
    failures.push("The author signature is missing its signed timestamp.");
  }

  const attachmentIds = Array.isArray(experiment.attachmentIds) ? experiment.attachmentIds : [];
  const validAttachmentIds = attachmentIds.filter(
    (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/"),
  );
  if (attachmentIds.length !== validAttachmentIds.length || new Set(validAttachmentIds).size !== validAttachmentIds.length) {
    failures.push("Attachment references are malformed or duplicated.");
  }

  const attachmentSnapshots = validAttachmentIds.length > 0
    ? await database.getAll(...validAttachmentIds.map((attachmentId) => labRef.collection("attachments").doc(attachmentId)))
    : [];
  const attachmentEvidence = attachmentSnapshots.map((snapshot, index) => ({
    id: validAttachmentIds[index],
    exists: snapshot.exists,
    data: asRecord(snapshot.data()),
  }));
  const attachmentIssues = await finalizedAttachmentReadinessIssues(labId, experimentId, attachmentEvidence);
  failures.push(...attachmentIssues);

  const computedManifestSha256 = createHash("sha256")
    .update(canonicalJson(signatureManifest(
      labId,
      experimentId,
      experiment,
      attachmentEvidence.map(({ id, data }) => ({ id, data })),
    )))
    .digest("hex");
  if (/^[a-f0-9]{64}$/.test(expectedManifestSha256) && computedManifestSha256 !== expectedManifestSha256) {
    failures.push("The current record content does not match the evidence manifest captured at signing.");
  }

  return {
    verified: failures.length === 0,
    signatureId: stringValue(signature?.id) || null,
    signedAt: stringValue(signature?.signedAt) || null,
    manifestSha256: expectedManifestSha256 || null,
    computedManifestSha256,
    attachmentCount: validAttachmentIds.length,
    checks: {
      signedAndLocked: experiment.locked === true && experiment.reviewStatus === "signed",
      signaturePresent: Boolean(signature),
      signatureMatchesOwner: Boolean(signature) && signature?.signerUid === experiment.ownerUid,
      manifestMatches: /^[a-f0-9]{64}$/.test(expectedManifestSha256) && computedManifestSha256 === expectedManifestSha256,
      attachmentEvidenceMatches: attachmentIssues.length === 0,
    },
    failures,
  };
});

export const recordAuditEvent = onDocumentWrittenWithAuthContext(
  {
    document: "labs/{labId}/{collectionId}/{documentId}",
    // Firestore/Eventarc delivery is at-least-once. Retrying transient ledger
    // failures is safe because the source CloudEvent ID below is idempotent.
    retry: true,
  },
  async (event) => {
    const { labId, collectionId, documentId } = event.params;
    // Invitation and ownership-transfer records are intentionally audited by
    // their trusted command. Do not copy an invite verifier or address into
    // the lab-wide ledger, or duplicate a transactionally coupled audit row.
    if (
      ["auditEvents", "invites", "inviteSecrets", "attachments", "ownershipTransfers", "ownershipTransferState"].includes(collectionId)
    ) return;

    const beforeExists = Boolean(event.data?.before.exists);
    const afterExists = Boolean(event.data?.after.exists);
    if (!beforeExists && !afterExists) return;

    const before = asRecord(event.data?.before.data());
    const after = asRecord(event.data?.after.data());
    const data = afterExists ? after : before;
    const signed = isTrustedSignature(collectionId, before, after);
    if (hasExplicitTrustedAudit(collectionId, event.authType, signed)) return;

    const authId = signed && typeof after.lockedByUid === "string" ? after.lockedByUid : event.authId || null;
    const action = signed ? "Signed experiment" : auditAction(beforeExists, afterExists, collectionId);
    const actor = signed && typeof after.lockedBy === "string"
      ? after.lockedBy
      : authId ?? (event.authType === "system" ? "System" : "Unknown principal");
    // CloudEvents provide a globally unique event ID. Couple the ledger row to
    // that ID and only write it once so retries never mutate its timestamp or
    // duplicate a record.
    const auditId = `event-${createHash("sha256").update(event.id).digest("hex")}`;
    const auditRef = database.collection("labs").doc(labId).collection("auditEvents").doc(auditId);
    const sourceTime = new Date(event.time);
    const timestamp = Number.isNaN(sourceTime.getTime()) ? new Date().toISOString() : sourceTime.toISOString();
    const auditEvent = {
      id: auditId,
      kind: auditKind(collectionId),
      actor,
      actorUid: authId,
      action,
      targetId: documentId,
      targetLabel: targetLabel(data, documentId),
      targetType: auditKind(collectionId),
      summary: `Server-recorded ${action.toLowerCase()}.`,
      timestamp,
      timestampIso: timestamp,
      timestampServer: FieldValue.serverTimestamp(),
      authType: event.authType,
      sourceEventId: event.id,
      sourceEventTime: event.time,
      fieldChanges: fieldChanges(before, after),
    };

    await database.runTransaction(async (transaction) => {
      const existing = await transaction.get(auditRef);
      if (existing.exists) return;
      transaction.set(auditRef, auditEvent);
    });
  },
);

export const createLabInvite = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before creating an invite.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before creating an invite.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const email = requireEmail(request.data?.email, "email");
  const role = requireInviteRole(request.data?.role);
  const displayName = inviteDisplayName(request.data?.displayName, email);
  const piUid = role === "researcher" ? requireDocumentId(request.data?.piUid, "piUid") : null;
  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  const inviteRef = database.collection("labs").doc(labId).collection("invites").doc();
  const secretRef = database.collection("labs").doc(labId).collection("inviteSecrets").doc(inviteRef.id);
  const labRef = database.collection("labs").doc(labId);
  const requesterMemberRef = labRef.collection("members").doc(authenticated.uid);
  const now = Timestamp.now();
  const createdAt = now.toDate().toISOString();
  const expiresAt = new Date(now.toMillis() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);
  const inviteLink = inviteUrl({ labId, inviteId: inviteRef.id, token });
  const invite = {
    id: inviteRef.id,
    email,
    displayName,
    role,
    piUid,
    invitedByUid: authenticated.uid,
    invitedByName: actor,
    status: "pending",
    emailQueuedAt: null,
    acceptedByUid: null,
    acceptedAt: null,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
  };

  await database.runTransaction(async (transaction) => {
    const labSnapshot = await transaction.get(labRef);
    const requesterSnapshot = await transaction.get(requesterMemberRef);
    const requesterRole = activeMemberRole(requesterSnapshot.data());

    if (!labSnapshot.exists) {
      throw new HttpsError("not-found", "Lab not found.");
    }
    if (!requesterRole || !["owner", "admin"].includes(requesterRole)) {
      throw new HttpsError("permission-denied", "Only an active lab owner or admin can invite members.");
    }
    if (["admin", "pi"].includes(role) && requesterRole !== "owner") {
      throw new HttpsError("permission-denied", "Only a lab owner can issue admin or PI invitations.");
    }

    if (piUid) {
      const piSnapshot = await transaction.get(labRef.collection("members").doc(piUid));
      const piRole = activeMemberRole(piSnapshot.data());
      if (!piRole || !["owner", "pi"].includes(piRole)) {
        throw new HttpsError("failed-precondition", "Choose an active PI for this researcher.");
      }
    }

    transaction.create(inviteRef, invite);
    transaction.create(secretRef, {
      id: inviteRef.id,
      tokenHash: tokenHash(token).toString("hex"),
      expiresAt,
      createdAt,
    });
    writeTrustedInviteAudit(transaction, {
      labId,
      auditId: `invite-${inviteRef.id}-created`,
      actorUid: authenticated.uid,
      actor,
      action: "Created lab invite",
      inviteId: inviteRef.id,
      timestamp: now,
      fieldChanges: [{ field: "Role", before: "Empty", after: role }],
    });
  });

  return { invite, inviteUrl: inviteLink };
});

export const cancelLabInvite = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before canceling an invite.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before canceling an invite.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const inviteId = requireDocumentId(request.data?.inviteId, "inviteId");
  const labRef = database.collection("labs").doc(labId);
  const inviteRef = labRef.collection("invites").doc(inviteId);
  const secretRef = labRef.collection("inviteSecrets").doc(inviteId);
  const now = Timestamp.now();
  const updatedAt = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  await database.runTransaction(async (transaction) => {
    const requesterSnapshot = await transaction.get(labRef.collection("members").doc(authenticated.uid));
    const inviteSnapshot = await transaction.get(inviteRef);
    const secretSnapshot = await transaction.get(secretRef);
    const requesterRole = activeMemberRole(requesterSnapshot.data());

    if (!requesterRole || !["owner", "admin"].includes(requesterRole)) {
      throw new HttpsError("permission-denied", "Only an active lab owner or admin can cancel invites.");
    }
    if (!inviteSnapshot.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    if (asRecord(inviteSnapshot.data()).status !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending invites can be canceled.");
    }

    transaction.update(inviteRef, { status: "canceled", updatedAt });
    if (secretSnapshot.exists) transaction.delete(secretRef);
    writeTrustedInviteAudit(transaction, {
      labId,
      auditId: `invite-${inviteId}-canceled`,
      actorUid: authenticated.uid,
      actor,
      action: "Canceled lab invite",
      inviteId,
      timestamp: now,
    });
  });

  return { inviteId };
});

export const updateLabMember = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before managing lab access.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before managing lab access.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const targetUid = requireDocumentId(request.data?.uid, "uid");
  const patchValue = request.data?.patch;
  if (!patchValue || typeof patchValue !== "object" || Array.isArray(patchValue)) {
    throw new HttpsError("invalid-argument", "patch is required.");
  }
  const patch = patchValue as RecordData;
  const fields = Object.keys(patch);
  if (fields.length === 0 || !fields.every((field) => ["role", "status", "piUid"].includes(field))) {
    throw new HttpsError("invalid-argument", "Only role, status, and piUid can be changed.");
  }

  const hasRole = Object.prototype.hasOwnProperty.call(patch, "role");
  const hasStatus = Object.prototype.hasOwnProperty.call(patch, "status");
  const hasPi = Object.prototype.hasOwnProperty.call(patch, "piUid");
  const labRef = database.collection("labs").doc(labId);
  const callerMemberRef = labRef.collection("members").doc(authenticated.uid);
  const targetMemberRef = labRef.collection("members").doc(targetUid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  await database.runTransaction(async (transaction) => {
    const callerSnapshot = await transaction.get(callerMemberRef);
    const targetSnapshot = await transaction.get(targetMemberRef);
    const callerRole = activeMemberRole(callerSnapshot.data());

    if (callerRole !== "owner") {
      throw new HttpsError("permission-denied", "Only the lab owner can change member access.");
    }
    if (targetUid === authenticated.uid) {
      throw new HttpsError("failed-precondition", "Use the ownership-transfer workflow to change the owner account.");
    }
    if (!targetSnapshot.exists) {
      throw new HttpsError("not-found", "Lab member not found.");
    }

    const target = asRecord(targetSnapshot.data());
    const currentRole = stringValue(target.role);
    if (currentRole === "owner") {
      throw new HttpsError("failed-precondition", "Owner access cannot be changed through this workflow.");
    }
    if (!MANAGED_MEMBER_ROLES.has(currentRole)) {
      throw new HttpsError("failed-precondition", "Member has an invalid role and must be repaired by an administrator.");
    }

    const nextRole = hasRole ? requireManagedMemberRole(patch.role) : currentRole;
    const nextStatus = hasStatus ? requireMemberStatus(patch.status) : stringValue(target.status);
    if (currentRole === "pi" && nextRole !== "pi") {
      throw new HttpsError("failed-precondition", "PI demotion requires the dedicated reassignment workflow.");
    }

    let nextPiUid: string | null;
    if (nextRole === "researcher") {
      if (hasPi && patch.piUid !== null && patch.piUid !== "") {
        nextPiUid = requireDocumentId(patch.piUid, "piUid");
      } else if (hasPi) {
        nextPiUid = null;
      } else {
        nextPiUid = typeof target.piUid === "string" ? target.piUid : null;
      }

      if (nextPiUid) {
        const piSnapshot = await transaction.get(labRef.collection("members").doc(nextPiUid));
        const piRole = activeMemberRole(piSnapshot.data());
        if (!piRole || !["owner", "pi"].includes(piRole)) {
          throw new HttpsError("failed-precondition", "Choose an active PI for this researcher.");
        }
      }
    } else {
      nextPiUid = nextRole === "pi" ? targetUid : null;
    }

    const fieldChanges = [
      ...(nextRole !== currentRole ? [{ field: "Role", before: currentRole, after: nextRole }] : []),
      ...(nextStatus !== stringValue(target.status) ? [{ field: "Status", before: stringValue(target.status), after: nextStatus }] : []),
      ...(nextPiUid !== (typeof target.piUid === "string" ? target.piUid : null)
        ? [{ field: "PI assignment", before: stringValue(target.piUid, "Unassigned"), after: nextPiUid ?? "Unassigned" }]
        : []),
    ];
    if (fieldChanges.length === 0) return;

    transaction.update(targetMemberRef, {
      role: nextRole,
      status: nextStatus,
      piUid: nextPiUid,
      updatedAt: timestamp,
      updatedAtServer: now,
    });
    if (nextRole === "pi") {
      transaction.set(labRef.collection("piGroups").doc(targetUid), {
        piUid: targetUid,
        displayName: stringValue(target.displayName, targetUid),
        title: "Principal Investigator",
        createdAt: stringValue(target.joinedAt, timestamp),
        updatedAt: timestamp,
      }, { merge: true });
    }
    writeTrustedMembershipAudit(transaction, {
      labId,
      targetUid,
      actorUid: authenticated.uid,
      actor,
      timestamp: now,
      fieldChanges,
    });
  });

  return { uid: targetUid };
});

/**
 * Starts a two-person lab ownership transfer. The current owner must type the
 * target's verified email address, and the target must separately accept.
 * Keeping the former owner as a PI preserves existing PI groups and avoids
 * silently orphaning researchers during the ownership change.
 */
export const initiateLabOwnershipTransfer = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before transferring lab ownership.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before transferring lab ownership.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const targetUid = requireDocumentId(request.data?.targetUid, "targetUid");
  const confirmationEmail = requireEmail(request.data?.confirmationEmail, "confirmationEmail");
  if (targetUid === authenticated.uid) {
    throw new HttpsError("invalid-argument", "Choose a different active member as the next owner.");
  }

  const targetAccountEmail = await verifiedAccountEmail(targetUid, "The selected member");
  const labRef = database.collection("labs").doc(labId);
  const transferRef = labRef.collection("ownershipTransfers").doc();
  const stateRef = labRef.collection("ownershipTransferState").doc("current");
  const callerMemberRef = labRef.collection("members").doc(authenticated.uid);
  const targetMemberRef = labRef.collection("members").doc(targetUid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const expiresAt = new Date(now.toMillis() + OWNERSHIP_TRANSFER_TTL_HOURS * 60 * 60 * 1_000).toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  const transfer = await database.runTransaction(async (transaction) => {
    const labSnapshot = await transaction.get(labRef);
    const callerSnapshot = await transaction.get(callerMemberRef);
    const targetSnapshot = await transaction.get(targetMemberRef);
    const stateSnapshot = await transaction.get(stateRef);
    const state = asRecord(stateSnapshot.data());
    const previousTransferId = state.status === "pending" && typeof state.transferId === "string" ? state.transferId : null;
    const previousTransferSnapshot = previousTransferId
      ? await transaction.get(labRef.collection("ownershipTransfers").doc(previousTransferId))
      : null;

    if (!labSnapshot.exists) {
      throw new HttpsError("not-found", "Lab not found.");
    }
    if (activeMemberRole(callerSnapshot.data()) !== "owner") {
      throw new HttpsError("permission-denied", "Only the active lab owner can transfer ownership.");
    }
    if (!targetSnapshot.exists) {
      throw new HttpsError("not-found", "The selected lab member was not found.");
    }

    const target = asRecord(targetSnapshot.data());
    const targetRole = activeMemberRole(target);
    if (!targetRole || targetRole === "owner" || !ASSIGNABLE_MEMBER_ROLES.has(targetRole)) {
      throw new HttpsError("failed-precondition", "Choose an active member with a valid non-owner role.");
    }
    const membershipEmail = requireEmail(target.email, "Selected member membership email");
    if (membershipEmail !== targetAccountEmail) {
      throw new HttpsError("failed-precondition", "The selected member's lab email no longer matches their verified account. Update the membership record before transferring ownership.");
    }
    if (confirmationEmail !== targetAccountEmail) {
      throw new HttpsError("failed-precondition", "Type the selected member's verified email address exactly to confirm this ownership transfer.");
    }

    if (previousTransferSnapshot?.exists) {
      const previousTransfer = asRecord(previousTransferSnapshot.data());
      if (previousTransfer.status === "pending" && isValidFutureDate(previousTransfer.expiresAt, now.toMillis())) {
        throw new HttpsError("failed-precondition", "A lab ownership transfer is already awaiting acceptance. Cancel it or wait for it to expire.");
      }
      if (previousTransfer.status === "pending") {
        const staleTargetUid = stringValue(previousTransfer.targetUid, "unknown-member");
        const staleTargetName = stringValue(previousTransfer.targetName, staleTargetUid);
        transaction.update(previousTransferSnapshot.ref, {
          status: "expired",
          resolvedAt: timestamp,
          resolvedAtServer: now,
          resolvedByUid: null,
        });
        writeTrustedOwnershipTransferAudit(transaction, {
          labId,
          transferId: previousTransferSnapshot.id,
          targetUid: staleTargetUid,
          targetName: staleTargetName,
          actorUid: authenticated.uid,
          actor,
          auditKey: "expired",
          action: "Expired ownership transfer",
          summary: "An expired ownership-transfer request was closed before a new request was created.",
          timestamp: now,
          fieldChanges: [{ field: "Transfer status", before: "pending", after: "expired" }],
        });
      }
    }

    const targetName = stringValue(target.displayName, targetUid);
    const record = {
      id: transferRef.id,
      status: "pending",
      initiatedByUid: authenticated.uid,
      initiatedByName: actor,
      targetUid,
      targetName,
      createdAt: timestamp,
      expiresAt,
      resolvedAt: null,
      resolvedByUid: null,
    };

    transaction.create(transferRef, record);
    transaction.set(stateRef, {
      transferId: transferRef.id,
      status: "pending",
      initiatedByUid: authenticated.uid,
      targetUid,
      expiresAt,
      updatedAt: timestamp,
      updatedAtServer: now,
    });
    writeTrustedOwnershipTransferAudit(transaction, {
      labId,
      transferId: transferRef.id,
      targetUid,
      targetName,
      actorUid: authenticated.uid,
      actor,
      auditKey: "initiated",
      action: "Initiated ownership transfer",
      summary: "The current owner requested a two-person ownership transfer. No permissions change until the recipient accepts.",
      timestamp: now,
      fieldChanges: [
        { field: "Transfer status", before: "Empty", after: "pending" },
        { field: "Proposed owner", before: "Empty", after: targetName },
      ],
    });
    return record;
  });

  return { transfer };
});

export const acceptLabOwnershipTransfer = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before accepting lab ownership.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before accepting lab ownership.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const transferId = requireDocumentId(request.data?.transferId, "transferId");
  requireConfirmation(request.data?.confirmation, "ACCEPT", "accept this ownership transfer");
  const targetAccountEmail = await verifiedAccountEmail(authenticated.uid, "Your account");
  const labRef = database.collection("labs").doc(labId);
  const transferRef = labRef.collection("ownershipTransfers").doc(transferId);
  const stateRef = labRef.collection("ownershipTransferState").doc("current");
  const targetMemberRef = labRef.collection("members").doc(authenticated.uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  const outcome = await database.runTransaction(async (transaction) => {
    const labSnapshot = await transaction.get(labRef);
    const transferSnapshot = await transaction.get(transferRef);
    const stateSnapshot = await transaction.get(stateRef);
    const targetSnapshot = await transaction.get(targetMemberRef);
    const transfer = asRecord(transferSnapshot.data());
    const originalOwnerUid = stringValue(transfer.initiatedByUid);
    const originalOwnerRef = originalOwnerUid ? labRef.collection("members").doc(originalOwnerUid) : null;
    const originalOwnerSnapshot = originalOwnerRef ? await transaction.get(originalOwnerRef) : null;

    if (!labSnapshot.exists) return "not-found";
    if (!transferSnapshot.exists) return "not-found";
    if (transfer.targetUid !== authenticated.uid) return "not-recipient";
    if (transfer.status !== "pending") return "not-pending";
    if (!targetSnapshot.exists || !activeMemberRole(targetSnapshot.data())) return "target-ineligible";
    if (!originalOwnerSnapshot?.exists || activeMemberRole(originalOwnerSnapshot.data()) !== "owner") return "owner-changed";

    const state = asRecord(stateSnapshot.data());
    if (state.status !== "pending" || state.transferId !== transferId) return "not-current";

    if (!isValidFutureDate(transfer.expiresAt, now.toMillis())) {
      const targetName = stringValue(transfer.targetName, authenticated.uid);
      transaction.update(transferRef, {
        status: "expired",
        resolvedAt: timestamp,
        resolvedAtServer: now,
        resolvedByUid: null,
      });
      transaction.set(stateRef, {
        transferId,
        status: "expired",
        updatedAt: timestamp,
        updatedAtServer: now,
      }, { merge: true });
      writeTrustedOwnershipTransferAudit(transaction, {
        labId,
        transferId,
        targetUid: authenticated.uid,
        targetName,
        actorUid: authenticated.uid,
        actor,
        auditKey: "expired",
        action: "Expired ownership transfer",
        summary: "The ownership-transfer request expired before the proposed owner accepted it.",
        timestamp: now,
        fieldChanges: [{ field: "Transfer status", before: "pending", after: "expired" }],
      });
      return "expired";
    }

    const target = asRecord(targetSnapshot.data());
    const targetRole = activeMemberRole(target);
    if (!targetRole || targetRole === "owner" || !ASSIGNABLE_MEMBER_ROLES.has(targetRole)) return "target-ineligible";
    if (requireEmail(target.email, "Your membership email") !== targetAccountEmail) return "target-email-mismatch";

    const originalOwner = asRecord(originalOwnerSnapshot.data());
    const originalOwnerName = stringValue(originalOwner.displayName, originalOwnerUid);
    const targetName = stringValue(target.displayName, authenticated.uid);
    transaction.update(originalOwnerRef!, {
      role: "pi",
      status: "active",
      piUid: originalOwnerUid,
      updatedAt: timestamp,
      updatedAtServer: now,
    });
    transaction.update(targetMemberRef, {
      role: "owner",
      status: "active",
      piUid: authenticated.uid,
      updatedAt: timestamp,
      updatedAtServer: now,
    });
    transaction.set(labRef.collection("piGroups").doc(originalOwnerUid), {
      piUid: originalOwnerUid,
      displayName: originalOwnerName,
      title: "Principal Investigator",
      createdAt: stringValue(originalOwner.joinedAt, timestamp),
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set(labRef.collection("piGroups").doc(authenticated.uid), {
      piUid: authenticated.uid,
      displayName: targetName,
      title: "Principal Investigator",
      createdAt: stringValue(target.joinedAt, timestamp),
      updatedAt: timestamp,
    }, { merge: true });
    transaction.update(transferRef, {
      status: "accepted",
      resolvedAt: timestamp,
      resolvedAtServer: now,
      resolvedByUid: authenticated.uid,
    });
    transaction.set(stateRef, {
      transferId,
      status: "accepted",
      updatedAt: timestamp,
      updatedAtServer: now,
    }, { merge: true });
    writeTrustedOwnershipTransferAudit(transaction, {
      labId,
      transferId,
      targetUid: authenticated.uid,
      targetName,
      actorUid: authenticated.uid,
      actor,
      auditKey: "accepted",
      action: "Accepted ownership transfer",
      summary: "The proposed owner accepted. Ownership moved through a trusted transaction while the former owner retained PI access.",
      timestamp: now,
      fieldChanges: [
        { field: "Lab owner", before: originalOwnerName, after: targetName },
        { field: "Former owner role", before: "owner", after: "pi" },
        { field: "Transfer status", before: "pending", after: "accepted" },
      ],
    });
    return "accepted";
  });

  if (outcome === "expired") {
    throw new HttpsError("failed-precondition", "This ownership-transfer request has expired.");
  }
  if (outcome === "not-found") {
    throw new HttpsError("not-found", "Ownership-transfer request not found.");
  }
  if (outcome === "not-recipient") {
    throw new HttpsError("permission-denied", "Only the proposed owner can accept this ownership transfer.");
  }
  if (outcome === "target-email-mismatch") {
    throw new HttpsError("failed-precondition", "Your membership email no longer matches your verified account. Ask the current owner to cancel and reissue the transfer after it is corrected.");
  }
  if (outcome === "target-ineligible") {
    throw new HttpsError("failed-precondition", "You must remain an active, non-owner lab member to accept this ownership transfer.");
  }
  if (outcome === "owner-changed" || outcome === "not-current" || outcome === "not-pending") {
    throw new HttpsError("failed-precondition", "This ownership-transfer request is no longer active.");
  }

  return { transferId };
});

export const cancelLabOwnershipTransfer = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before canceling a lab ownership transfer.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before canceling a lab ownership transfer.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const transferId = requireDocumentId(request.data?.transferId, "transferId");
  requireConfirmation(request.data?.confirmation, "CANCEL", "cancel this ownership transfer");
  const labRef = database.collection("labs").doc(labId);
  const transferRef = labRef.collection("ownershipTransfers").doc(transferId);
  const stateRef = labRef.collection("ownershipTransferState").doc("current");
  const callerMemberRef = labRef.collection("members").doc(authenticated.uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  const outcome = await database.runTransaction(async (transaction) => {
    const transferSnapshot = await transaction.get(transferRef);
    const stateSnapshot = await transaction.get(stateRef);
    const callerSnapshot = await transaction.get(callerMemberRef);
    if (!transferSnapshot.exists) return "not-found";
    const transfer = asRecord(transferSnapshot.data());
    if (transfer.initiatedByUid !== authenticated.uid || activeMemberRole(callerSnapshot.data()) !== "owner") return "not-owner";
    if (transfer.status !== "pending") return "not-pending";
    const state = asRecord(stateSnapshot.data());
    if (state.status !== "pending" || state.transferId !== transferId) return "not-current";

    const targetUid = stringValue(transfer.targetUid, "unknown-member");
    const targetName = stringValue(transfer.targetName, targetUid);
    transaction.update(transferRef, {
      status: "canceled",
      resolvedAt: timestamp,
      resolvedAtServer: now,
      resolvedByUid: authenticated.uid,
    });
    transaction.set(stateRef, {
      transferId,
      status: "canceled",
      updatedAt: timestamp,
      updatedAtServer: now,
    }, { merge: true });
    writeTrustedOwnershipTransferAudit(transaction, {
      labId,
      transferId,
      targetUid,
      targetName,
      actorUid: authenticated.uid,
      actor,
      auditKey: "canceled",
      action: "Canceled ownership transfer",
      summary: "The current owner canceled the pending ownership-transfer request before any permissions changed.",
      timestamp: now,
      fieldChanges: [{ field: "Transfer status", before: "pending", after: "canceled" }],
    });
    return "canceled";
  });

  if (outcome === "not-found") throw new HttpsError("not-found", "Ownership-transfer request not found.");
  if (outcome === "not-owner") throw new HttpsError("permission-denied", "Only the current owner who initiated this transfer can cancel it.");
  if (outcome === "not-pending" || outcome === "not-current") {
    throw new HttpsError("failed-precondition", "This ownership-transfer request is no longer active.");
  }
  return { transferId };
});

export const declineLabOwnershipTransfer = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before declining lab ownership.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before declining lab ownership.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const transferId = requireDocumentId(request.data?.transferId, "transferId");
  requireConfirmation(request.data?.confirmation, "DECLINE", "decline this ownership transfer");
  const labRef = database.collection("labs").doc(labId);
  const transferRef = labRef.collection("ownershipTransfers").doc(transferId);
  const stateRef = labRef.collection("ownershipTransferState").doc("current");
  const callerMemberRef = labRef.collection("members").doc(authenticated.uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  const outcome = await database.runTransaction(async (transaction) => {
    const transferSnapshot = await transaction.get(transferRef);
    const stateSnapshot = await transaction.get(stateRef);
    const callerSnapshot = await transaction.get(callerMemberRef);
    if (!transferSnapshot.exists) return "not-found";
    const transfer = asRecord(transferSnapshot.data());
    if (transfer.targetUid !== authenticated.uid || !activeMemberRole(callerSnapshot.data())) return "not-recipient";
    if (transfer.status !== "pending") return "not-pending";
    const state = asRecord(stateSnapshot.data());
    if (state.status !== "pending" || state.transferId !== transferId) return "not-current";

    const targetName = stringValue(transfer.targetName, authenticated.uid);
    transaction.update(transferRef, {
      status: "declined",
      resolvedAt: timestamp,
      resolvedAtServer: now,
      resolvedByUid: authenticated.uid,
    });
    transaction.set(stateRef, {
      transferId,
      status: "declined",
      updatedAt: timestamp,
      updatedAtServer: now,
    }, { merge: true });
    writeTrustedOwnershipTransferAudit(transaction, {
      labId,
      transferId,
      targetUid: authenticated.uid,
      targetName,
      actorUid: authenticated.uid,
      actor,
      auditKey: "declined",
      action: "Declined ownership transfer",
      summary: "The proposed owner declined the pending ownership-transfer request. No permissions changed.",
      timestamp: now,
      fieldChanges: [{ field: "Transfer status", before: "pending", after: "declined" }],
    });
    return "declined";
  });

  if (outcome === "not-found") throw new HttpsError("not-found", "Ownership-transfer request not found.");
  if (outcome === "not-recipient") throw new HttpsError("permission-denied", "Only the proposed owner can decline this ownership transfer.");
  if (outcome === "not-pending" || outcome === "not-current") {
    throw new HttpsError("failed-precondition", "This ownership-transfer request is no longer active.");
  }
  return { transferId };
});

export const acceptLabInvite = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before accepting an invite.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify the invited email address before accepting this invite.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const inviteId = requireDocumentId(request.data?.inviteId, "inviteId");
  const token = requireInviteToken(request.data?.token);
  const email = requireEmail(authenticated.token.email, "Authenticated account email");
  const uid = authenticated.uid;
  const labRef = database.collection("labs").doc(labId);
  const inviteRef = labRef.collection("invites").doc(inviteId);
  const secretRef = labRef.collection("inviteSecrets").doc(inviteId);
  const userRef = database.collection("users").doc(uid);
  const memberRef = labRef.collection("members").doc(uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, uid);

  const account = await database.runTransaction(async (transaction) => {
    const labSnapshot = await transaction.get(labRef);
    const inviteSnapshot = await transaction.get(inviteRef);
    const secretSnapshot = await transaction.get(secretRef);
    const userSnapshot = await transaction.get(userRef);
    const memberSnapshot = await transaction.get(memberRef);

    if (!labSnapshot.exists) {
      throw new HttpsError("not-found", "Invited lab was not found.");
    }
    if (!inviteSnapshot.exists || !secretSnapshot.exists) {
      throw new HttpsError("not-found", "Invite link was not found.");
    }
    if (memberSnapshot.exists) {
      throw new HttpsError("already-exists", "This account is already a member of the invited lab.");
    }

    const invite = asRecord(inviteSnapshot.data());
    const secret = asRecord(secretSnapshot.data());
    if (invite.status !== "pending" || !isValidFutureDate(invite.expiresAt, now.toMillis())) {
      throw new HttpsError("failed-precondition", "This invite has expired, was canceled, or has already been used.");
    }
    if (stringValue(invite.email).toLowerCase() !== email || !inviteTokenMatches(token, secret.tokenHash)) {
      throw new HttpsError("permission-denied", "This invite is invalid or belongs to a different email address.");
    }

    const role = requireInviteRole(invite.role);
    const piUid = role === "researcher" ? requireDocumentId(invite.piUid, "invite PI") : role === "pi" ? uid : null;
    if (role === "researcher" && piUid) {
      const piSnapshot = await transaction.get(labRef.collection("members").doc(piUid));
      const piRole = activeMemberRole(piSnapshot.data());
      if (!piRole || !["owner", "pi"].includes(piRole)) {
        throw new HttpsError("failed-precondition", "The assigned PI is no longer active. Ask the lab owner to reissue the invite.");
      }
    }

    const existingProfile = asRecord(userSnapshot.data());
    const displayName = stringValue(authenticated.token.name, stringValue(invite.displayName, email.split("@")[0]));
    const photoURL = stringValue(authenticated.token.picture, stringValue(existingProfile.photoURL)) || null;
    const profile = {
      uid,
      email,
      displayName,
      photoURL,
      defaultLabId: labId,
      createdAt: stringValue(existingProfile.createdAt, timestamp),
      updatedAt: timestamp,
    };
    const member = {
      uid,
      email,
      displayName,
      photoURL,
      role,
      status: "active",
      piUid,
      inviteId,
      joinedAt: timestamp,
      updatedAt: timestamp,
    };
    const labData = asRecord(labSnapshot.data());
    const lab = {
      id: labId,
      name: stringValue(labData.name, "Lab"),
      institution: stringValue(labData.institution),
      createdByUid: stringValue(labData.createdByUid),
      createdAt: stringValue(labData.createdAt),
      updatedAt: stringValue(labData.updatedAt),
    };

    transaction.set(userRef, profile, { merge: true });
    transaction.create(memberRef, member);
    if (role === "pi") {
      transaction.set(labRef.collection("piGroups").doc(uid), {
        piUid: uid,
        displayName,
        title: "Principal Investigator",
        inviteId,
        createdAt: timestamp,
      });
    }
    transaction.update(inviteRef, {
      status: "accepted",
      acceptedByUid: uid,
      acceptedAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.delete(secretRef);
    writeTrustedInviteAudit(transaction, {
      labId,
      auditId: `invite-${inviteId}-accepted`,
      actorUid: uid,
      actor,
      action: "Accepted lab invite",
      inviteId,
      timestamp: now,
    });

    return { profile, lab, member };
  });

  return account;
});

export const requestExperimentReview = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) throw new HttpsError("unauthenticated", "Sign in before requesting review.");
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before requesting independent review.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const experimentId = requireDocumentId(request.data?.experimentId, "experimentId");
  const reviewerUid = requireDocumentId(request.data?.reviewerUid, "reviewerUid");
  const comment = reviewComment(request.data?.comment);
  const dueDate = reviewDueDate(request.data?.reviewDueDate);
  const labRef = database.collection("labs").doc(labId);
  const experimentRef = labRef.collection("experiments").doc(experimentId);
  const requesterMemberRef = labRef.collection("members").doc(authenticated.uid);
  const reviewerMemberRef = labRef.collection("members").doc(reviewerUid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  await database.runTransaction(async (transaction) => {
    const requesterSnapshot = await transaction.get(requesterMemberRef);
    const reviewerSnapshot = await transaction.get(reviewerMemberRef);
    const experimentSnapshot = await transaction.get(experimentRef);
    const requesterRole = activeMemberRole(requesterSnapshot.data());
    const reviewerRole = activeMemberRole(reviewerSnapshot.data());

    if (!requesterRole || !["owner", "admin", "pi", "researcher"].includes(requesterRole)) {
      throw new HttpsError("permission-denied", "Your lab role cannot request review.");
    }
    if (!reviewerRole || !["owner", "admin", "pi"].includes(reviewerRole)) {
      throw new HttpsError("failed-precondition", "Choose an active owner, admin, or PI as reviewer.");
    }
    if (!experimentSnapshot.exists) throw new HttpsError("not-found", "Experiment not found.");

    const experiment = asRecord(experimentSnapshot.data());
    if (experiment.locked === true) throw new HttpsError("failed-precondition", "Signed experiments cannot be sent for review.");
    if (experiment.ownerUid !== authenticated.uid) {
      throw new HttpsError("permission-denied", "Only the experiment owner can request independent review.");
    }
    if (reviewerUid === authenticated.uid || reviewerUid === experiment.ownerUid) {
      throw new HttpsError("failed-precondition", "The experiment owner cannot review their own record.");
    }
    if (["requested", "approved"].includes(stringValue(experiment.reviewStatus))) {
      throw new HttpsError("failed-precondition", "This experiment already has an active review. Reject it before editing and resubmitting.");
    }

    const reviewer = asRecord(reviewerSnapshot.data());
    const reviewEvents = Array.isArray(experiment.reviewEvents) ? experiment.reviewEvents : [];
    if (reviewEvents.length >= MAX_REVIEW_EVENTS) {
      throw new HttpsError("failed-precondition", "This experiment has reached the maximum retained review history. Create an amendment for additional review cycles.");
    }
    const reviewerName = stringValue(reviewer.displayName, reviewerUid);
    const fieldChanges = [
      { field: "Status", before: text(experiment.status), after: "review" },
      { field: "Review status", before: text(experiment.reviewStatus), after: "requested" },
      { field: "Reviewer", before: text(experiment.reviewAssignedToName), after: reviewerName },
      { field: "Due date", before: text(experiment.reviewDueDate), after: dueDate ?? "Empty" },
      { field: "Review note", before: "Redacted", after: comment ? "Provided" : "Empty" },
    ];
    const provenance = reviewTransition(experiment, {
      actor,
      actorUid: authenticated.uid,
      action: "Requested independent review",
      timestamp: now,
      fieldChanges,
    });

    transaction.update(experimentRef, {
      status: "review",
      reviewStatus: "requested",
      reviewRequestedAt: timestamp,
      reviewRequestedBy: actor,
      reviewRequestedByUid: authenticated.uid,
      reviewDecisionAt: null,
      reviewDecisionBy: null,
      reviewDecisionByUid: null,
      reviewAssignedToUid: reviewerUid,
      reviewAssignedToName: reviewerName,
      reviewDueDate: dueDate,
      reviewComment: comment || null,
      reviewEvents: [
        ...reviewEvents,
        {
          id: `review-${now.toMillis()}-${authenticated.uid.slice(0, 8)}-requested`,
          kind: "requested",
          actorUid: authenticated.uid,
          actorName: actor,
          reviewerUid,
          reviewerName,
          comment: comment || null,
          dueDate,
          occurredAt: timestamp,
        },
      ],
      ...provenance,
    });
    writeTrustedReviewAudit(transaction, {
      labId,
      experimentId,
      actorUid: authenticated.uid,
      actor,
      action: "Requested independent review",
      targetLabel: stringValue(experiment.name, experimentId),
      timestamp: now,
      fieldChanges,
    });
  });

  return { experimentId, reviewStatus: "requested" };
});

export const decideExperimentReview = onCall({ enforceAppCheck, consumeAppCheckToken: true }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) throw new HttpsError("unauthenticated", "Sign in before deciding a review.");
  if (request.app?.alreadyConsumed) {
    throw new HttpsError("aborted", "This review confirmation was already used. Reauthenticate to get a fresh confirmation token.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before recording an independent review decision.");
  }
  const authTime = typeof authenticated.token.auth_time === "number" ? authenticated.token.auth_time : 0;
  if (authTime <= 0 || Math.floor(Date.now() / 1000) - authTime > MAX_SIGNATURE_AUTH_AGE_SECONDS) {
    throw new HttpsError("failed-precondition", "Reauthenticate before recording an independent review decision.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const experimentId = requireDocumentId(request.data?.experimentId, "experimentId");
  const decision = request.data?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    throw new HttpsError("invalid-argument", "decision must be approved or rejected.");
  }
  const comment = reviewComment(request.data?.comment);
  if (decision === "rejected" && !comment) {
    throw new HttpsError("invalid-argument", "A rejection reason is required.");
  }

  const labRef = database.collection("labs").doc(labId);
  const experimentRef = labRef.collection("experiments").doc(experimentId);
  const reviewerMemberRef = labRef.collection("members").doc(authenticated.uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, authenticated.uid);

  await database.runTransaction(async (transaction) => {
    const reviewerSnapshot = await transaction.get(reviewerMemberRef);
    const experimentSnapshot = await transaction.get(experimentRef);
    const reviewerRole = activeMemberRole(reviewerSnapshot.data());
    if (!reviewerRole || !["owner", "admin", "pi"].includes(reviewerRole)) {
      throw new HttpsError("permission-denied", "Your lab role cannot decide an independent review.");
    }
    if (!experimentSnapshot.exists) throw new HttpsError("not-found", "Experiment not found.");

    const experiment = asRecord(experimentSnapshot.data());
    if (experiment.locked === true) throw new HttpsError("failed-precondition", "Signed experiments cannot be reviewed again.");
    if (experiment.reviewStatus !== "requested" || experiment.reviewAssignedToUid !== authenticated.uid) {
      throw new HttpsError("permission-denied", "You are not the assigned reviewer for this experiment.");
    }
    if (experiment.ownerUid === authenticated.uid) {
      throw new HttpsError("permission-denied", "An experiment owner cannot review their own record.");
    }

    const approved = decision === "approved";
    const reviewEvents = Array.isArray(experiment.reviewEvents) ? experiment.reviewEvents : [];
    if (reviewEvents.length >= MAX_REVIEW_EVENTS) {
      throw new HttpsError("failed-precondition", "This experiment has reached the maximum retained review history. Create an amendment for additional review cycles.");
    }
    const reviewer = asRecord(reviewerSnapshot.data());
    const reviewerName = stringValue(reviewer.displayName, actor);
    const decisionComment = comment || (approved ? "Approved for signature." : null);
    const fieldChanges = [
      { field: "Review status", before: "requested", after: decision },
      { field: "Status", before: text(experiment.status), after: approved ? "review" : "active" },
      { field: "Reviewer decision", before: "Empty", after: actor },
      { field: "Review note", before: "Redacted", after: comment ? "Provided" : "Empty" },
    ];
    const provenance = reviewTransition(experiment, {
      actor,
      actorUid: authenticated.uid,
      action: approved ? "Approved independent review" : "Rejected independent review",
      timestamp: now,
      fieldChanges,
    });

    transaction.update(experimentRef, {
      status: approved ? "review" : "active",
      reviewStatus: decision,
      reviewDecisionAt: timestamp,
      reviewDecisionBy: actor,
      reviewDecisionByUid: authenticated.uid,
      reviewComment: decisionComment,
      reviewEvents: [
        ...reviewEvents,
        {
          id: `review-${now.toMillis()}-${authenticated.uid.slice(0, 8)}-${decision}`,
          kind: decision,
          actorUid: authenticated.uid,
          actorName: actor,
          reviewerUid: authenticated.uid,
          reviewerName,
          comment: decisionComment,
          dueDate: typeof experiment.reviewDueDate === "string" ? experiment.reviewDueDate : null,
          occurredAt: timestamp,
        },
      ],
      ...provenance,
    });
    writeTrustedReviewAudit(transaction, {
      labId,
      experimentId,
      actorUid: authenticated.uid,
      actor,
      action: approved ? "Approved independent review" : "Rejected independent review",
      targetLabel: stringValue(experiment.name, experimentId),
      timestamp: now,
      fieldChanges,
    });
  });

  return { experimentId, reviewStatus: decision };
});

export const finalizeAttachment = onCall({ enforceAppCheck }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before finalizing an attachment.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before finalizing an attachment.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const experimentId = requireDocumentId(request.data?.experimentId, "experimentId");
  const attachmentId = requireDocumentId(request.data?.attachmentId, "attachmentId");
  const fileName = requireAttachmentFileName(request.data?.fileName);
  const protocolStepId = request.data?.protocolStepId ? requireDocumentId(request.data.protocolStepId, "protocolStepId") : null;
  const uid = authenticated.uid;
  const storagePath = `labs/${labId}/experiments/${experimentId}/${attachmentId}`;
  const objectFile = storage.bucket().file(storagePath);
  const [objectExists] = await objectFile.exists();
  if (!objectExists) {
    throw new HttpsError("not-found", "Uploaded attachment object was not found.");
  }

  const [metadata] = await objectFile.getMetadata();
  const objectSize = Number(metadata.size);
  const contentType = stringValue(metadata.contentType).toLowerCase();
  const objectGeneration = stringValue(metadata.generation);
  const customMetadata = metadata.metadata ?? {};
  if (!Number.isInteger(objectSize) || objectSize <= 0 || objectSize >= MAX_ATTACHMENT_BYTES) {
    throw new HttpsError("failed-precondition", "Attachment exceeds the permitted size limit.");
  }
  if (!permittedAttachmentContentType(contentType)) {
    throw new HttpsError("failed-precondition", "Attachment content type is not permitted.");
  }
  if (!objectGeneration) {
    throw new HttpsError("failed-precondition", "Attachment object generation is missing.");
  }
  if (
    customMetadata.labId !== labId
    || customMetadata.experimentId !== experimentId
    || customMetadata.attachmentId !== attachmentId
    || customMetadata.uploaderUid !== uid
  ) {
    throw new HttpsError("permission-denied", "Attachment object metadata does not match this authenticated upload.");
  }

  // The Storage rules make the object immutable before this point, so this
  // digest and generation are stable evidence for the metadata record.
  const [content] = await objectFile.download();
  const sha256 = createHash("sha256").update(content).digest("hex");
  const labRef = database.collection("labs").doc(labId);
  const experimentRef = labRef.collection("experiments").doc(experimentId);
  const attachmentRef = labRef.collection("attachments").doc(attachmentId);
  const memberRef = labRef.collection("members").doc(uid);
  const now = Timestamp.now();
  const timestamp = now.toDate().toISOString();
  const actor = stringValue(authenticated.token.name, uid);
  const record = {
    id: attachmentId,
    experimentId,
    protocolStepId,
    fileName,
    contentType,
    size: objectSize,
    storagePath,
    generation: objectGeneration,
    sha256,
    state: "finalized",
    uploadedBy: actor,
    uploadedByUid: uid,
    uploadedAt: timestamp,
    finalizedAt: timestamp,
    finalizedAtServer: now,
  };

  const attachment = await database.runTransaction(async (transaction) => {
    const memberSnapshot = await transaction.get(memberRef);
    const experimentSnapshot = await transaction.get(experimentRef);
    const attachmentSnapshot = await transaction.get(attachmentRef);
    const role = activeMemberRole(memberSnapshot.data());

    if (!role || !["owner", "admin", "pi", "researcher"].includes(role)) {
      throw new HttpsError("permission-denied", "Your lab role cannot finalize attachments.");
    }
    if (!experimentSnapshot.exists) {
      throw new HttpsError("not-found", "Experiment not found.");
    }
    if (attachmentSnapshot.exists) {
      const existing = asRecord(attachmentSnapshot.data());
      const isSameFinalization = existing.id === attachmentId
        && existing.experimentId === experimentId
        && existing.storagePath === storagePath
        && existing.generation === objectGeneration
        && existing.sha256 === sha256
        && existing.state === "finalized"
        && existing.uploadedByUid === uid;
      if (isSameFinalization) return existing;
      throw new HttpsError("already-exists", "This attachment ID is already finalized with different evidence metadata.");
    }

    const experiment = asRecord(experimentSnapshot.data());
    const canEdit = role === "owner"
      || role === "admin"
      || experiment.ownerUid === uid
      || (role === "pi" && experiment.piUid === uid);
    if (!canEdit || experiment.locked === true) {
      throw new HttpsError("permission-denied", "This attachment cannot be added to the selected experiment.");
    }
    if (!["none", "rejected", "amendment"].includes(stringValue(experiment.reviewStatus))) {
      throw new HttpsError("failed-precondition", "Attachments cannot be added while independent review is in progress. Request changes or create an amendment first.");
    }
    if (
      protocolStepId
      && (!Array.isArray(experiment.protocol)
        || !experiment.protocol.some((step) => step && typeof step === "object" && !Array.isArray(step) && (step as RecordData).id === protocolStepId))
    ) {
      throw new HttpsError("failed-precondition", "The selected protocol step does not belong to this experiment.");
    }

    const attachmentIds = Array.isArray(experiment.attachmentIds) ? experiment.attachmentIds.filter((id): id is string => typeof id === "string") : [];
    if (attachmentIds.includes(attachmentId)) {
      throw new HttpsError("already-exists", "This attachment is already linked to the experiment.");
    }
    if (attachmentIds.length >= 200) {
      throw new HttpsError("failed-precondition", "An experiment cannot contain more than 200 finalized attachments.");
    }

    const revisionNumber = typeof experiment.revisionNumber === "number" ? experiment.revisionNumber + 1 : 1;
    const versionNumber = typeof experiment.versionNumber === "number" ? experiment.versionNumber : 1;
    const history = Array.isArray(experiment.history) ? experiment.history : [];
    const versions = Array.isArray(experiment.versions) ? experiment.versions : [];

    transaction.create(attachmentRef, record);
    transaction.update(experimentRef, {
      attachmentIds: [...attachmentIds, attachmentId],
      history: [
        ...history,
        {
          id: `history-${now.toMillis()}-${attachmentId.slice(0, 12)}`,
          actor,
          actorUid: uid,
          action: "Finalized immutable attachment",
          timestamp,
          timestampIso: timestamp,
          source: "trusted-server",
        },
      ],
      versions: [
        ...versions,
        {
          id: `version-${now.toMillis()}-${attachmentId.slice(0, 12)}`,
          versionNumber,
          revisionNumber,
          label: `v${versionNumber}.${revisionNumber}`,
          action: "Finalized immutable attachment",
          createdBy: actor,
          createdByUid: uid,
          createdAt: timestamp,
          snapshotSummary: "Server recorded immutable attachment metadata and SHA-256.",
          fieldChanges: [
            { field: "Attachment count", before: String(attachmentIds.length), after: String(attachmentIds.length + 1) },
            { field: "Attachment", before: "Empty", after: fileName },
          ],
        },
      ],
      revisionNumber,
      modified: "Just now",
      modifiedAt: timestamp,
      modifiedAtServer: now,
    });
    writeTrustedAttachmentAudit(transaction, {
      labId,
      attachmentId,
      experimentId,
      actorUid: uid,
      actor,
      fileName,
      size: objectSize,
      timestamp: now,
    });

    return record;
  });

  return { attachment };
});

export const signExperiment = onCall({ enforceAppCheck, consumeAppCheckToken: true }, async (request) => {
  const authenticated = request.auth;
  if (!authenticated) {
    throw new HttpsError("unauthenticated", "Sign in before signing an experiment.");
  }
  if (request.app?.alreadyConsumed) {
    throw new HttpsError("aborted", "This signature confirmation was already used. Reauthenticate to get a fresh confirmation token.");
  }
  if (authenticated.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before creating an electronic signature.");
  }

  const labId = requireDocumentId(request.data?.labId, "labId");
  const experimentId = requireDocumentId(request.data?.experimentId, "experimentId");
  const meaning = requireString(request.data?.meaning, "meaning");
  const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
  const uid = authenticated.uid;

  if (comment.length > 2_000) {
    throw new HttpsError("invalid-argument", "Signature comments must be 2,000 characters or fewer.");
  }

  if (meaning !== "author") {
    throw new HttpsError("permission-denied", "Only author signatures are available until the independent review workflow is enabled.");
  }

  const authTime = typeof authenticated.token.auth_time === "number" ? authenticated.token.auth_time : 0;
  if (authTime <= 0 || Math.floor(Date.now() / 1000) - authTime > MAX_SIGNATURE_AUTH_AGE_SECONDS) {
    throw new HttpsError("failed-precondition", "Reauthenticate before creating an electronic signature.");
  }

  const labRef = database.collection("labs").doc(labId);
  const experimentRef = labRef.collection("experiments").doc(experimentId);
  const memberRef = labRef.collection("members").doc(uid);

  const result = await database.runTransaction(async (transaction) => {
    const [memberSnapshot, experimentSnapshot, inventorySnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(experimentRef),
      transaction.get(labRef.collection("inventoryItems")),
    ]);
    const role = activeMemberRole(memberSnapshot.data());
    if (!role || !["owner", "admin", "pi", "researcher"].includes(role)) {
      throw new HttpsError("permission-denied", "Your lab role cannot sign experiments.");
    }
    if (!experimentSnapshot.exists) {
      throw new HttpsError("not-found", "Experiment not found.");
    }

    const experiment = asRecord(experimentSnapshot.data());
    if (experiment.locked === true) {
      throw new HttpsError("failed-precondition", "This experiment is already signed and locked.");
    }
    if (experiment.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "Only the experiment owner can add an author signature.");
    }
    if (
      experiment.reviewStatus !== "approved"
      || typeof experiment.reviewAssignedToUid !== "string"
      || typeof experiment.reviewDecisionByUid !== "string"
      || experiment.reviewAssignedToUid === uid
      || experiment.reviewDecisionByUid === uid
      || experiment.reviewAssignedToUid !== experiment.reviewDecisionByUid
    ) {
      throw new HttpsError("failed-precondition", "An approved independent review is required before signing.");
    }

    const attachmentIds = Array.isArray(experiment.attachmentIds) ? experiment.attachmentIds : [];
    const validAttachmentIds = attachmentIds.filter((value): value is string => typeof value === "string" && value.length <= 128 && !value.includes("/"));
    const invalidAttachmentIds = attachmentIds.length !== validAttachmentIds.length || new Set(validAttachmentIds).size !== validAttachmentIds.length;
    const attachmentSnapshots = await Promise.all(
      validAttachmentIds.map((attachmentId) => transaction.get(database.collection("labs").doc(labId).collection("attachments").doc(attachmentId))),
    );
    const attachmentEvidence = attachmentSnapshots.map((snapshot, index) => ({
      id: validAttachmentIds[index],
      exists: snapshot.exists,
      data: asRecord(snapshot.data()),
    }));
    const attachmentIssues = invalidAttachmentIds
      ? ["Attachment references are malformed or duplicated."]
      : await finalizedAttachmentReadinessIssues(
        labId,
        experimentId,
        attachmentEvidence,
      );
    const knownLotIds = new Set<string>();
    inventorySnapshot.docs.forEach((itemSnapshot) => {
      const lots = asRecord(itemSnapshot.data()).lots;
      if (!Array.isArray(lots)) return;
      lots.forEach((lot) => {
        if (!lot || typeof lot !== "object" || Array.isArray(lot)) return;
        const id = (lot as RecordData).id;
        if (typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/")) {
          knownLotIds.add(id);
        }
      });
    });
    const issues = [...signatureReadinessIssues(experiment, knownLotIds), ...attachmentIssues];
    if (issues.length > 0) {
      throw new HttpsError("failed-precondition", issues.join(" "));
    }
    const manifestSha256 = createHash("sha256")
      .update(canonicalJson(signatureManifest(
        labId,
        experimentId,
        experiment,
        attachmentEvidence.map(({ id, data }) => ({ id, data })),
      )))
      .digest("hex");

    const now = Timestamp.now();
    const signatures = Array.isArray(experiment.signatures) ? experiment.signatures : [];
    const revisionNumber = typeof experiment.revisionNumber === "number" ? experiment.revisionNumber + 1 : 1;
    const actor = typeof authenticated.token.name === "string"
      ? authenticated.token.name
      : typeof experiment.owner === "string"
        ? experiment.owner
        : uid;
    const history = Array.isArray(experiment.history) ? experiment.history : [];
    const versions = Array.isArray(experiment.versions) ? experiment.versions : [];
    const signature = {
      id: `signature-${now.toMillis()}-${uid.slice(0, 8)}`,
      signerUid: uid,
      signerName: actor,
      meaning: "author",
      comment,
      signedAt: now.toDate().toISOString(),
      signedAtServer: now,
      manifestSha256,
    };
    const versionNumber = typeof experiment.versionNumber === "number" ? experiment.versionNumber : 1;
    const signatureFieldChanges = [
      { field: "Status", before: text(experiment.status), after: "complete" },
      { field: "Locked", before: text(experiment.locked), after: "true" },
      { field: "Signature count", before: String(signatures.length), after: String(signatures.length + 1) },
      { field: "Evidence manifest SHA-256", before: "Empty", after: manifestSha256 },
    ];
    const version = {
      id: `version-${now.toMillis()}-${uid.slice(0, 8)}`,
      versionNumber,
      revisionNumber,
      label: `v${versionNumber}.${revisionNumber}`,
      action: "Electronically signed and locked",
      createdBy: actor,
      createdByUid: uid,
      createdAt: now.toDate().toISOString(),
      snapshotSummary: "Server-authorized author signature recorded and experiment locked.",
      fieldChanges: signatureFieldChanges,
    };

    transaction.update(experimentRef, {
      status: "complete",
      reviewStatus: "signed",
      locked: true,
      lockedAt: now.toDate().toISOString(),
      lockedAtServer: now,
      lockedBy: actor,
      lockedByUid: uid,
      signatures: [...signatures, signature],
      history: [
        ...history,
        {
          id: `history-${now.toMillis()}-${uid.slice(0, 8)}`,
          actor,
          actorUid: uid,
          action: "Electronically signed and locked",
          timestamp: now.toDate().toISOString(),
          timestampIso: now.toDate().toISOString(),
          source: "trusted-server",
        },
      ],
      versions: [...versions, version],
      revisionNumber,
      modified: "Just now",
      modifiedAt: now.toDate().toISOString(),
      modifiedAtServer: now,
    });
    writeTrustedSignatureAudit(transaction, {
      labId,
      experimentId,
      signatureId: signature.id,
      actorUid: uid,
      actor,
      targetLabel: stringValue(experiment.name, experimentId),
      timestamp: now,
      fieldChanges: signatureFieldChanges,
    });

    return { revisionNumber };
  });

  return result;
});
