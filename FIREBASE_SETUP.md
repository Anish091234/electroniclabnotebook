# Firebase Setup

## 1. Add Firebase config

Copy `.env.example` to `.env.local` and paste the web app config from Firebase Console:

```bash
cp .env.example .env.local
```

Required values:

```txt
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Restart `npm run dev` after changing `.env.local`.

## 2. Enable sign-in providers

In Firebase Console, go to Authentication > Sign-in method and enable:

- Email/Password
- Google
- Apple

Apple sign-in also requires Apple Developer configuration for your app/service ID.

## 3. Enable Firestore

Create a Cloud Firestore database. The app writes:

```txt
users/{uid}
labs/{labId}
labs/{labId}/members/{uid}
labs/{labId}/piGroups/{piUid}
labs/{labId}/invites/{inviteId}
labs/{labId}/experiments/{experimentId}
labs/{labId}/protocolTemplates/{templateId}
labs/{labId}/inventoryItems/{itemId}
labs/{labId}/sampleRecords/{sampleId}
labs/{labId}/projectRecords/{projectId}
labs/{labId}/attachments/{attachmentId}
labs/{labId}/notifications/{notificationId}
labs/{labId}/collaborationTasks/{taskId}
labs/{labId}/integrationImports/{importId}
labs/{labId}/auditEvents/{eventId}
```

`auditEvents` now act as the lab-wide change ledger. Each persisted edit stores the actor name, actor UID, stable browser/device ID, session ID, readable timestamp, Firestore server timestamp, target record, and before/after field changes when available. Experiment edits also append revision entries to the experiment's `versions` array.

On first sign-in, LabOS creates:

- a user profile
- a default lab
- an owner/PI membership for that user

## 4. User listing model

Firebase Auth is used for identity. The Team page lists application accounts from:

```txt
labs/{labId}/members
```

This is intentional: Auth knows who a user is, Firestore knows which lab they belong to and whether they are an owner, PI, admin, or researcher.

## 5. Invite delivery on Spark

Creating an invite writes:

```txt
labs/{labId}/invites/{inviteId}
```

The app generates an invite link and provides:

- Copy Link
- Email Invite, which opens the user's email client with a prefilled message

Invite links include `labId`, `inviteId`, and a one-time token. After the invited user signs in with the invited email address, LabOS creates their `members/{uid}` record, sets the invited lab as their default lab, and marks the invite as accepted.

This works on Firebase Spark because it does not use Cloud Functions or Firebase Extensions.

For automated transactional email later, install Firebase's Trigger Email extension or a Cloud Function with an SMTP provider. Those options require upgrading the Firebase project from Spark to Blaze.

## 6. File uploads

Enable Firebase Storage and publish `storage.rules`. Experiment files are uploaded to:

```txt
labs/{labId}/experiments/{experimentId}/{attachmentId}-{filename}
```

The app stores file metadata in Firestore under:

```txt
labs/{labId}/attachments/{attachmentId}
```

## 7. Publish rules

Publish both rules files before testing multi-user access:

```bash
firebase deploy --only firestore:rules,storage
```

Current rules are lab-scoped and role-aware:

- Owners/admins manage lab settings, team, and invites.
- Owners/admins/PIs manage protocol templates and inventory.
- Experiment updates are scoped to lab admins, assigned PIs, or the experiment owner for newly created records.
- Viewer and external collaborator roles are read-only for lab records.
- Samples, tasks, notifications, projects, and integration import records are lab-scoped.
- Active lab members can upload experiment attachments; admins can delete Storage files.

## 8. Competitive ELN features now scaffolded

The app now includes Spark-safe v1 surfaces for:

- Global search across lab records.
- PI review, electronic signature, signed-record locking, and amendments.
- Device-aware audit/version history for persisted edits across experiments, protocols, inventory, registry, projects, tasks, notifications, and imports.
- Structured authoring blocks, protocol notes, deviations, timers, and step attachments.
- Sample/registry records with lineage.
- Projects, notebooks, folders, and archive-ready project status.
- Notifications, collaboration tasks, PI review queue, and activity views.
- Compliance Center checks for unsigned completed records, missing objectives, missing reagent lots, expired lots, stale drafts, overdue tasks, and unresolved reviews.
- Template library and CSV/instrument import records.
