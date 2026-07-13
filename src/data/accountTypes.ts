export type LabRole = "owner" | "admin" | "pi" | "researcher" | "viewer" | "external";
export type MemberStatus = "active" | "invited" | "disabled";
export type InviteStatus = "pending" | "accepted" | "canceled";
export type OwnershipTransferStatus = "pending" | "accepted" | "canceled" | "declined" | "expired";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  defaultLabId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Lab {
  id: string;
  name: string;
  institution: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabMember {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  role: LabRole;
  status: MemberStatus;
  piUid: string | null;
  inviteId?: string;
  joinedAt: string;
  updatedAt: string;
}

export interface PiGroup {
  piUid: string;
  displayName: string;
  title: string;
  createdAt: string;
}

export interface LabInvite {
  id: string;
  email: string;
  displayName: string;
  role: Exclude<LabRole, "owner">;
  piUid: string | null;
  invitedByUid: string;
  invitedByName: string;
  status: InviteStatus;
  emailQueuedAt: string | null;
  acceptedByUid?: string | null;
  acceptedAt?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A two-person ownership handoff. This record contains no token or address
 * and is readable only by its current owner and proposed owner.
 */
export interface LabOwnershipTransfer {
  id: string;
  status: OwnershipTransferStatus;
  initiatedByUid: string;
  initiatedByName: string;
  targetUid: string;
  targetName: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedByUid: string | null;
}

/**
 * The raw URL is returned once by the trusted backend. It is intentionally
 * never persisted with the invite record in Firestore.
 */
export interface CreatedLabInvite {
  invite: LabInvite;
  inviteUrl: string;
}
