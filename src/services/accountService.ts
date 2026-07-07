import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Lab, LabInvite, LabMember, LabRole, UserProfile } from "../data/accountTypes";

function requireDb(): Firestore {
  if (!db) {
    throw new Error("Firebase is not configured. Add your Firebase values to .env.local.");
  }

  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function createInviteToken() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function cleanOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function fallbackDisplayName(user: User) {
  return user.displayName || user.email?.split("@")[0] || "New researcher";
}

function labNameFor(user: User) {
  const name = fallbackDisplayName(user);
  return `${name}'s Lab`;
}

function memberFromDoc(snapshot: QueryDocumentSnapshot): LabMember {
  return snapshot.data() as LabMember;
}

function inviteFromDoc(snapshot: QueryDocumentSnapshot): LabInvite {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<LabInvite, "id">),
  };
}

export async function ensureUserProfileAndLab(user: User): Promise<{
  profile: UserProfile;
  lab: Lab;
  member: LabMember;
}> {
  const firestore = requireDb();
  const userRef = doc(firestore, "users", user.uid);
  const userSnapshot = await getDoc(userRef);
  const timestamp = nowIso();
  const baseProfile = {
    uid: user.uid,
    email: user.email || "",
    displayName: fallbackDisplayName(user),
    photoURL: user.photoURL,
    updatedAt: timestamp,
  };

  if (userSnapshot.exists()) {
    const existingProfile = userSnapshot.data() as UserProfile;
    const profile = {
      ...existingProfile,
      ...baseProfile,
      defaultLabId: existingProfile.defaultLabId || null,
    };
    await setDoc(userRef, profile, { merge: true });

    if (profile.defaultLabId) {
      const labRef = doc(firestore, "labs", profile.defaultLabId);
      const labSnapshot = await getDoc(labRef);
      const memberRef = doc(firestore, "labs", profile.defaultLabId, "members", user.uid);
      const memberSnapshot = await getDoc(memberRef);

      if (labSnapshot.exists() && memberSnapshot.exists()) {
        return {
          profile,
          lab: { id: labSnapshot.id, ...(labSnapshot.data() as Omit<Lab, "id">) },
          member: memberSnapshot.data() as LabMember,
        };
      }
    }
  }

  const labRef = doc(collection(firestore, "labs"));
  const labId = labRef.id;
  const profile: UserProfile = {
    ...baseProfile,
    defaultLabId: labId,
    createdAt: userSnapshot.exists() ? (userSnapshot.data() as UserProfile).createdAt : timestamp,
  };
  const lab: Lab = {
    id: labId,
    name: labNameFor(user),
    institution: "",
    createdByUid: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const member: LabMember = {
    uid: user.uid,
    email: user.email || "",
    displayName: fallbackDisplayName(user),
    photoURL: user.photoURL,
    role: "owner",
    status: "active",
    piUid: user.uid,
    joinedAt: timestamp,
    updatedAt: timestamp,
  };

  await setDoc(userRef, profile);
  await setDoc(labRef, {
    ...lab,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(firestore, "labs", labId, "members", user.uid), member);
  await setDoc(doc(firestore, "labs", labId, "piGroups", user.uid), {
    piUid: user.uid,
    displayName: member.displayName,
    title: "Principal Investigator",
    createdAt: timestamp,
  });

  return { profile, lab, member };
}

export async function getActiveMembership(uid: string, labId: string) {
  const firestore = requireDb();
  const memberSnapshot = await getDoc(doc(firestore, "labs", labId, "members", uid));

  return memberSnapshot.exists() ? (memberSnapshot.data() as LabMember) : null;
}

export async function getUserLabs(uid: string) {
  const firestore = requireDb();
  const labsQuery = query(collection(firestore, "labs"), where("createdByUid", "==", uid), limit(25));
  const labsSnapshot = await getDocs(labsQuery);

  return labsSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...(snapshot.data() as Omit<Lab, "id">),
  }));
}

export function subscribeLabMembers(labId: string, onNext: (members: LabMember[]) => void, onError: (error: Error) => void) {
  const firestore = requireDb();
  const membersQuery = query(collection(firestore, "labs", labId, "members"), orderBy("displayName", "asc"));

  return onSnapshot(
    membersQuery,
    (snapshot) => {
      onNext(snapshot.docs.map(memberFromDoc));
    },
    (error) => onError(error),
  );
}

export function subscribeLabInvites(labId: string, onNext: (invites: LabInvite[]) => void, onError: (error: Error) => void) {
  const firestore = requireDb();
  const invitesQuery = query(collection(firestore, "labs", labId, "invites"), orderBy("createdAt", "desc"));

  return onSnapshot(
    invitesQuery,
    (snapshot) => {
      onNext(snapshot.docs.map(inviteFromDoc));
    },
    (error) => onError(error),
  );
}

