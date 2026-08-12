# Production Rollback and Preflight Runbook

## Scope and boundary

This runbook is a preflight artifact, not rollout authorization. The initial
rollout excludes Cron, `deletionExecutor`, public tracking credential issuance,
and Service Report persistence. Before every mutation, capture the named
evidence read-only, stop on a mismatch, and retain the capture with the gate
record.

## Source rollback baseline

- Local Git tag: `f5d35-baseline`.
- Current source Worker configuration has no Cron declaration.
- `scheduled()` is not fetch-reachable and `deletionExecutor` is unwired.
- The source IAM role has get/list/update/create plus `datastore.databases.get`;
  it has no `datastore.entities.delete` permission.

## Future production gates

| Gate                | Required pre-mutation snapshot                                                                                                                                                                                                                                                                                                       | Authorized mutation                                                               | Verify immediately                                                         | Stop condition                                                         | Rollback                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, brands, staff | Firebase Auth providers; target UID list; `brands/*` and `staffProfiles/*` non-existence; no customer credentials                                                                                                                                                                                                                    | Enable approved email/password provider, create approved brands and profiles      | Provider state, exact IDs/brand values, client profile-write denial        | Any existing/conflicting identity or profile                           | Disable provider only if no approved live user depends on it; remove only newly created, recorded documents/users under explicit approval |
| IAM                 | Current role YAML, applied custom-role definition, IAM binding list, service-account key inventory                                                                                                                                                                                                                                   | Apply the reviewed five-permission custom role/binding only                       | Exact role permissions/binding; no delete permission                       | Role differs, unexpected binding/key, or apply response differs        | Restore captured role/binding; revoke only newly created key/binding under explicit approval                                              |
| Worker              | Current deployed version, traffic allocation, bindings/secret names, Cron trigger state                                                                                                                                                                                                                                              | Upload/deploy the approved version without traffic shift beyond the approved gate | Version ID, bindings, secret names, 100% intended traffic, Cron still none | Binding/secret/trigger/traffic mismatch                                | Shift traffic to captured previous version; do not delete version history                                                                 |
| Data backfill       | Snapshots for the approved Service Jobs `SRV-2026-0481`, `SRV-2026-0479`, `SRV-2026-0477`, `SRV-2026-0475`, `SRV-2026-0472`, `SRV-2026-0469`, and `SRV-2026-0465`; the exact legacy customer IDs selected to receive `brandIds`; complete prior document snapshots and counts; byte-for-byte protected snapshot of `BRN-2026-000001` | Approved, reviewable backfill only                                                | Per-ID before/after diff and count; prove `BRN-2026-000001` unchanged      | Missing ID, unexpected field, count mismatch, or protected record diff | Restore each captured prior document exactly; never infer a default or touch the protected record                                         |
| Firestore Rules     | Current deployed ruleset export/version and source ruleset checksum                                                                                                                                                                                                                                                                  | Deploy reviewed source rules only                                                 | Deployed ruleset/version and emulator evidence                             | Unable to capture current rules or deployed content differs            | Redeploy captured prior ruleset                                                                                                           |
| Frontend            | Current production artifact/version, deployment target, environment-variable names (not values)                                                                                                                                                                                                                                      | Deploy approved artifact only                                                     | Version/artifact, route health, backend configuration gate behavior        | Wrong artifact/configuration or staff flow error                       | Redeploy captured prior artifact/version                                                                                                  |

## Capture status at the F5d-35 baseline

- Worker version `9a8b83f2-861d-4700-9b4a-05260c4ee661` and inactive Cron are documented historical evidence; bindings should be re-read immediately before a Worker gate.
- Firestore Rules source is available locally. The currently deployed ruleset is **not** established to match source and requires a future read-only capture.
- Frontend production artifact/version is not available locally and requires future read-only capture.
- IAM source role is available locally. The currently applied production role/binding requires future read-only capture.
- Auth provider, user, brand, and staff-profile production state requires future read-only capture.
- No data backfill snapshot was taken in this phase. The seven approved Service
  Job IDs are known from source; the legacy production customer IDs must be
  identified and snapshotted read-only before any `brandIds` backfill.

## Verified F5d-36 production pre-Gate-2 evidence

- Project: `luxace-service` (number `769692662603`).
- Worker rollback target: `service-tech-files-worker` version
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic. Observed binding
  values are `ALLOWED_ORIGINS=http://localhost:5173`,
  `FIRESTORE_PROJECT_ID=luxace-service`, and
  `ATTACHMENTS_BUCKET=service-tech-attachments-prod`. The two expected
  credential secret names exist; values were neither captured nor recorded.
  There is no production Cron trigger.
- Applied IAM rollback baseline is the four-permission role state: database
  get and entity get/list/update. Entity create is not yet applied and entity
  delete is absent.
- Firebase Authentication and Hosting are uninitialized. `brands` and
  `staffProfiles` were not observed. Gate 2 must re-check their absence before
  each create-only mutation.
- The deployed Firestore Rules are old/permissive, not the reviewed source
  rules. Rules deployment remains outside Gate 2.
