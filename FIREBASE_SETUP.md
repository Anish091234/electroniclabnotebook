# Firebase setup

Use a separate Firebase project for development, staging, and production. Do not reuse a production project for exploratory work, emulator fixtures, or browser testing.

## 1. Configure the web app

Copy `.env.example` to `.env.local` and supply the web configuration for the matching environment. Never commit `.env.local`.

```txt
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_PUBLIC_APP_URL=https://your-lab.example
VITE_FIREBASE_FUNCTIONS_REGION=us-central1
VITE_FIREBASE_APPCHECK_SITE_KEY=
```

`VITE_PUBLIC_APP_URL` is the canonical browser origin. It must exactly match the Functions environment's `PUBLIC_APP_ORIGIN`, because trusted invite links are generated only from that server-side origin. `VITE_FIREBASE_FUNCTIONS_REGION` must exactly match `FUNCTIONS_REGION` in the matching `functions/.env.<project-id>` file.

The client initializes Firebase App Check only when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set. The current implementation uses the web reCAPTCHA Enterprise provider, so register a separate site key for each environment and do not point a production bundle at a staging key.

## 2. Enroll App Check before enforcing it

App Check must be rolled out in stages. Setting a site key in the frontend does not, by itself, enforce App Check; setting enforcement before legitimate browsers are enrolled can lock out working users.

1. Register the staging web app and configure its `VITE_FIREBASE_APPCHECK_SITE_KEY`.
2. Deploy the staging frontend with the key while `ENFORCE_APP_CHECK=false` in `functions/.env.<project-id>`. Leave Firestore and Storage enforcement off while collecting metrics.
3. Verify App Check metrics and test sign-in, invite acceptance, Firestore operations, attachment upload/finalization/read/export, review decision, and signing from every supported browser and custom domain.
4. Grant the Functions runtime service account the **Firebase App Check Token Verifier** role. The current review-decision and signing functions consume limited-use tokens for replay protection.
5. Set `ENFORCE_APP_CHECK=true`, redeploy Functions, and repeat those tests in staging. Deploy the matching web release before asking users to review or sign; older browser bundles do not request the required limited-use token for those calls.
6. Repeat the Functions rollout in production. After observing verified production traffic, enforce App Check separately for Firestore and Cloud Storage in the Firebase Console, one product at a time, and re-run upload/read/export smoke tests. Monitor propagation and error rates after each change.

See [FUNCTIONS_SETUP.md](FUNCTIONS_SETUP.md) for rollback expectations and the full function-side runbook. App Check is an abuse-control layer; Firebase Authentication, Security Rules, and the trusted Functions still enforce authorization.

## 3. Configure Authentication

Enable only the providers your lab approves (Email/Password, Google, and/or Apple). Add the real application domains to Firebase Authentication's authorized domains and restrict OAuth redirect URIs accordingly.

Email/password users must verify their email before LabOS creates a lab profile or accepts an invitation. Invited users must accept with the invited, verified Firebase email. Review requests, review decisions, attachment finalization, and signing also require a verified email; review decisions and author signatures additionally require a fresh authentication session.

Configure verification-email and password-reset action domains to the production application. Test them from a non-owner account before launching a new environment.

## 4. Create Firestore and Storage

Create Firestore and a Cloud Storage bucket in the intended production region before storing data. LabOS uses these primary paths:

```txt
users/{uid}
labs/{labId}
labs/{labId}/members/{uid}
labs/{labId}/piGroups/{piUid}
labs/{labId}/invites/{inviteId}
labs/{labId}/inviteSecrets/{inviteId}       # backend only
labs/{labId}/ownershipTransfers/{transferId} # backend only mutations
labs/{labId}/experiments/{experimentId}
labs/{labId}/attachments/{attachmentId}     # backend only
labs/{labId}/auditEvents/{eventId}          # backend only
```

The other lab-scoped collection paths cover protocols, inventory, samples, projects, notifications, tasks, and imports. Client Rules deny browser writes to invite secrets, attachment metadata, ownership-transfer state, signatures, review provenance, and audit rows; do not create an admin script that bypasses those rules without an equivalent trusted audit path.

## 5. Team access, invitations, and the external role

Invitations are server-owned, one-time transactions. A trusted Function creates the invitation, stores only a SHA-256 token verifier in the backend-only `inviteSecrets` collection, returns the raw URL once to the issuer, and consumes it only for the invited verified email. Pending links cannot be recovered later from the Team page; cancel and reissue instead.

New invite URLs carry the bearer token in the URL fragment:

```txt
https://your-lab.example/login#invite=<one-time-token>&inviteId=<invite-id>&labId=<lab-id>
```

Fragments are not sent to the server, which reduces logging exposure. They are still secrets: do not put them in support tickets, analytics, error reporting, or a query parameter. Confirm email link-scanning/tracking software preserves the fragment. LabOS captures it into browser session storage and clears it from the visible URL at `/login`. Legacy query-token links are parsed only for transition compatibility; cancel and reissue them because the token may have already reached logs.

Only the lab owner can change member role, status, or PI assignment. Ownership changes use a separate two-person callable workflow: the current owner confirms the target's verified email, the target accepts independently, and the former owner becomes a PI.

### External collaboration is intentionally disabled

LabOS does not currently have a resource-scoped collaboration model. New `external` invitations and role assignments are rejected by the trusted backend, and an existing legacy `external` membership does not satisfy the active-lab access rule. An owner can promote a legacy account to a supported role after reviewing the access implications, or use a separate lab.

Restricted project records have a separate `allowedMemberUids` check, but that project setting does not propagate to experiments, attachments, audit records, or other lab data. Do not present it as a confidentiality boundary; use a separate lab until a full, consistently enforced project/resource ACL exists.

