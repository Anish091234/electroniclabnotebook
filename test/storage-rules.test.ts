import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";

// Keep Storage and Firestore on the same emulator project because these
// Storage Rules authorize requests with Firestore membership/attachment reads.
const PROJECT_ID = "labos-security-test";
const LAB_ID = "lab-alpha";
const EXPERIMENT_ID = "EXP-1";
const ATTACHMENT_ID = "attachment-evidence-001";
const BUCKET_URL = `gs://${PROJECT_ID}.appspot.com`;

let testEnv: RulesTestEnvironment;

function attachmentPath(attachmentId = ATTACHMENT_ID) {
  return `labs/${LAB_ID}/experiments/${EXPERIMENT_ID}/${attachmentId}`;
}

function member(uid: string, role: string) {
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    photoURL: null,
    role,
    status: "active",
    piUid: null,
    joinedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function uploadMetadata(uid: string, attachmentId = ATTACHMENT_ID) {
  return {
    contentType: "text/plain",
    customMetadata: {
      labId: LAB_ID,
      experimentId: EXPERIMENT_ID,
      attachmentId,
      uploaderUid: uid,
    },
  };
}

async function seedLab(members: Array<{ uid: string; role: string }>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "labs", LAB_ID), {
      name: "Storage Security Lab",
      createdByUid: "owner",
      createdAt: "2026-07-13T00:00:00.000Z",
    });
    await Promise.all([
      ...members.map(({ uid, role }) => setDoc(doc(database, "labs", LAB_ID, "members", uid), member(uid, role))),
      setDoc(doc(database, "labs", LAB_ID, "experiments", EXPERIMENT_ID), {
        id: EXPERIMENT_ID,
        ownerUid: "researcher",
        piUid: null,
        locked: false,
        reviewStatus: "none",
      }),
    ]);
  });
}

async function seedFinalizedAttachment() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "labs", LAB_ID, "attachments", ATTACHMENT_ID), {
      id: ATTACHMENT_ID,
      experimentId: EXPERIMENT_ID,
      storagePath: attachmentPath(),
      state: "finalized",
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await readFile("firestore.rules", "utf8"),
    },
    storage: {
      rules: await readFile("storage.rules", "utf8"),
    },
  });
});

afterEach(async () => {
  await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Cloud Storage attachment authorization", () => {
  it("keeps an uploaded object unreadable before trusted finalization", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const storage = testEnv.authenticatedContext("researcher").storage(BUCKET_URL);
    const file = ref(storage, attachmentPath());

    await assertSucceeds(uploadBytes(file, new Uint8Array([1, 2, 3]), uploadMetadata("researcher")));
    await assertFails(getMetadata(file));
  });

  it("allows evidence bytes after trusted finalization records matching metadata", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const storage = testEnv.authenticatedContext("researcher").storage(BUCKET_URL);
    const file = ref(storage, attachmentPath());

    await assertSucceeds(uploadBytes(file, new Uint8Array([1, 2, 3]), uploadMetadata("researcher")));
    await seedFinalizedAttachment();
    // Storage Rules evaluates the trusted Firestore marker through a separate
    // emulator service. Give that cross-service view a moment to observe the
    // server-written marker, then use a fresh SDK context for the new read.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const finalizedStorage = testEnv.authenticatedContext("researcher").storage(BUCKET_URL);
    await assertSucceeds(getMetadata(ref(finalizedStorage, attachmentPath())));
  });

  it("requires canonical metadata and an editable authorized experiment to upload", async () => {
    await seedLab([
      { uid: "researcher", role: "researcher" },
      { uid: "viewer", role: "viewer" },
    ]);
    const researcherStorage = testEnv.authenticatedContext("researcher").storage(BUCKET_URL);
    const viewerStorage = testEnv.authenticatedContext("viewer").storage(BUCKET_URL);

    await assertFails(uploadBytes(
      ref(researcherStorage, attachmentPath("attachment-invalid-metadata")),
      new Uint8Array([1]),
      { contentType: "text/plain", customMetadata: { labId: LAB_ID } },
    ));
    await assertFails(uploadBytes(
      ref(viewerStorage, attachmentPath("attachment-viewer-denied")),
      new Uint8Array([1]),
      uploadMetadata("viewer", "attachment-viewer-denied"),
    ));
  });

  it("makes evidence bytes append-only after a permitted upload", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const storage = testEnv.authenticatedContext("researcher").storage(BUCKET_URL);
    const file = ref(storage, attachmentPath());

    await assertSucceeds(uploadBytes(file, new Uint8Array([1, 2, 3]), uploadMetadata("researcher")));
    await assertFails(uploadBytes(file, new Uint8Array([4, 5, 6]), uploadMetadata("researcher")));
    await assertFails(deleteObject(file));
  });
});
