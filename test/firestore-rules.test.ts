import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

const PROJECT_ID = "labos-security-test";
const LAB_ID = "lab-alpha";

let testEnv: RulesTestEnvironment;

function member(uid: string, role: string) {
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    photoURL: null,
    role,
    status: "active",
    piUid: role === "pi" || role === "owner" ? uid : null,
    joinedAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function experiment(ownerUid: string, id = "EXP-1") {
  return {
    id,
    name: "Secure experiment",
    project: "General",
    projectId: null,
    notebook: "General Notebook",
    status: "draft",
    modified: "Just now",
    modifiedAt: "2026-07-12T00:00:00.000Z",
    owner: ownerUid,
    ownerUid,
    ownerInitials: "OW",
    piUid: null,
    tags: [],
    archived: false,
    isFavorite: false,
    locked: false,
    lockedAt: null,
    lockedBy: null,
    reviewStatus: "none",
    versionNumber: 1,
    revisionNumber: 0,
    parentExperimentId: null,
    objective: "Verify the workflow",
    notes: "Draft notes",
    observations: "Draft observations",
    protocolTemplateId: null,
    protocolTemplateVersion: null,
    protocol: [
      {
        id: `${id}-step-1`,
        label: "Record the protocol",
        status: "pending",
        required: true,
        timerMinutes: 0,
        reagentLotId: null,
      },
    ],
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
    dueDate: null,
  };
}

function sampleRecord(ownerUid: string, id = "sample-1") {
  return {
    id,
    name: "Secure sample",
    kind: "sample",
    registryId: `REG-${id}`,
    owner: ownerUid,
    ownerUid,
    projectId: null,
    location: "Freezer A",
    status: "available",
    parentSampleId: null,
    source: "Test material",
    metadata: "Seeded test record",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function collaborationTask(createdByUid: string, id = "task-1") {
  return {
    id,
    title: "Secure task",
    description: "Seeded task",
    status: "open",
    assigneeUid: null,
    assigneeName: null,
    experimentId: null,
    dueDate: null,
    createdBy: createdByUid,
    createdByUid,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

async function seedLab(members: Array<{ uid: string; role: string }>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "labs", LAB_ID), {
      name: "Security Lab",
      institution: "Test Institute",
      createdByUid: "owner",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });

    await Promise.all(
      members.map(({ uid, role }) => setDoc(doc(database, "labs", LAB_ID, "members", uid), member(uid, role))),
    );
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
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Firestore authorization", () => {
  it("allows a researcher to create and edit their own unlocked experiment", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const database = testEnv.authenticatedContext("researcher").firestore();
    const reference = doc(database, "labs", LAB_ID, "experiments", "EXP-1");

    await assertSucceeds(setDoc(reference, experiment("researcher")));
    await assertSucceeds(setDoc(reference, { ...experiment("researcher"), objective: "Updated objective" }));
  });

  it("requires a clean server-owned review state and at least one protocol step on creation", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const database = testEnv.authenticatedContext("researcher").firestore();

    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-forged-review"), {
        ...experiment("researcher", "EXP-forged-review"),
        reviewRequestedByUid: "researcher",
      }),
    );
    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-no-protocol"), {
        ...experiment("researcher", "EXP-no-protocol"),
        protocol: [],
      }),
    );
  });

  it("allows only a signed record owner to create a linked amendment", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "experiments", "EXP-signed-parent"), {
        ...experiment("researcher", "EXP-signed-parent"),
        status: "complete",
        reviewStatus: "signed",
        locked: true,
        lockedAt: "2026-07-12T01:00:00.000Z",
        lockedBy: "researcher",
        signatures: [{ signerUid: "researcher", meaning: "author" }],
      });
    });
    const database = testEnv.authenticatedContext("researcher").firestore();
    const amendment = {
      ...experiment("researcher", "EXP-amendment"),
      reviewStatus: "amendment",
      parentExperimentId: "EXP-signed-parent",
      reviewComment: "Correct a calculation in the signed record.",
    };

    await assertSucceeds(setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-amendment"), amendment));
    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-fabricated-amendment"), {
        ...amendment,
        id: "EXP-fabricated-amendment",
        parentExperimentId: "EXP-does-not-exist",
      }),
    );
  });

  it("does not let a client introduce review provenance and accepts null backfill for legacy review UIDs", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { reviewRequestedByUid: _requestedByUid, reviewDecisionByUid: _decisionByUid, ...legacy } = experiment("researcher");
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "experiments", "EXP-1"), legacy);
    });
    const database = testEnv.authenticatedContext("researcher").firestore();
    const reference = doc(database, "labs", LAB_ID, "experiments", "EXP-1");

    await assertSucceeds(setDoc(reference, { ...experiment("researcher"), objective: "Legacy document saved safely" }));
    await assertFails(
      setDoc(reference, {
        ...experiment("researcher"),
        reviewStatus: "requested",
        reviewRequestedByUid: "researcher",
        reviewAssignedToUid: "reviewer",
      }),
    );
  });

  it("denies every direct browser attempt to lock or sign an experiment", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "experiments", "EXP-1"), experiment("researcher"));
    });

    const database = testEnv.authenticatedContext("researcher").firestore();
    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-1"), {
        ...experiment("researcher"),
        status: "complete",
        reviewStatus: "signed",
        locked: true,
        lockedAt: "2026-07-12T01:00:00.000Z",
        lockedBy: "researcher",
        signatures: [{ signerUid: "researcher", meaning: "author" }],
      }),
    );
    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-1"), {
        ...experiment("researcher"),
        lockedByUid: "researcher",
      }),
    );
  });

  it("allows only allowed members to read a restricted project", async () => {
    await seedLab([
      { uid: "allowed", role: "researcher" },
      { uid: "blocked", role: "researcher" },
    ]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "projectRecords", "private-project"), {
        id: "private-project",
        name: "Restricted project",
        description: "Private research",
        status: "active",
        visibility: "restricted",
        allowedMemberUids: ["allowed"],
        readOnlyShareEnabled: false,
        shareToken: null,
        shareCreatedAt: null,
        ownerUid: "allowed",
        ownerName: "allowed",
        notebooks: [],
        folders: [],
        tags: [],
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
    });

    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("allowed").firestore(), "labs", LAB_ID, "projectRecords", "private-project")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("blocked").firestore(), "labs", LAB_ID, "projectRecords", "private-project")));
  });

  it("blocks blanket Firestore and Storage access for external collaborators", async () => {
    await seedLab([
      { uid: "owner", role: "owner" },
      { uid: "external", role: "external" },
    ]);
    const attachmentId = "attachment-1234567890";
    const attachmentPath = `labs/${LAB_ID}/experiments/EXP-1/${attachmentId}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await Promise.all([
        setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-1"), experiment("owner")),
        setDoc(doc(database, "labs", LAB_ID, "sampleRecords", "sample-1"), sampleRecord("owner")),
        setDoc(doc(database, "labs", LAB_ID, "collaborationTasks", "task-1"), collaborationTask("owner")),
        setDoc(doc(database, "labs", LAB_ID, "attachments", attachmentId), {
          id: attachmentId,
          experimentId: "EXP-1",
          storagePath: attachmentPath,
          state: "finalized",
        }),
      ]);
      await context.storage().ref(attachmentPath).put(new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    });

    const externalDatabase = testEnv.authenticatedContext("external").firestore();
    const ownerStorage = testEnv.authenticatedContext("owner").storage();
    const externalStorage = testEnv.authenticatedContext("external").storage();

    await assertFails(getDoc(doc(externalDatabase, "labs", LAB_ID)));
    await assertFails(getDoc(doc(externalDatabase, "labs", LAB_ID, "experiments", "EXP-1")));
    await assertFails(getDoc(doc(externalDatabase, "labs", LAB_ID, "sampleRecords", "sample-1")));
    await assertFails(getDoc(doc(externalDatabase, "labs", LAB_ID, "collaborationTasks", "task-1")));
    await assertFails(getDoc(doc(externalDatabase, "labs", LAB_ID, "attachments", attachmentId)));
    await assertSucceeds(ownerStorage.ref(attachmentPath).getMetadata());
    await assertFails(externalStorage.ref(attachmentPath).getMetadata());
  });

  it("prevents researchers from changing peers' samples and tasks while preserving owned/admin edits", async () => {
    await seedLab([
      { uid: "researcher-a", role: "researcher" },
      { uid: "researcher-b", role: "researcher" },
      { uid: "admin", role: "admin" },
    ]);
    const peerSample = sampleRecord("researcher-b", "sample-peer");
    const ownSample = sampleRecord("researcher-a", "sample-own");
    const peerTask = collaborationTask("researcher-b", "task-peer");
    const ownTask = collaborationTask("researcher-a", "task-own");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await Promise.all([
        setDoc(doc(database, "labs", LAB_ID, "sampleRecords", peerSample.id), peerSample),
        setDoc(doc(database, "labs", LAB_ID, "sampleRecords", ownSample.id), ownSample),
        setDoc(doc(database, "labs", LAB_ID, "collaborationTasks", peerTask.id), peerTask),
        setDoc(doc(database, "labs", LAB_ID, "collaborationTasks", ownTask.id), ownTask),
      ]);
    });

    const researcherDatabase = testEnv.authenticatedContext("researcher-a").firestore();
    const adminDatabase = testEnv.authenticatedContext("admin").firestore();

    await assertFails(
      setDoc(doc(researcherDatabase, "labs", LAB_ID, "sampleRecords", peerSample.id), {
        ...peerSample,
        metadata: "Researcher A tried to overwrite a peer record",
      }),
    );
    await assertFails(
      setDoc(doc(researcherDatabase, "labs", LAB_ID, "collaborationTasks", peerTask.id), {
        ...peerTask,
        status: "done",
      }),
    );
    await assertSucceeds(
      setDoc(doc(researcherDatabase, "labs", LAB_ID, "sampleRecords", ownSample.id), {
        ...ownSample,
        metadata: "Researcher A updated their own record",
      }),
    );
    await assertSucceeds(
      setDoc(doc(researcherDatabase, "labs", LAB_ID, "collaborationTasks", ownTask.id), {
        ...ownTask,
        status: "in_progress",
      }),
    );
    await assertSucceeds(
      setDoc(doc(adminDatabase, "labs", LAB_ID, "sampleRecords", peerSample.id), {
        ...peerSample,
        status: "consumed",
      }),
    );
    await assertSucceeds(
      setDoc(doc(adminDatabase, "labs", LAB_ID, "collaborationTasks", peerTask.id), {
        ...peerTask,
        status: "done",
      }),
    );
  });

  it("denies client-authored audit events", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    const database = testEnv.authenticatedContext("researcher").firestore();

    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "auditEvents", "forged"), {
        id: "forged",
        action: "Signed experiment",
        actor: "researcher",
      }),
    );
  });

  it("denies direct browser writes to invitations and invite verifiers", async () => {
    await seedLab([{ uid: "admin", role: "admin" }]);
    const database = testEnv.authenticatedContext("admin").firestore();
    const invite = {
      id: "invite-1",
      email: "new-member@example.test",
      displayName: "New Member",
      role: "researcher",
      piUid: null,
      invitedByUid: "admin",
      invitedByName: "admin",
      status: "pending",
      emailQueuedAt: null,
      acceptedByUid: null,
      acceptedAt: null,
      expiresAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };

    await assertFails(setDoc(doc(database, "labs", LAB_ID, "invites", "invite-1"), invite));
    await assertFails(setDoc(doc(database, "labs", LAB_ID, "inviteSecrets", "invite-1"), { tokenHash: "forged" }));
  });

  it("denies a recipient from self-creating membership even when an invite document exists", async () => {
    await seedLab([{ uid: "owner", role: "owner" }]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "invites", "invite-1"), {
        id: "invite-1",
        email: "recipient@example.test",
        displayName: "Recipient",
        role: "admin",
        piUid: null,
        status: "pending",
        expiresAt: "2026-08-01T00:00:00.000Z",
      });
    });
    const database = testEnv.authenticatedContext("recipient", { email: "recipient@example.test", email_verified: true }).firestore();

    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "members", "recipient"), {
        ...member("recipient", "admin"),
        inviteId: "invite-1",
      }),
    );
  });

  it("denies direct attachment metadata creation and forged attachment references", async () => {
    await seedLab([{ uid: "researcher", role: "researcher" }]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "labs", LAB_ID, "experiments", "EXP-1"), experiment("researcher"));
    });
    const database = testEnv.authenticatedContext("researcher").firestore();

    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "attachments", "attachment-forged"), {
        id: "attachment-forged",
        experimentId: "EXP-1",
        storagePath: "labs/lab-alpha/experiments/EXP-1/attachment-forged",
      }),
    );
    await assertFails(
      setDoc(doc(database, "labs", LAB_ID, "experiments", "EXP-1"), {
        ...experiment("researcher"),
        attachmentIds: ["attachment-forged"],
      }),
    );
  });

  it("limits ownership-transfer visibility to the current and proposed owner and blocks browser writes", async () => {
    await seedLab([
      { uid: "owner", role: "owner" },
      { uid: "candidate", role: "admin" },
      { uid: "outsider", role: "researcher" },
    ]);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "labs", LAB_ID, "ownershipTransfers", "transfer-1"), {
        id: "transfer-1",
        status: "pending",
        initiatedByUid: "owner",
        initiatedByName: "owner",
        targetUid: "candidate",
        targetName: "candidate",
        createdAt: "2026-07-12T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:00.000Z",
        resolvedAt: null,
        resolvedByUid: null,
      });
      await setDoc(doc(database, "labs", LAB_ID, "ownershipTransferState", "current"), {
        transferId: "transfer-1",
        status: "pending",
      });
    });

    const ownerDb = testEnv.authenticatedContext("owner").firestore();
    const candidateDb = testEnv.authenticatedContext("candidate").firestore();
    const outsiderDb = testEnv.authenticatedContext("outsider").firestore();
    const transferPath = ["labs", LAB_ID, "ownershipTransfers", "transfer-1"] as const;

    await assertSucceeds(getDoc(doc(ownerDb, ...transferPath)));
    await assertSucceeds(getDoc(doc(candidateDb, ...transferPath)));
    await assertFails(getDoc(doc(outsiderDb, ...transferPath)));
    await assertSucceeds(getDocs(query(collection(ownerDb, "labs", LAB_ID, "ownershipTransfers"), where("initiatedByUid", "==", "owner"))));
    await assertSucceeds(getDocs(query(collection(candidateDb, "labs", LAB_ID, "ownershipTransfers"), where("targetUid", "==", "candidate"))));
    await assertFails(setDoc(doc(ownerDb, ...transferPath), { status: "accepted" }, { merge: true }));
    await assertFails(getDoc(doc(ownerDb, "labs", LAB_ID, "ownershipTransferState", "current")));
  });
});
