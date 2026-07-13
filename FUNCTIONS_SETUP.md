# Trusted backend setup

LabOS uses Firebase Cloud Functions for every security-sensitive state transition. Do not deploy a browser build that expects these workflows until the Functions code, Firestore Rules, and Storage Rules are deployed together to the same Firebase project.

## What the trusted backend owns

- `createLabInvite`, `cancelLabInvite`, and `acceptLabInvite` create and consume one-time invitations. The raw verifier is stored only in the backend-only `inviteSecrets` collection.
- `updateLabMember` is the owner-only role, status, and PI-assignment workflow.
- `initiateLabOwnershipTransfer`, `acceptLabOwnershipTransfer`, `cancelLabOwnershipTransfer`, and `declineLabOwnershipTransfer` implement a two-person owner handoff. The current owner confirms a target's verified email; the target accepts separately; the former owner becomes a PI.
- `requestExperimentReview` locks an editable record into review, assigns an independent active owner/admin/PI reviewer, and appends a server-owned review event.
- `decideExperimentReview` records the assigned reviewer's approval or rejection. It requires a verified email, a fresh Firebase Authentication session, and a limited-use App Check token.
- `finalizeAttachment` validates an immutable Storage object, then records its canonical path, generation, content metadata, and SHA-256 before linking it to an experiment.
- `signExperiment` creates an **author** signature only after an approved independent review, a fresh reauthentication, validated finalized attachments, completed protocol steps, and valid reagent-lot references. It locks the record and records a canonical evidence-manifest SHA-256 with the signature.
- `verifyExperimentIntegrity` is a read-only, verified-email active-lab-member check surfaced from the signed Experiment Report. It rebuilds the canonical manifest, compares the signature hash, and checks finalized attachment metadata/object evidence without mutating the record or adding audit noise.
- `recordAuditEvent` retries transient failures and writes an idempotent, redacted audit record for ordinary Firestore mutations. Trusted commands write their own audit row in the same transaction, so the trigger does not duplicate them.

Browser clients cannot directly create or alter invitation secrets, membership access, ownership-transfer state, attachment metadata, review provenance, signatures, or audit events. Admin SDK code bypasses client Rules, so a future trusted job that changes one of those records must write its own transactionally coupled audit entry.

## Deployment prerequisites

1. Use a Firebase project and billing configuration that support Cloud Functions and Cloud Storage.
2. Use a distinct Firebase project for development, staging, and production. This repository's `default` alias is not an approval boundary. Pass `--project <project-id>` on every deployment until named aliases are deliberately configured and reviewed.
3. Configure the matching Functions environment file before deployment:

   ```txt
   # functions/.env.<project-id>
   FUNCTIONS_REGION=us-central1
   PUBLIC_APP_ORIGIN=https://your-lab.example
   ENFORCE_APP_CHECK=false
   ```

   `PUBLIC_APP_ORIGIN` must be an absolute HTTPS origin outside local development. `FUNCTIONS_REGION` must exactly match the frontend's `VITE_FIREBASE_FUNCTIONS_REGION`; `PUBLIC_APP_ORIGIN` must exactly match `VITE_PUBLIC_APP_URL`.
4. Install and validate the exact locked dependencies:

   ```bash
   npm ci
   npm ci --prefix functions
   npm run lint
   npm run build
   npm run test:rules:types
   npm run lint --prefix functions
   npm run build --prefix functions
   npm run test:rules
   ```

   `npm run test:rules` starts the Firestore emulator and requires Java locally. It is intentionally part of `firebase:deploy-backend`.
5. Deploy the backend and both rules files as one coordinated release:

   ```bash
   npm run firebase:deploy-backend -- --project <project-id>
   ```

   Firebase deploys individual resources rather than providing a cross-service transaction. Record the Functions revision, Firestore Rules version, Storage Rules version, operator, and time before deploying the frontend.

The source sets a conservative global Functions ceiling of 512 MiB, 60 seconds, 10 concurrent requests per instance, and 20 instances. Changing those values requires a staged load test and cost review; attachment finalization downloads and hashes the full file in memory.

## Staged App Check rollout

`ENFORCE_APP_CHECK` defaults to `false` so a project is not accidentally locked out before its web client is enrolled. Treat the following as a release gate, not as a single switch.

