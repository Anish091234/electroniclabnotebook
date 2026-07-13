# Production operations checklist

This repository contains the LabOS web app, Firebase Security Rules, and trusted Firebase Functions. Complete and record this checklist before accepting real laboratory data. A successful frontend build is not by itself a production approval.

## Release record and environments

- Use distinct Firebase projects, web origins, App Check site keys, credentials, and data for development, staging, and production.
- Keep `.env.local`, `functions/.env.<project-id>`, service-account credentials, invitation links, and exports out of Git, CI logs, tickets, and chat.
- For every release, record the web build/version, Git revision, Firebase project ID, Functions revision, Firestore Rules version, Storage Rules version, deploy time, operator, approver, App Check state, and rollback decision.
- Deploy Functions and both Rules first:

  ```bash
  npm run firebase:deploy-backend -- --project <project-id>
  ```

  Deploy the frontend only after that command and the staging smoke test succeed. Do not rely on the repository's `default` Firebase alias as an environment approval.
- Require the following validation on the locked dependency set:

  ```bash
  npm ci
  npm ci --prefix functions
  npm run lint
  npm run build
  npm run test:rules:types
  npm run test:rules
  npm run lint --prefix functions
  npm run build --prefix functions
  npm audit --omit=dev --audit-level=high
  npm --prefix functions audit --omit=dev --audit-level=high
  ```

  The Firestore Rules test starts the emulator and requires Java locally. CI should install Java rather than silently skipping the test.
- Confirm `VITE_FIREBASE_FUNCTIONS_REGION` equals deployed `FUNCTIONS_REGION`, and `VITE_PUBLIC_APP_URL` exactly equals server-side `PUBLIC_APP_ORIGIN` before releasing invitation functionality.

## App Check: staged, measurable enforcement

App Check enforcement is a rollout, not a checkbox. It protects against abusive/unverified clients but does not replace Firebase Authentication, Security Rules, or function-side authorization.

1. Register the web app for the configured reCAPTCHA Enterprise provider in **staging** and set `VITE_FIREBASE_APPCHECK_SITE_KEY` in the staging web build.
2. Keep `ENFORCE_APP_CHECK=false` in `functions/.env.<staging-project>` and leave Firestore/Storage App Check enforcement off while observing token metrics. Test every supported browser, custom domain, and actual user flow.
3. Grant the actual Cloud Functions runtime identity the **Firebase App Check Token Verifier** IAM role. The sensitive `decideExperimentReview` and `signExperiment` callables use limited-use App Check tokens and token consumption.
4. Set `ENFORCE_APP_CHECK=true`, redeploy Functions, and test invitation acceptance, review decision, author signing, attachment upload/finalization/read/export, and ordinary Firestore traffic. The current browser code requests limited-use tokens for review decisions and signatures; do not enforce before the current frontend is deployed.
5. Repeat the verified Functions rollout in production. Observe production traffic, then enable Firebase Console enforcement for Firestore and Cloud Storage separately, one product at a time. Re-run uploads, finalizations, attachment reads, exports, and application startup after each toggle. Allow for propagation and monitor errors.
6. Keep an incident owner and rollback decision for the first enforcement window. If a legitimate client is blocked, identify the provider/site key/client version first; make a reviewed, scoped rollback only as needed and record the period the protection was weakened.

Replay protection adds latency and is a Firebase beta feature. Keep it on the two sensitive endpoints only, measure its error/latency impact, and do not make regulated-compliance claims based on it.

## Invitation and access rollout

1. Deploy the backend/rules before the frontend.
2. Cancel and reissue every invite created by the older client-side or query-token invite flow. Treat old tokens as exposed because they may appear in request logs or referrers.
3. Verify each new link has this shape:

   ```txt
   https://your-lab.example/login#invite=<one-time-token>&inviteId=<invite-id>&labId=<lab-id>
   ```

   The fragment is not transmitted to the server. It remains a bearer secret, so do not paste it into analytics, support tickets, query strings, or error reports. Test the real email-delivery/link-scanning path; a rewritten link must preserve the fragment. The app stores it in session storage and clears it from the visible URL at login.
4. Confirm verified-email gates with an unverified email/password account, a verified email/password account, and every enabled federated provider. The invited, verified email must exactly match the invite.
5. Confirm only the owner can alter member role/status/PI assignment, and no browser client can write an invite, invite secret, attachment metadata, ownership-transfer state, review provenance, signature, or audit row.
6. Test the two-person ownership transfer in staging: the current owner types the target's verified email, the target accepts separately, and the former owner becomes a PI. Verify cancel, decline, and expiry leave membership unchanged.
7. Review owner/admin membership at least quarterly and immediately after staffing changes.