export async function createLabInvite(input: {
  labId: string;
  labName: string;
  email: string;
  displayName: string;
  role: Exclude<LabRole, "owner">;
  piUid: string | null;
  invitedByUid: string;
  invitedByName: string;
  appOrigin: string;
}) {
  const firestore = requireDb();
  const timestamp = nowIso();
  const normalizedEmail = input.email.trim().toLowerCase();
  const inviteRef = doc(collection(firestore, "labs", input.labId, "invites"));
  const token = createInviteToken();
  const appOrigin = cleanOrigin(input.appOrigin);
  const inviteUrl = `${appOrigin}/login?invite=${encodeURIComponent(token)}&inviteId=${encodeURIComponent(inviteRef.id)}&labId=${encodeURIComponent(input.labId)}`;
  const invite: LabInvite = {
    id: inviteRef.id,
    email: normalizedEmail,
    displayName: input.displayName.trim() || normalizedEmail.split("@")[0],
    role: input.role,
    piUid: input.role === "researcher" ? input.piUid : null,
    token,
    inviteUrl,
    invitedByUid: input.invitedByUid,
    invitedByName: input.invitedByName,
    status: "pending",
    emailQueuedAt: null,
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await setDoc(inviteRef, invite);
  return invite;
}

export async function cancelLabInvite(labId: string, inviteId: string) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "labs", labId, "invites", inviteId), {
    status: "canceled",
    updatedAt: nowIso(),
  });
}

export async function acceptLabInvite(
  user: User,
  input: {
    labId: string;
    inviteId: string;
    token: string;
  },
): Promise<{
  profile: UserProfile;
  lab: Lab;
  member: LabMember;
}> {
  const firestore = requireDb();
  const timestamp = nowIso();
  const normalizedEmail = (user.email || "").trim().toLowerCase();
  const inviteRef = doc(firestore, "labs", input.labId, "invites", input.inviteId);
  const inviteSnapshot = await getDoc(inviteRef);

  if (!inviteSnapshot.exists()) {
    throw new Error("Invite link was not found.");
  }

  const invite = { id: inviteSnapshot.id, ...(inviteSnapshot.data() as Omit<LabInvite, "id">) };
  if (invite.status !== "pending" || invite.token !== input.token || invite.email !== normalizedEmail) {
    throw new Error("Invite link is invalid or has already been used.");
  }

  const labRef = doc(firestore, "labs", input.labId);
  const labSnapshot = await getDoc(labRef);
  if (!labSnapshot.exists()) {
    throw new Error("Invited lab was not found.");
  }

  const userRef = doc(firestore, "users", user.uid);
  const userSnapshot = await getDoc(userRef);
  const displayName = user.displayName || invite.displayName || normalizedEmail.split("@")[0] || "New researcher";
  const profile: UserProfile = {
    uid: user.uid,
    email: normalizedEmail,
    displayName,
    photoURL: user.photoURL,
    defaultLabId: input.labId,
    createdAt: userSnapshot.exists() ? (userSnapshot.data() as UserProfile).createdAt : timestamp,
    updatedAt: timestamp,
  };
  const member: LabMember = {
    uid: user.uid,
    email: normalizedEmail,
    displayName,
    photoURL: user.photoURL,
    role: invite.role,
    status: "active",
    piUid: invite.role === "researcher" ? invite.piUid : invite.role === "pi" ? user.uid : null,
    inviteId: invite.id,
    joinedAt: timestamp,
    updatedAt: timestamp,
  };
  const lab = { id: labSnapshot.id, ...(labSnapshot.data() as Omit<Lab, "id">) };

  await setDoc(userRef, profile, { merge: true });
  await setDoc(doc(firestore, "labs", input.labId, "members", user.uid), member);

  if (member.role === "pi") {
    await setDoc(doc(firestore, "labs", input.labId, "piGroups", user.uid), {
      piUid: user.uid,
      displayName: member.displayName,
      title: "Principal Investigator",
      inviteId: invite.id,
      createdAt: timestamp,
    });
  }

  await updateDoc(inviteRef, {
    status: "accepted",
    acceptedByUid: user.uid,
    acceptedAt: timestamp,
    updatedAt: timestamp,
  });

  return { profile, lab, member };
}

export async function addLabMember(input: {
  labId: string;
  uid: string;
  email: string;
  displayName: string;
  role: LabRole;
  piUid: string | null;
}) {
  const firestore = requireDb();
  const timestamp = nowIso();
  const member: LabMember = {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    photoURL: null,
    role: input.role,
    status: "active",
    piUid: input.piUid,
    joinedAt: timestamp,
    updatedAt: timestamp,
  };

  await setDoc(doc(firestore, "labs", input.labId, "members", input.uid), member);

  if (input.role === "pi" || input.role === "owner") {
    await setDoc(doc(firestore, "labs", input.labId, "piGroups", input.uid), {
      piUid: input.uid,
      displayName: input.displayName,
      title: "Principal Investigator",
      createdAt: timestamp,
    });
  }
}

export async function updateLabMember(
  labId: string,
  uid: string,
  patch: Partial<Pick<LabMember, "role" | "status" | "piUid" | "displayName">>,
) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "labs", labId, "members", uid), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function setDefaultLab(uid: string, labId: string) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "users", uid), {
    defaultLabId: labId,
    updatedAt: nowIso(),
  });
}