- Eight Service Jobs exist and lack `brandId` and both public-tracking hashes.
  `BRN-2026-000001` is protected at update time
  `2026-08-08T06:19:09.065089Z`. Seven customers exist and all lack
  `brandIds`; no customer or Service Job migration is authorized in Gate 2.
- Gate 2 may only enable Email/Password and create one approved Auth user,
  `brands/bruno-thailand`, `brands/join-lux-club`, and that user's
  `staffProfiles/{uid}` record. Each is a separately approved micro-gate.

## F5d-37 Gate 2 completion evidence

- Firebase Email/Password is enabled. The approved staff identity is
  `sacool.spizy@gmail.com` with UID `qUbRfp5Iv3drX9IEZL3DyLBvcsj2`.
- `brands/bruno-thailand` is exactly `{ code: "BRN", name: "Bruno Thailand" }`;
  `brands/join-lux-club` is exactly `{ code: "JLC", name: "Join Lux Club" }`.
- `staffProfiles/qUbRfp5Iv3drX9IEZL3DyLBvcsj2` exists with the sole field
  `{ brandId: "bruno-thailand" }`. Removing it would revoke that user's
  app-side staff allowlist authorization; Auth-user deletion is not a harmless
  rollback because the UID cannot be recreated as the same identity.
- Incident record: the first Gate-2.4 request accidentally created
  `staffProfiles/.exists=false` because PowerShell interpolated a URL
  incorrectly. It contained only `brandId: "bruno-thailand"`, was removed
  under an explicitly approved `updateTime` precondition, and was verified
  absent before the intended profile's safe retry. No residual artifact or
  protected-record change remains.
- Existing-data protection passed: the seven approved `SRV-*` documents still
  lack `brandId`; `BRN-2026-000001` remains at update time
  `2026-08-08T06:19:09.065089Z`; seven customers remain and all lack
  `brandIds`.
- Worker, applied four-permission IAM, deployed Rules, Worker config/secrets,
  inactive Cron, unwired `deletionExecutor`, and uninitialized Firebase
  Hosting are unchanged. Gate 3 IAM requires a separate approval.

## F5d-38 Gate 3 IAM completion evidence

- The existing role `projects/luxace-service/roles/firestoreRetentionSweeper`
  changed from four permissions (database get and entity get/list/update) to
  exactly five by adding only `datastore.entities.create`. No permission was
  removed and `datastore.entities.delete` remains absent.
- The existing Worker service-account binding is unchanged; no additional IAM
  binding, predefined role, service-account identity, or key was added.
- Rollback evidence is the captured prior four-permission role definition.
  Restoring it would remove entity-create capability; it requires a separate
  approved IAM mutation.
- `BRN-2026-000001` remains unmodified, without `brandId`, at update time
  `2026-08-08T06:19:09.065089Z`. The Worker remains version
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic.
- No Worker, Rules, Auth, Firestore data, R2, frontend, secret/configuration,
  Cron, or deletion-executor change occurred. Gate 4 requires separate
  approval.

## F5d-39A Gate-4 reorder and migration-preflight evidence

- Gate 4 Worker rollout is reordered and remains unapproved. The next Worker
  source carries Public Tracking containment: routes are disabled unless a
  future separately approved deployment supplies exact optional binding
  `PUBLIC_TRACKING_ENABLED=true`; default Worker configuration has no binding.
- Read-only attachment inventory found zero attachment metadata and zero live
  records for all seven approved `SRV-*` Service Jobs and protected
  `BRN-2026-000001`. No R2 inventory or mutation was required.
- Read-only customer relationship classification found six verified
  `bruno-thailand` candidates and one unclassified customer whose exact link
  includes protected `BRN-2026-000001`. Future data-backfill evidence must use
  the approved six only unless separate review resolves the unclassified case.
- No production mutation occurred. `BRN-2026-000001` remains protected; Cron
  is inactive and `deletionExecutor` is unwired.

## F5d-40/41 Gate 5 completion evidence

- Gate 5.1 applied the approved `brandId: "bruno-thailand"` backfill to
  exactly the seven approved `SRV-*` Service Jobs listed in the Data backfill
  row above, via an atomic multi-document `documents:commit` with a
  per-document `currentDocument.updateTime` precondition and a `brandId`-only
  update mask, matching the technique this row specifies.
- Gate 5.2 applied the same technique with a `brandIds`-only update mask,
  adding `brandIds: ["bruno-thailand"]` to the six verified legacy customers
  identified in the F5d-39A classification. No customer document ID or other
  PII is recorded in this runbook or in `PROJECT_STATE.md`.
- Gate 5.3 separately reviewed and then migrated the one remaining customer
  whose relationship also touched protected `BRN-2026-000001`, after
  confirming (source-verified, not assumed) that no Service Job holds a
  stored customer foreign key, so the membership grant cannot cascade into or
  reclassify `BRN-2026-000001` or any Service Job.
- `BRN-2026-000001` remains protected and unmodified: no `brandId`, update
  time still exactly `2026-08-08T06:19:09.065089Z`.