1. In each Firebase project, register the web app with an approved App Check provider. The current web client initializes a reCAPTCHA Enterprise provider when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set.
2. Deploy the new frontend to **staging** with that site key while `ENFORCE_APP_CHECK=false`. Keep Firestore and Storage product enforcement off during this observation period.
3. Verify App Check metrics and a real browser flow for sign-in, invitation acceptance, ordinary Firestore reads/writes, attachment upload/finalization/read/export, review request, review decision, author signature, and signed-record integrity verification. Include all production browsers and any embedded or custom-domain entry points.
4. Grant the Cloud Functions runtime service account the **Firebase App Check Token Verifier** IAM role before enabling the sensitive workflows. `decideExperimentReview` and `signExperiment` consume limited-use tokens; without this role their replay-protection path cannot be relied on.
5. Set `ENFORCE_APP_CHECK=true` in the matching `functions/.env.<project-id>` file and redeploy Functions to staging. Re-run the sensitive review/signing paths after reauthenticating. The web client already requests limited-use tokens for those two callables.
6. Once staged metrics show legitimate traffic is verified, repeat the Functions rollout in production. After an observation window, enforce App Check separately for **Cloud Firestore** and **Cloud Storage** in the Firebase Console, one product at a time, then smoke-test all reads, uploads, finalizations, and exports. Product enforcement can take time to propagate; monitor it rather than assuming the toggle is instantaneous.

App Check is an abuse-control layer, not an authorization substitute. Firestore and Storage Rules still decide which signed-in member may access data. Token consumption/replay protection adds a network round trip and is documented by Firebase as a beta capability, so keep it limited to the high-value review-decision and signing calls and monitor latency and failures.

If enforcement causes an outage, use the pre-approved incident/rollback procedure: first identify the affected product/client version, then make a reviewed rollback in the affected project. Do not leave enforcement disabled after the incident without a dated risk decision and follow-up owner.

## Invitation-link handling

New invitation URLs use a fragment, for example:

```txt
https://your-lab.example/login#invite=<one-time-token>&inviteId=<invite-id>&labId=<lab-id>
```

The fragment is not sent in the HTTP request, reducing exposure in hosting, proxy, and application access logs. On `/login`, LabOS copies the values into `sessionStorage` and immediately removes the fragment from the visible URL before an authenticated acceptance call.

The fragment is still a bearer secret. Do not paste it into tickets, chat, analytics, error reports, or query parameters. Confirm that any email-security/link-tracking service preserves the fragment; a wrapper that removes it makes the invite unusable. The raw URL is shown only once to the issuer, so pending invitations must be canceled and reissued instead of recovered. Query-string parsing remains only for legacy links; cancel and reissue all legacy invitations because their tokens may already be present in server logs or referrers.

An invitee must sign in with the invited **verified** Firebase email. Creating an account is not enough: email/password users must complete verification before acceptance, and federated accounts must have a verified email claim.

## Review, signature, and evidence integrity runbook

### Review events

- Only the experiment owner may request a review. The reviewer must be a different active owner, admin, or PI.
- Review requests and decisions are trusted transactions. They append a review event with the actor, assigned reviewer, timestamp, decision/request note, and due date; a browser cannot fabricate, rewrite, or delete this history.
- A decision requires the assigned reviewer to have a verified email and a Firebase `auth_time` no more than 15 minutes old. The reviewer must reauthenticate immediately before approving or rejecting. A rejection must include a reason.
- There is a maximum of 100 retained review events per experiment. Do not try to prune or overwrite history. Create an amendment from the signed record for an additional review cycle.

### Author signature

The current implementation supports an author signature only. It rejects a signature unless all of the following are true:

- the signer is the experiment owner with an active owner/admin/PI/researcher membership and verified email;
- an independent reviewer has approved the current record;
- the signer reauthenticated within the last 15 minutes;
- the record has an objective, notes, observations, at least one finalized raw attachment, and a nonempty protocol;
- every protocol step is well formed, complete, and names a reagent lot that exists in the lab inventory; and
- every linked attachment has finalized metadata and still matches its immutable Storage object generation, size, type, and upload metadata.

The function then locks the record, writes a trusted audit event, and stores `manifestSha256` on the signature. The hash is calculated from canonical JSON (`schemaVersion: 1`) over the selected scientific record content, review fields and review events, and each finalized attachment's metadata, object generation, and SHA-256. Preserve the signed experiment document, finalized attachment documents, and immutable Storage objects together when exporting or restoring evidence.

An active lab member with a verified email can run the read-only `verifyExperimentIntegrity` callable from a signed Experiment Report. It rebuilds the current canonical manifest, compares it to the stored signature hash, and rechecks each finalized attachment's Firestore metadata and immutable Cloud Storage object generation; it returns explicit mismatch failures without changing the record or creating an audit event. This is a member-only LabOS verification control, not a public endpoint, external timestamping/notarization service, or regulatory certification. It does not attest to a rendered PDF, ZIP export, or the lab-wide audit ledger. Preserve the signed record and evidence metadata for controlled independent verification and investigation.

## Versioned Storage CORS configuration

`storage.cors.example.json` is an intentionally non-live template. Replace every example origin with the exact scheme, host, and port used by development, staging, and production; do not use a wildcard origin for LabOS.

1. Inspect the current bucket policy first:

   ```bash
   gcloud storage buckets describe gs://<bucket-name> --format="default(cors_config)"
   ```