### External-collaborator boundary

External collaboration is disabled until the product has a consistently enforced project/resource ACL. New `external` invitations and assignments are rejected, and a legacy `external` membership has no lab-wide access. Promote a legacy account to a supported role only after reviewing its intended access, or use a separate lab.

Restricted project records have an `allowedMemberUids` check, but that check does **not** propagate to experiments, attachments, exports, or audit data tied to the project. Create a separate lab for data that an external collaborator must not see. This is a release-blocking scoping decision, not a UI preference.

There is no public or external read-only project share URL. The related UI has been removed, and Firestore Rules reject any enabled legacy share state, non-null share token, or share timestamp on a project document. Do not attempt to restore sharing by storing a token in a project document; any future sharing feature must be a trusted, scoped, expiring backend workflow with a dedicated threat model and audit path.

## Experiment review and author-signing rollout

- Run the emulator Rules suite after every Rules change. It covers clean review-state creation, signed-parent amendments, immutable reviewer provenance, browser signature denial, and legacy null backfill for reviewer UID fields.
- New browser-created experiments must contain the complete current record shape, start unlocked with a nonempty protocol and empty review provenance, and be created only by an allowed editor. Do not use browser import scripts to create partially shaped records.
- Only an experiment owner can request review. The assigned reviewer must be a different active owner, admin, or PI. Review request/decision records are server-owned; direct Firestore writes must be denied.
- The reviewer must have a verified email and freshly reauthenticate immediately before approving or rejecting. The backend rejects an authentication session more than 15 minutes old. A rejection requires a nonempty reason.
- The author must also have a verified email and freshly reauthenticate within 15 minutes before author signing. A signature fails unless the current independent review is approved by the assigned independent reviewer.
- The current signing flow supports the **author** signature only. Do not document reviewer/approver signatures as available.
- Before staging/prod release, test: request review, reauthenticate/reject with a reason, edit/resubmit, reauthenticate/approve, reauthenticate/author-sign, then attempt an edit/upload/direct write after signing and verify it is rejected.
- Review events are append-only through trusted Functions and are not browser-writable. A record retains at most 100 review events; create an amendment from the signed parent for another review cycle rather than deleting or overwriting history.
- An amendment must identify a signed parent owned by the creator and contain a nonempty amendment reason. Test this with a real signed record before release.
- Legacy experiments that predate reviewer UID fields are treated as null for safe backfill. Validate a representative legacy save in staging; a broader migration must be an authenticated, reviewed server-side job with its own trusted audit entry.

## Evidence, attachment, and manifest controls

- Test immutable upload behavior: a permitted editor and editable experiment can create one object; viewers cannot upload; no browser user can overwrite/delete; review-requested, approved, and signed records reject new uploads. Upload metadata must contain only canonical lab ID, experiment ID, attachment ID, and uploader UID.
- An object is not browser-readable until `finalizeAttachment` writes the corresponding Firestore record with `state: "finalized"`, matching path, and generation. Test that an interrupted/malformed upload is unreadable even to its uploader, then test that it becomes readable only after successful finalization.
- `finalizeAttachment` validates permitted content type, size, uploader metadata, immutable generation, and SHA-256. At signing, the backend also verifies every linked attachment's finalized metadata and matching current object metadata. Test a missing metadata record and a metadata/object mismatch; both must block the signature.
- Configure bucket CORS from the reviewed, versioned `storage.cors.example.json` template for exact approved origins. Inspect before applying and verify after applying with `gcloud storage buckets describe`; `--cors-file` replaces the existing bucket CORS configuration. Do not use `*` in production.
- Backfill or quarantine legacy attachment records before relying on a signature: remove stored download URLs, validate the object, and write canonical path/generation/SHA-256 through a reviewed trusted migration.

### Orphan objects and retention

An unfinalized object is hidden by Storage Rules but still occupies bucket storage. The current code has **no automatic orphan-cleanup worker**, and finalized/unfinalized objects share a prefix, so a broad lifecycle delete rule is unsafe.

Before accepting untrusted instrument uploads at scale, implement and stage-test a server-side reconciliation/cleanup job or a separate ingest/quarantine prefix. Until then, run a controlled reconciliation:

1. List objects older than a conservative grace period.
2. Compare each object's canonical path and generation with its expected `labs/{labId}/attachments/{attachmentId}` record.
3. Delete only objects with no matching `state: "finalized"` record after confirming no finalization is in progress.
4. Use a privileged operational identity, record the deletion in a change/incident log, and preserve the report. Direct Storage deletes are not covered by the Firestore audit trigger.