There are no public, external, or browser-generated read-only project share links in the current product. The sharing UI has been removed, and Firestore Rules require any legacy share state to remain disabled/null (`readOnlyShareEnabled: false`, no `shareToken`, and no `shareCreatedAt`); an enabled flag, token, or timestamp is rejected on project create/update. Do not recreate a bearer URL in a browser field; a future share capability must be a trusted, scoped, expiring server-side workflow with its own authorization and audit design.

## 6. Review, author signature, and evidence manifests

An experiment owner requests an independent review from an active owner, admin, or PI who is not the experiment owner. The trusted request and decision transactions append server-owned review events. Browser users cannot alter those events; after 100 retained events, create an amendment rather than pruning the history.

The assigned reviewer must have a verified email and reauthenticate immediately before approving or rejecting. The Functions check Firebase `auth_time` and reject sessions older than 15 minutes. An author signature is similarly fresh-authenticated and is accepted only after the independent review is approved. The current implementation supports the author signature, not separate reviewer/approver signatures.

Before signing, the backend requires completed, well-formed protocol steps; a known inventory reagent lot for each step; objective, notes, observations; and at least one finalized attachment. It locks the record and stores a `manifestSha256` on the signature. The SHA-256 is a canonical evidence-manifest hash over the selected record content, review history, and finalized attachment metadata (including object generation and attachment SHA-256).

An active, verified lab member can use the signed Experiment Report's `verifyExperimentIntegrity` control to rebuild the current canonical manifest and recheck finalized attachment metadata/object generations. The read-only callable returns an explicit verified/mismatch report and does not write an audit event. It is not public, notarized, or a compliance certification. Preserve the signed experiment, attachment metadata, and immutable object together for verification, restoration, and investigation. See [FUNCTIONS_SETUP.md](FUNCTIONS_SETUP.md) for the exact scope and limitations.

## 7. Attachments

New evidence objects use the canonical immutable path:

```txt
labs/{labId}/experiments/{experimentId}/{attachmentId}
```

The browser can create one permitted object only for an editable experiment. It cannot overwrite or delete it. `finalizeAttachment` validates uploader metadata, permitted content type and size, object generation, and SHA-256 before writing the Firestore attachment record and linking it to the experiment.

Storage Rules allow a lab member to read an object only after a matching attachment document has `state: "finalized"`. An uploaded object that has not finalized is deliberately invisible to every browser user, including the uploader; it can still exist in the bucket and incur cost. There is no automatic orphan-cleanup worker yet. Do not use a broad lifecycle delete rule to solve this, because finalized and unfinalized objects share a prefix. Follow the reconciliation/cleanup runbook in [FUNCTIONS_SETUP.md](FUNCTIONS_SETUP.md) or implement a staged server-side cleanup/quarantine design before scaling untrusted uploads.

Configure Storage CORS for the exact development, staging, and production origins because attachment display and ZIP export use authenticated Storage SDK blob downloads. Do not persist `getDownloadURL()` values or arbitrary URLs in Firestore.

Start with the versioned [storage.cors.example.json](storage.cors.example.json) template. Replace every placeholder origin in a reviewed copy, inspect the existing bucket configuration, apply the copy, and confirm the result:

```bash
gcloud storage buckets describe gs://<bucket-name> --format="default(cors_config)"
gcloud storage buckets update gs://<bucket-name> --cors-file=storage.cors.production.json
gcloud storage buckets describe gs://<bucket-name> --format="default(cors_config)"
```

The CORS file must contain only exact origins and the methods used by the app (`GET`, `HEAD`, `POST`, and `PUT`). It is not authorization: Storage Rules and App Check decide access. Applying a CORS file replaces the bucket CORS configuration, so merge unrelated legitimate settings first.

## 8. Deploy backend and rules

Install dependencies and deploy the trusted backend, Firestore Rules, and Storage Rules together:

```bash
npm ci
npm ci --prefix functions
npm run firebase:deploy-backend -- --project <project-id>
```

Use `npm run firebase:deploy-rules -- --project <project-id>` only for an emergency rules-only change that has been tested against the already-deployed Functions. Do not deploy by relying on the repository's current `default` Firebase alias; it is a convenience setting, not an environment approval.

## 9. Security and production boundaries

- Restrict Firebase Console, deployment, billing, bucket, and service-account access to named administrators with least privilege.
- Provision and stage-test a dedicated least-privilege Functions runtime service account before binding it in source. Do not use a broad default runtime identity as the permanent trust boundary.
- Enable Cloud Monitoring, Cloud Audit Logs, budget alerts, scheduled Firestore backups, and tested restores.
- Configure evidence retention, versioning, restore, and orphan-cleanup policy together; a retention lock can prevent later cleanup of failed uploads.
- Load-test signatures with realistic inventory volume. The current signing transaction reads the whole `inventoryItems` collection to validate lot IDs; it needs a server-maintained lot index before large inventories are production-ready.
- Re-run `npm audit --omit=dev` at the root and `npm --prefix functions audit --omit=dev` for every release. The current Functions dependency chain has an unresolved moderate `uuid`-related transitive finding; do not use `npm audit fix --force` to force the incompatible `firebase-admin@10.3.0` suggestion. See [OPERATIONS.md](OPERATIONS.md) for ownership and release requirements.
- Do not make regulated-compliance claims without a separate validation, quality, legal, and operational review.

See [FUNCTIONS_SETUP.md](FUNCTIONS_SETUP.md) and [OPERATIONS.md](OPERATIONS.md) for the complete rollout and production-operation requirements.
