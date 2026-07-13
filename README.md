# LabOS

LabOS is a React + TypeScript electronic lab notebook backed by Firebase Authentication, Firestore, Cloud Storage, Security Rules, and trusted Cloud Functions. The product is designed around lab-scoped records, independent review, immutable finalized attachments, and a fresh-authenticated author-signing workflow.

## Start locally

Requirements: Node 22 (see [.nvmrc](.nvmrc)) and Java for the Firestore emulator test.

```bash
npm ci
npm ci --prefix functions
```

Copy `.env.example` to `.env.local`, add Firebase web configuration for a non-production project, then run:

```bash
npm run dev
```

Run the production-relevant checks before changing rules or backend code:

```bash
npm run lint
npm run build
npm run test:rules:types
npm run test:rules
npm run lint --prefix functions
npm run build --prefix functions
```

## Deploy safely

Use a separate staging Firebase project and pass the exact project ID explicitly. The repository's default Firebase alias is not an environment approval.

```bash
npm run firebase:deploy-backend -- --project <project-id>
```

That deployment includes Cloud Functions, Firestore Rules, and Storage Rules. Deploy the frontend only after it and the staging smoke test succeed.

Read these runbooks before accepting laboratory data:

- [Firebase environment setup](FIREBASE_SETUP.md)
- [Trusted backend and App Check rollout](FUNCTIONS_SETUP.md)
- [Production operations checklist](OPERATIONS.md)

## Production boundaries to understand

- App Check must be enabled in stages. Enrolling a client site key is not the same as enforcing Functions, Firestore, and Storage.
- Invite bearer tokens are issued in URL fragments and must be treated as secrets. Cancel and reissue older query-token links.
- Review decisions and author signatures require a verified email and fresh authentication. A verified active lab member can use the signed Experiment Report to rebuild and compare the evidence manifest and finalized attachment metadata; this member-only check is not regulatory certification or external notarization.
- An attachment cannot be read until trusted finalization writes matching metadata. Unfinalized uploads can still consume storage; the current implementation has no automatic orphan cleanup worker.
- New `external` invitations and role assignments are disabled until scoped sharing exists. Legacy external members have no lab-wide access; an owner must promote them to a supported role or use a separate lab.
- There are no public/external project share links. Browser-generated project share tokens are rejected by Firestore Rules; a future share capability needs a trusted, scoped, expiring backend design.
- Signing currently reads the whole inventory collection to validate reagent lots, and the Functions dependency tree has a tracked moderate upstream vulnerability chain. Both have documented production gates in [OPERATIONS.md](OPERATIONS.md).

## Design handoff materials

The original design-export references remain in [`chats/`](chats/) and [`project/`](project/). They are design source material; the running application and its production behavior live in `src/`, `functions/`, `firestore.rules`, and `storage.rules`.