Design lifecycle, versioning, retention locks, backups, and orphan cleanup together. A retention lock can make failed uploads permanently billable; an overly broad lifecycle rule can delete signed evidence. Test restore and deletion behavior in a non-production bucket first.

### Signed evidence manifest

At author signing, LabOS writes `manifestSha256` to the signature. It hashes canonical JSON schema version 1 over selected scientific record fields, the review fields/events, and finalized attachment metadata including each object generation and SHA-256. Preserve the signed experiment document, attachment metadata, and immutable attachment objects together.

An active lab member with a verified email can use `verifyExperimentIntegrity` from the signed Experiment Report. The read-only callable rebuilds the canonical manifest, compares it to the author signature's hash, and checks finalized Firestore attachment metadata against the current immutable Cloud Storage object generation; it returns explicit mismatch failures without mutating the record or creating audit noise. It is a member-only LabOS control, not a public endpoint, separately notarized manifest, rendered-export signature, or hash of the lab-wide audit ledger. Preserve the underlying record and evidence for controlled investigation. This integrity feature does not, by itself, satisfy 21 CFR Part 11, GLP, GxP, or similar requirements.

## Data protection, monitoring, and recovery

- Define whether PII, patient, donor, controlled, or export-controlled data may be stored before onboarding users.
- Restrict Firebase Console, deployment, billing, bucket, and service-account access to named administrators. Require MFA for owners/admins where the identity provider supports it.
- Provision a dedicated least-privilege Cloud Functions runtime identity and stage-test it before binding it in source. The default runtime identity must not be the permanent trust boundary.
- Use an HTTPS custom domain and configure CSP, `frame-ancestors`, HSTS, `X-Content-Type-Options`, and a strict referrer policy in the hosting layer.
- Review Firebase Authentication password policy, sign-in rate limits, authorized domains, verification templates, password-reset action URLs, and MFA support.
- Enable Cloud Audit Logs, Cloud Monitoring, Error Reporting, alerting for Functions failures/latency and Storage errors, and budget alerts.
- Maintain written retention, deletion, incident-response, access-review, and recovery policies.
- Configure scheduled Firestore backups and perform a restore test into a non-production project at least quarterly. Preserve linked attachment objects and metadata in the recovery plan; a Firestore-only restore does not restore bucket evidence.
- Verify the audit trigger's retry path in staging: ordinary client mutations create one event-ID-linked audit row, while invite, membership, ownership-transfer, review, attachment, and signature trusted commands create exactly one transactionally coupled audit row. Any future service-account job that changes these records must write its own trusted audit entry instead of relying on the generic trigger.

## Current scale and dependency risk register

### Inventory validation at signing

The signing transaction currently reads the full lab `inventoryItems` collection to verify all protocol reagent-lot IDs. This preserves integrity in the current model but scales poorly with inventory size: it raises read cost, latency, contention, and the chance of transaction-limit failures.

Load-test with representative inventory volume before onboarding a large lab. Do not bypass the lot check to improve latency. The planned remediation is a server-maintained, transactionally updated per-lot index so signing reads only the lots named by the protocol. Treat that work as required before a large-inventory production launch.

### Firebase/Google Cloud moderate dependency chain

At the 2026-07-12 lockfile audit, `npm --prefix functions audit --omit=dev --json` reported 9 moderate vulnerabilities and 0 high/critical vulnerabilities. The chain includes `firebase-admin@13.10.0`, Google Cloud client packages, and `uuid@9.0.1` (GHSA-w5hq-g745-h8pq).

Do not run `npm audit fix --force` to accept the audit tool's `firebase-admin@10.3.0` suggestion: it is outside `firebase-functions@7.2.5`'s supported peer range (`^11.10.0 || ^12.0.0 || ^13.0.0`). This is an unresolved upstream risk, not a clean audit. Assign an owner and review date, rerun both production audits before every release, monitor Firebase/Google Cloud advisories, and upgrade the Functions/Admin SDK pair together in staging once a compatible fix is available.

## Compliance boundary

The trusted review, fresh-authentication, immutable attachment, audit, and evidence-hash workflows improve evidence integrity but are not a certification. Before claiming support for 21 CFR Part 11, GLP, GxP, HIPAA, or any regulated workflow, complete formal validation, requirements traceability, independent review/approval controls, change control, training, audit review, privacy/security assessment, and legal/compliance review.