2. Make a reviewed production copy of `storage.cors.example.json`, keeping `GET`, `HEAD`, `POST`, and `PUT` for authenticated browser downloads and uploads. Do not include `OPTIONS`; browsers issue preflight requests automatically.
3. Apply the reviewed file:

   ```bash
   gcloud storage buckets update gs://<bucket-name> --cors-file=storage.cors.production.json
   ```

4. Describe the bucket again and smoke-test an authenticated upload, finalization, image/PDF view, direct attachment download, and ZIP export from every approved origin.

Applying `--cors-file` replaces the bucket CORS configuration, so merge legitimate pre-existing rules first. CORS enables browser interoperability only; Storage Rules and App Check remain the access controls.

## Attachment finalization and orphan cleanup

Evidence objects have the canonical immutable path:

```txt
labs/{labId}/experiments/{experimentId}/{attachmentId}
```

The client may create one allowed object for an editable experiment; it cannot overwrite or delete it. Storage Rules do **not** allow anyone to read the object until `finalizeAttachment` has written the matching Firestore attachment record with `state: "finalized"`. This prevents abandoned or malformed browser uploads from becoming lab-visible evidence, but it does not delete the bytes or prevent their storage cost.

There is no automatic orphan-cleanup worker in the current implementation. Finalized and unfinalized objects share the same canonical prefix, so a generic Cloud Storage lifecycle rule cannot safely distinguish them. Before accepting production uploads at scale, either implement and stage-test a server-side reconciliation/cleanup job (or a separate ingest/quarantine prefix) or run a documented manual reconciliation:

1. List candidate objects older than a conservative grace period.
2. Compare each candidate with `labs/{labId}/attachments/{attachmentId}` and retain it only when a matching `state: "finalized"` metadata record has the same canonical path and generation.
3. Recheck that no active finalization is in progress, then delete only confirmed orphans with a privileged operational identity.
4. Record every manual deletion in the change/incident log; the Firestore audit trigger cannot audit a direct Cloud Storage deletion.

Do not apply a bucket retention lock or broad delete lifecycle before this workflow has been tested. Those controls can make failed uploads permanently billable or, if too broad, destroy finalized evidence. Define evidence retention, versioning, backup, restore, and orphan-cleanup rules together.

## Current scale and dependency risks

### Inventory lookup during signing

For integrity, `signExperiment` currently reads the lab's entire `inventoryItems` collection inside its Firestore transaction to verify protocol reagent-lot IDs. This is correct for the present data model but does not scale linearly: a larger inventory increases latency, read cost, transaction contention, and the risk of Firestore transaction limits.

Load-test signing with representative inventory volume before onboarding large labs. Do not weaken the lot check to make signings faster. The planned scale path is a server-maintained, transactionally updated lot index (for example, one document per lot) so a signature can look up only the lots referenced by its protocol. Build and migrate that index before treating large inventory catalogs as production-ready.

### Moderate upstream dependency chain

At the 2026-07-12 lockfile review, `npm --prefix functions audit --omit=dev --json` reports 9 **moderate** vulnerabilities and no high or critical vulnerabilities. The path includes `firebase-admin@13.10.0` through Google Cloud client packages to `uuid@9.0.1` (the `uuid` advisory is GHSA-w5hq-g745-h8pq).

The audit tool's automatic suggestion is not safe to apply blindly: `firebase-functions@7.2.5` declares a peer range of `firebase-admin ^11.10.0 || ^12.0.0 || ^13.0.0`, while the suggested `firebase-admin@10.3.0` is outside that supported range. Do **not** run `npm audit fix --force` as a production remediation. Keep the lockfile, rerun both root and Functions production audits for every release, monitor Firebase/Google Cloud release notes and the advisory, and upgrade the Functions/Admin SDK pair together in staging when a compatible upstream fix exists. Production acceptance requires a named risk owner and review date while this moderate chain remains.

## Required production gates

1. Deploy the trusted backend and both rules files before the frontend that calls them.
2. Cancel and reissue every invitation created by the earlier client-side/query-token flow.
3. Require and test verified emails for owners, reviewers, signers, and invitees.
4. Complete the staged App Check rollout above and record its metrics, runtime identity, and enforcement decision.
5. Configure exact-origin Storage CORS and test the finalization/read/export path from every approved origin.
6. Test owner, admin, PI, researcher, viewer, invited-user, and legacy-external-denial flows in staging, including a reviewer reauthenticating and an author reauthenticating before signing.
7. Test an amendment from a signed record, review-history retention, attachment mismatch rejection, the signed Experiment Report's integrity-verification result, and a denied direct Firestore/Storage mutation.
8. Confirm an evidence-retention and orphan-cleanup procedure exists before allowing untrusted instrument uploads at scale.

Before accepting production data, provision a dedicated runtime service account with only the Firestore, Storage, and App Check permissions the trusted commands need, validate it in staging, then bind it in the global Functions options. Do not rely indefinitely on a broad default runtime identity.
