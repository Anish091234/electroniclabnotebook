export type LabRole = "owner" | "admin" | "pi" | "researcher" | "viewer" | "external";
export type MemberStatus = "active" | "invited" | "disabled";
export type InviteStatus = "pending" | "accepted" | "canceled";

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
  token: string;
  inviteUrl: string;
  invitedByUid: string;
  invitedByName: string;
  status: InviteStatus;
  emailQueuedAt: string | null;
  acceptedByUid?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