- No Worker, Rules, Auth, IAM, R2, frontend, Cron, or `deletionExecutor`
  change occurred as part of Gate 5. The Data backfill row above is complete;
  its rollback procedure (restore each captured prior document exactly,
  under a fresh post-write `updateTime` precondition, separately approved)
  remains available and untested in production.
- F5d-41 re-reviewed `firestore.rules` against this migrated state and found
  no blocking gap; the Firestore Rules gate row above remains the next,
  separate, not-yet-approved gate. The currently deployed ruleset is still
  the F5d-36 old/permissive baseline.

## F5d-42/43 Gate 6 Rules deployment evidence

- Gate 6 deployed the reviewed source `firestore.rules` (unchanged since
  F5d-41) via `firebase deploy --only firestore:rules --project
luxace-service`, producing release `projects/luxace-service/releases/
cloud.firestore`, ruleset `7538645e-5898-4238-8d2a-33be07b01209`, created
  `2026-08-12T15:10:50.208079Z`, live SHA-256
  `E300D6046623945375283605CFBE3BBDFA7F179E12554EE39803A0F50E002589`.
- The pre-Gate-6 ruleset's rollback checksum is
  `B5DAED02B5B741B1BC92E9429FCDE3BB0199D8F281D856193AD996A28C072533`. Its
  rollback artifact (prior rules source and release metadata) is retained
  under `.f5d42-firebase-config/`, which is gitignored (`.f5d*-firebase-
config/` pattern) and must never be committed; this repository records
  only the checksum and location, never its contents.
- Post-deploy read-only checks confirm: unauthenticated Service Job read
  denied, protected `BRN-2026-000001` read denied, `numberSequences` denied
  (explicit rule), `serviceJobIntakeKeys` denied (explicit rule),
  `serviceReports` denied (default-deny, no match block). `BRN-2026-000001`
  is unmodified — no `brandId`, update time still exactly
  `2026-08-08T06:19:09.065089Z`. The 7/7 Service Job and 7/7 customer Gate 5
  migration remains intact and correctly scoped under the now-live Rules.
- Authenticated approved-staff production reads were not exercised with a
  real Firebase ID token this gate (no ID-token session available) and
  remain a recorded, non-blocking acceptance check for later Worker/frontend
  QA — not a Gate 6 failure. Rules emulator coverage already proves this
  scenario (11/11 passing, F5d-41).
- No Worker, frontend, R2, Auth, or Cron change occurred as part of Gate 6.
  IAM remains the five-permission `firestoreRetentionSweeper` role with
  `datastore.entities.delete` still absent.
- Rollback for this gate, if ever needed: redeploy the ruleset matching the
  recorded pre-Gate-6 checksum from the retained `.f5d42-firebase-config/`
  artifact, per the Firestore Rules gate row above.

## F5d-45/46 Gate 7 Worker deployment evidence

- Gate 7 deployed the F5d-44-reviewed Worker source. `service-tech-files-worker`
  is live at version `e1e11e81-04d6-4cf7-bc5b-9b5f31ac26d4` (version number
  14), 100% traffic. The rollback candidate is
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` (version 11); rollback was not
  required.
- Post-deploy live smoke (unauthenticated/read-only only, matching the
  Worker gate row's "avoid durable writes" acceptance guidance): `GET
/health` → 200; unauthenticated `POST /service-jobs` → 401; unauthenticated
  file `GET` → 401; both Public Tracking routes → generic 404; allowed
  (`localhost`) CORS preflight → 204 with correct origin,
  `Authorization`/`Idempotency-Key` both allowed; disallowed origin → no
  CORS grant. All match F5d-44's expected behavior.
- Bindings/secrets/IAM/Rules/migration state all confirmed unchanged from
  the reviewed source: `FIRESTORE_PROJECT_ID`, `ALLOWED_ORIGINS`,
  `ATTACHMENTS_BUCKET` as before; secret names only, no values recorded;
  `PUBLIC_TRACKING_ENABLED` absent; no Cron trigger; no Queues;
  `deletionExecutor` unwired; IAM five-permission role with
  `datastore.entities.delete` absent; live Rules checksum
  `E300D6046623945375283605CFBE3BBDFA7F179E12554EE39803A0F50E002589`
  unchanged; 7/7 Service Jobs and 7/7 customers migration state and
  `BRN-2026-000001` protection unchanged.
- Remaining acceptance item: a real authenticated `POST /service-jobs`
  production allocation has not been executed. This is the next explicit,
  separately approved acceptance micro-gate per the Worker gate row's
  guidance that the first durable allocator write must not be folded into
  routine smoke testing.
- Rollback for this gate, if ever needed: shift 100% traffic back to
  version `9a8b83f2-861d-4700-9b4a-05260c4ee661`; do not delete version
  history, per the Worker gate row above.
- No Rules, IAM, Auth, R2, Cron, or frontend change occurred as part of
  Gate 7.

## Deferred test improvement

The Rules emulator suite covers legacy updates and hash immutability. A future
test-only improvement should explicitly attempt to add `createdAt` to a legacy
document and assert rejection. It is not a rollout change and is not part of
this phase.
