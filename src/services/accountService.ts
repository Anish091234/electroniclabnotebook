import type { User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import type {
  CreatedLabInvite,
  Lab,
  LabInvite,
  LabMember,
  LabOwnershipTransfer,
  LabRole,
  UserProfile,
} from "../data/accountTypes";

function requireDb(): Firestore {
  if (!db) {
    throw new Error("Firebase is not configured. Add your Firebase values to .env.local.");
  }

  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function requireFunctions() {
  if (!functions) {
    throw new Error("Firebase is not configured. Add your Firebase values to .env.local.");
  }

  return functions;
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

function ownershipTransferFromDoc(snapshot: QueryDocumentSnapshot): LabOwnershipTransfer {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<LabOwnershipTransfer, "id">),
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
  await setDoc(labRef, lab);
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

/**
 * Pending transfers are visible only to their initiating and proposed owner.
 * Two simple equality queries avoid a composite index and keep Firestore rules
 * able to prove that every returned record belongs to the signed-in member.
 */
export function subscribeLabOwnershipTransfers(
  labId: string,
  uid: string,
  onNext: (transfers: LabOwnershipTransfer[]) => void,
  onError: (error: Error) => void,
) {
  const firestore = requireDb();
  const transfers = collection(firestore, "labs", labId, "ownershipTransfers");
  let initiated: LabOwnershipTransfer[] = [];
  let targeted: LabOwnershipTransfer[] = [];

  const emit = () => {
    const byId = new Map<string, LabOwnershipTransfer>();
    [...initiated, ...targeted].forEach((transfer) => byId.set(transfer.id, transfer));
    onNext([...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  };

  const unsubscribeInitiated = onSnapshot(
    query(transfers, where("initiatedByUid", "==", uid)),
    (snapshot) => {
      initiated = snapshot.docs.map(ownershipTransferFromDoc);
      emit();
    },
    (error) => onError(error),
  );
  const unsubscribeTargeted = onSnapshot(
    query(transfers, where("targetUid", "==", uid)),
    (snapshot) => {
      targeted = snapshot.docs.map(ownershipTransferFromDoc);
      emit();
    },
    (error) => onError(error),
  );

  return () => {
    unsubscribeInitiated();
    unsubscribeTargeted();
  };
}

export async function createLabInvite(input: {
  labId: string;
  email: string;
  displayName: string;
  role: Exclude<LabRole, "owner">;
  piUid: string | null;
}): Promise<CreatedLabInvite> {
  const callable = httpsCallable<typeof input, CreatedLabInvite>(requireFunctions(), "createLabInvite");
  const result = await callable(input);
  return result.data;
}

export async function cancelLabInvite(labId: string, inviteId: string) {
  const callable = httpsCallable<{ labId: string; inviteId: string }, { inviteId: string }>(requireFunctions(), "cancelLabInvite");
  await callable({ labId, inviteId });
}

export async function acceptLabInvite(
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
  const callable = httpsCallable<typeof input, { profile: UserProfile; lab: Lab; member: LabMember }>(requireFunctions(), "acceptLabInvite");
  const result = await callable(input);
  return result.data;
}

export async function updateLabMember(
  labId: string,
  uid: string,
  patch: Partial<Pick<LabMember, "role" | "status" | "piUid" | "displayName">>,
) {
  const allowedPatch: Partial<Pick<LabMember, "role" | "status" | "piUid">> = {
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.piUid !== undefined ? { piUid: patch.piUid } : {}),
  };
  const callable = httpsCallable<
    { labId: string; uid: string; patch: Partial<Pick<LabMember, "role" | "status" | "piUid">> },
    { uid: string }
  >(requireFunctions(), "updateLabMember");
  await callable({ labId, uid, patch: allowedPatch });
}

export async function initiateLabOwnershipTransfer(input: {
  labId: string;
  targetUid: string;
  confirmationEmail: string;
}): Promise<LabOwnershipTransfer> {
  const callable = httpsCallable<typeof input, { transfer: LabOwnershipTransfer }>(requireFunctions(), "initiateLabOwnershipTransfer");
  const result = await callable(input);
  return result.data.transfer;
}

export async function acceptLabOwnershipTransfer(labId: string, transferId: string) {
  const callable = httpsCallable<{ labId: string; transferId: string; confirmation: "ACCEPT" }, { transferId: string }>(
    requireFunctions(),
    "acceptLabOwnershipTransfer",
  );
  await callable({ labId, transferId, confirmation: "ACCEPT" });
}

export async function cancelLabOwnershipTransfer(labId: string, transferId: string) {
  const callable = httpsCallable<{ labId: string; transferId: string; confirmation: "CANCEL" }, { transferId: string }>(
    requireFunctions(),
    "cancelLabOwnershipTransfer",
  );
  await callable({ labId, transferId, confirmation: "CANCEL" });
}

export async function declineLabOwnershipTransfer(labId: string, transferId: string) {
  const callable = httpsCallable<{ labId: string; transferId: string; confirmation: "DECLINE" }, { transferId: string }>(
    requireFunctions(),
    "declineLabOwnershipTransfer",
  );
  await callable({ labId, transferId, confirmation: "DECLINE" });
}

export async function setDefaultLab(uid: string, labId: string) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "users", uid), {
    defaultLabId: labId,
    updatedAt: nowIso(),
  });
}
