# Production Rollback and Preflight Runbook

## Scope and boundary

This runbook began as a preflight artifact and now retains the chronological
rollout and rollback evidence; it is not authorization for any new mutation.
The rollout excludes Cron, `deletionExecutor`, and public tracking credential
issuance. Service Report persistence is live as of F5d-66 (see that section
below); it is no longer excluded. Before every future mutation, capture the
named evidence read-only, stop on a mismatch, and retain the capture with the
gate record.

## Historical F5d-35 source rollback baseline

- Local Git tag: `f5d35-baseline`.
- Current source Worker configuration has no Cron declaration.
- `scheduled()` is not fetch-reachable and `deletionExecutor` is unwired.
- The source IAM role has get/list/update/create plus `datastore.databases.get`;
  it has no `datastore.entities.delete` permission.

## Original production gate plan (historical)

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

## F5d-60/F5d-60A production deployment and Gate 7.1 evidence

- `service-tech-files-worker` is live at F5d-60 version
  `55d9120c-af26-416b-bd68-1b3a4a3d271a`, deployment message
  `F5d-60 production rollout`, with 100% traffic. The retained rollback target
  is `5b6c1278-630f-4fed-9973-cc04b9eeb1ad`; if rollback is separately
  approved, shift traffic to that captured version without deleting version
  history.
- Gate 7.1 is **PASS**. Exactly one production Gate attempt ran after visibly
  confirming the `FIRESTORE + WORKER` runtime path. It completed without HTTP
  500 and created Service Job `BRN-2026-000002` with Service Request number
  `SR-2026-000001`.
- Post-Gate verification found `BRN-2026-000002` at update time
  `2026-08-14T08:22:42.834387Z`, exactly one `serviceJobIntakeKeys` document
  mapped to that Service Job, Bruno Thailand 2026 tracking sequence `2`, and
  Bruno Thailand 2026 `service_request` sequence `1`.
- Protected legacy Service Job `BRN-2026-000001` remained present and
  unchanged at update time `2026-08-08T06:19:09.065089Z`. The retained F5d-60
  Worker tail contained no `[ServiceJob Allocator]` diagnostics for the
  successful attempt.
- The previous failed Gate attempt produced zero durable production writes.
  Its historical canonical Firestore status was not captured;
  `ALREADY_EXISTS` remains a strong source-supported explanation only, not
  observed historical production evidence.
- No Rules, IAM, Auth, R2, Cron, or frontend mutation accompanied this Worker
  rollout or Gate verification. A production frontend rollout remains a
  separate future gate with its own preflight, authorization, verification,
  and rollback evidence.

## F5d-61 Phase 2 frontend rollout readiness (source/config only)

- Firebase Hosting is selected for the initial staff-only frontend rollout;
  the approved URL is `https://luxace-service.web.app`. Hosting source serves
  `dist` with a catch-all `/index.html` SPA rewrite.
- Production frontend configuration must resolve to Firestore plus the Worker
  and the exact approved HTTPS production Worker origin. Public tracking has
  no production URL and remains explicitly unavailable; its Worker routes,
  issuance, and rate limiting remain disabled and outside this gate.
- Before any frontend deployment, capture the empty/pre-release Hosting live
  channel, current Worker version/traffic/configuration, and current
  `ALLOWED_ORIGINS`. The Worker CORS update adding the approved frontend
  origin is a separate production mutation and must precede the Hosting
  deployment.
- The future deployment must target Hosting only. It must not include
  Firestore Rules, Functions, Auth, or any other Firebase resource. No data
  migration is required.
- The first Hosting release has no prior application release to restore.
  Preflight must therefore approve a maintenance/empty rollback artifact or
  an explicit Hosting-disable procedure before deployment, then capture the
  new Hosting release ID immediately after deployment.
- This phase makes no production change. Worker CORS and Firebase Hosting
  deployment remain pending separate operator approvals.

## F5d-62/F5d-62A production frontend rollout and rollback evidence

- `service-tech-files-worker` is live at version
  `06bc88e9-1437-4708-b68e-07f82caaf916`, deployment message
  `F5d-62 production frontend CORS rollout`, with 100% traffic.
  `ALLOWED_ORIGINS` is
  `http://localhost:5173,https://luxace-service.web.app`; the Firestore
  project and R2 bucket bindings remain `luxace-service` and
  `service-tech-attachments-prod`.
- The Worker rollback baseline for this CORS-only change is F5d-60 version
  `55d9120c-af26-416b-bd68-1b3a4a3d271a`, not the older F5d-59 rollback
  candidate. Shifting 100% traffic to F5d-60 restores localhost-only CORS
  without regressing the allocator remediation. Any rollback remains a
  separately approved production mutation.
- Firebase Hosting release
  `projects/luxace-service/sites/luxace-service/channels/live/releases/1786711638834000`
  went live at `2026-08-14T12:47:18.834Z` on finalized version
  `projects/luxace-service/sites/luxace-service/versions/ba65c4997440c3c4`.
  The approved 21-file, 1,117,909-byte user artifact has canonical manifest
  SHA-256
  `e99aa57f713e48666d1947a3eea0c6292e335de3a522f38c4a47a83d1d14bcb8`.
  The version API's 23 paths are those 21 files plus Firebase's generated
  `/__/firebase/init.js` and `/__/firebase/init.json`.
- This is the first application Hosting release, so there is no preceding
  Hosting artifact to clone or restore. If an emergency withdrawal is ever
  separately approved, the established rollback remains an explicit
  `firebase hosting:disable --site luxace-service --project luxace-service
  --force`; do not improvise a prior release that does not exist.
- The Mutation 2 pre-deploy manifest gate failed as an operational control:
  the interactive PowerShell/.NET host lacked
  `[System.IO.Path]::GetRelativePath()`, producing the invalid aggregate
  `985ef6f7c14eb51a937868583c14c178cfae907a217b82befa045b75a9a813ed`.
  Although the mismatch threw, later separately entered interactive commands
  still deployed Hosting. Classification: **A — control failure, deployed
  artifact independently proven correct**.
- No automatic rollback or redeployment was performed. Independent
  verification matched all 21 local files to the approved manifest and then
  matched all 21 decoded live bodies byte-for-byte. All approved SPA routes
  returned the same verified `index.html`, and live endpoint/config checks
  found only the approved production Worker URL with public tracking still
  unset.
- Future gates must avoid unproved `Path.GetRelativePath()` support. Use a
  resolved `dist` root, verify each file is under that root, remove the root
  prefix by substring, normalize separators to `/`, sort ordinally, and build
  the canonical lowercase-hash/two-space/path/LF manifest with a final LF.
  Run validation and deployment in one non-interactive process with
  `$ErrorActionPreference = 'Stop'`; exit non-zero on every mismatch and keep
  the deploy command unreachable until all checks pass. Never rebuild or
  modify `dist` between the final check and deployment.
- No public tracking, Auth, Rules, IAM, R2, Cron, DNS, or production-data
  mutation accompanied Hosting verification. No production write smoke test
  ran.

## F5d-63/F5d-63C Production Trust & Thai-first Hosting evidence

- Reviewed source checkpoint `a8caf3811199e6de158ab4e0251b59032c3b7f14`
  (`f5d-63`) was deployed in exactly one separately approved, Hosting-only
  attempt with zero retries. The pre-deployment gate verified the exact source,
  clean tree, 21 filenames, every byte size and SHA-256, 1,116,259 total bytes,
  and aggregate manifest SHA-256
  `5682d24b635ae2c32b4849d306836e6878b980d6e3ce2059d44d835913b98eab`
  before making the deploy command reachable.
- The live-channel release is
  `projects/luxace-service/sites/luxace-service/channels/live/releases/1786723383971000`
  (`DEPLOY`, `2026-08-14T16:03:03.971Z`) on finalized version
  `projects/luxace-service/sites/luxace-service/versions/b9e59a97e9ded5cc`.
  The version API reports the 21 approved user files plus Firebase's reserved
  `/__/firebase/init.js` and `/__/firebase/init.json`.
- All 21 decoded live user files returned HTTP 200 and matched the approved
  byte sizes and SHA-256 values. `/`, `/login`, `/dashboard`,
  `/service-jobs`, and `/service-jobs/new` returned the approved SPA shell;
  direct routes, Thai-first presentation, `FIRESTORE + WORKER`, and protected
  staff-route behavior passed read-only verification. Public Tracking remains
  unavailable with its production Worker URL unset.
- The first post-deploy read-only verifier reported a size mismatch caused by
  its manifest lookup logic. Direct diagnostic verification returned the
  expected bytes/hash, and the corrected verifier then matched all 21/21
  files. This was not an artifact defect and caused no redeployment.
- The Worker was outside deployment scope and remains deployment
  `57cf2207-af36-4af1-a77c-ca1f2d5a7c09`, version
  `06bc88e9-1437-4708-b68e-07f82caaf916`, at 100% traffic. Read-only
  verification returned `GET /health` 200 and `OPTIONS /health` 204 with
  `https://luxace-service.web.app` accepted.
- The retained Hosting rollback baseline is F5d-62 release
  `projects/luxace-service/sites/luxace-service/channels/live/releases/1786711638834000`
  and version
  `projects/luxace-service/sites/luxace-service/versions/ba65c4997440c3c4`.
  Any rollback is a separate production mutation requiring approval; do not
  alter the Worker for a Hosting-only rollback.
- F5d-63B made zero Service Job writes, attachment mutations, Worker
  mutations, or Firestore/Auth/Rules/IAM/R2 mutations.

## F5d-65 Worker and F5d-65A Hosting production evidence

- `service-tech-files-worker` is live at F5d-65 version
  `1da88d90-0131-4859-8e10-2c5546199971`, deployment message "F5d-65
  production Worker rollout", 100% traffic (confirmed via `wrangler
  deployments list`; not redeployed during this Hosting phase). The
  retained Worker rollback baseline remains F5d-62 version
  `06bc88e9-1437-4708-b68e-07f82caaf916`.
- F5d-65A deployed the reviewed source commit
  `84c0668c00c2e1907357a60eb85381be67ef4e5c` (tag `f5d-65`) to Firebase
  Hosting in exactly one separately approved, `--only hosting` attempt with
  zero retries, using the pre-existing local `dist` build with no rebuild
  between the preflight report and the deploy command.
- The live-channel release is
  `projects/luxace-service/sites/luxace-service/channels/live/releases/1786958174254000`
  (`DEPLOY`, `2026-08-17T09:16:14.254Z`) on finalized version
  `projects/luxace-service/sites/luxace-service/versions/7b540ddfdd52d38f`.
  The approved 21-file, 1,138,590-byte user artifact has canonical aggregate
  SHA-256
  `713be03e2317ed73cb347e5bc732c4f78d8c149800728c9cdf8dc6090f444db2`,
  computed by resolving the `dist` root, asserting every file falls under
  that root, stripping the root prefix, normalizing separators to `/`,
  sorting ordinally, and hashing `sha256  path\n` lines with a final
  trailing newline — the canonical method specified after F5d-62A's
  `Path.GetRelativePath()` finding, run once in a single non-interactive
  Node process.
- Post-deploy independent verification downloaded all 21 approved filenames
  directly from the live site by name (not discovered via `index.html`
  link-following, which would have missed lazily-loaded chunks) and matched
  every file's byte size and SHA-256 to the approved manifest; the
  recomputed live aggregate matched
  `713be03e2317ed73cb347e5bc732c4f78d8c149800728c9cdf8dc6090f444db2`
  exactly. `/`, `/login`, `/dashboard`, `/service-jobs`, and
  `/service-jobs/new` all returned HTTP 200 with the approved SPA shell. The
  live runtime remained `FIRESTORE + WORKER` with only the approved Worker
  origin embedded, no `localhost`/`127.0.0.1` origin, and Public Tracking's
  Worker URL absent.
- Read-only browser smoke confirmed Login renders with Thai document
  language (`lang="th"`), the route-specific Thai title/heading, one main
  landmark, and the `FIRESTORE + WORKER` runtime label; an unauthenticated
  `/dashboard` visit redirected client-side to `/login`. No credentials
  were entered and no authenticated session was fabricated; neither
  StaffShell nor an authenticated Service Jobs list/detail view was
  exercised.
- Post-deploy Worker re-verification found the Worker unchanged at version
  `1da88d90-0131-4859-8e10-2c5546199971` with 100% traffic: `GET /health`
  returned 200, the Hosting-origin CORS preflight returned 204 with
  `Access-Control-Allow-Origin: https://luxace-service.web.app` and both
  `Authorization`/`Idempotency-Key` allowed, a disallowed origin
  (`https://evil.example.com`) received a 204 with no ACAO grant, and an
  unauthenticated `POST /service-jobs` returned 401. F5d-65A made zero
  Service Job, customer, attachment, or Firestore writes and zero Worker,
  Rules, Auth, IAM, or R2 mutations.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`, and
  `.firebaserc` are byte-identical to the F5d-64 baseline (`git diff --stat
  f5d-64 HEAD` reports no change to any of the four); this rollout carried
  no infrastructure-config change.
- The retained Hosting rollback baseline is F5d-64 release
  `projects/769692662603/sites/luxace-service/channels/live/releases/1786857261574000`
  and version
  `projects/769692662603/sites/luxace-service/versions/fd13206179cf6474`.
  Any rollback is a separate production mutation requiring approval; per
  established procedure, roll back Hosting first, verify the old frontend,
  and only then consider a Worker rollback — never roll the Worker back
  while F5d-65 Hosting is live. The accepted P2 limitation (client-side/
  advisory serial-conflict checking) remains unchanged; no server-side
  enforcement or schema expansion accompanied this rollout.

## F5d-66/F5d-66A/F5d-66B Worker, Rules, and Hosting production evidence

- **Worker.** `service-tech-files-worker` is live at F5d-66 version
  `a3d5afd8-fb9a-42da-b589-3f77cb1c92ea`, deployed via `wrangler versions
  deploy a3d5afd8-fb9a-42da-b589-3f77cb1c92ea@100` (deployment message "F5d-66
  production Worker rollout") at `2026-08-17T13:41:41.282Z`, 100% traffic.
  Worker Gate 1's predeploy review found the checked-in `worker/wrangler.toml`
  did not match live production's `ALLOWED_ORIGINS` (missing
  `https://luxace-service.web.app`, added out-of-band since F5d-62) and
  correctly **blocked** rather than upload a candidate that would have
  regressed CORS if ever promoted — F5d-66A applied the single-line source fix
  (commit `a677311c7b7e5d86d6bcb6548011719e754146f4`, tag `f5d-66a`) before any
  candidate was uploaded. The retained Worker rollback baseline is F5d-65
  version `1da88d90-0131-4859-8e10-2c5546199971`.
- **Firestore Rules.** Deployed via `firebase deploy --only firestore:rules
  --project luxace-service` to release
  `projects/luxace-service/releases/cloud.firestore`, ruleset
  `projects/luxace-service/rulesets/075129c8-6dc4-46ef-9d0e-93174c8e0409`, live
  source SHA-256
  `40C4AC1E06D359506817AEC1481F3ED4A7EE01C268C0CFC5DB88B28638968226` — verified
  byte-identical to the committed `f5d-66a:firestore.rules` blob both
  immediately before and after deploy via the read-only Firebase Rules API.
  The diff (`f5d-65a..f5d-66a`) is a pure 38-line append: an explicit-allowlist
  `serviceReports` update rule (`diff().affectedKeys().hasOnly([...])`,
  identity/status/finalizedAt/snapshot excluded), and two fully-denied
  Worker-only collections, `serviceReportActiveDrafts` and
  `serviceReportDraftKeys`. `numberSequences` is byte-unchanged — no
  `repair_report` carve-out. The retained Rules rollback baseline is ruleset
  `projects/luxace-service/rulesets/7538645e-5898-4238-8d2a-33be07b01209`
  (source SHA-256
  `E300D6046623945375283605CFBE3BBDFA7F179E12554EE39803A0F50E002589`, the
  pre-F5d-66 F5d-42/43 baseline), confirmed still retained and unmutated.
- **Hosting.** The build was proven **not** byte-reproducible across
  independent rebuilds of identical frozen source (`git archive f5d-66a` +
  fresh `npm ci` + build, in isolation, without touching the frozen `dist`) —
  9 of 20 files differ in filename and byte content between separate build
  invocations, which is Rolldown/Vite chunk-hash non-determinism, not source
  drift. The single `dist` built once during Hosting Gate 1 was therefore
  locked as the only approved deployment artifact and never rebuilt before
  deploy: 20 user files, 1,134,618 bytes, canonical aggregate SHA-256
  `3ae4c26e8c513779719e6738bba24db48a4b97316fb5cc29982ec667b991222c`.
  `firebase deploy --only hosting --project luxace-service` published it in
  exactly one attempt to release
  `sites/luxace-service/channels/live/releases/1786976550427000`
  (`2026-08-17T14:22:30.427Z`) on finalized version
  `sites/luxace-service/versions/b0a3907899a67afe`. All 20 approved files were
  independently fetched by exact filename from live Hosting and matched byte
  size and SHA-256 exactly; the aggregate recomputed from the live-downloaded
  bytes matched exactly. Live `index.html` (SHA-256
  `ead637cd5d886dc695d0baf61022eb0c49dc523843cb27985fc001e0fd43b7eb`)
  references the new `assets/index-BEmCZ7Ae.js` bundle, not F5d-65's
  `assets/index-ChysXqtl.js`. The retained Hosting rollback baseline is F5d-65
  release `sites/luxace-service/channels/live/releases/1786958174254000`,
  version `sites/luxace-service/versions/7b540ddfdd52d38f`.
- **Postdeploy verification** passed at every gate: `/`, `/login`,
  `/dashboard`, `/service-jobs`, `/service-jobs/new` all 200; `/login` renders
  `lang="th"`, the Thai staff-login heading, one main landmark, and
  `FIRESTORE + WORKER`; unauthenticated `/dashboard` redirects client-side to
  `/login`; `GET /health` 200; Hosting-origin CORS on both new Service Report
  routes 204 with exact `Access-Control-Allow-Origin` and
  `Authorization`/`Idempotency-Key` both allowed; a disallowed origin received
  no ACAO grant; unauthenticated `POST` to create-draft, finalize, and
  `/service-jobs` all 401; unauthenticated Firestore REST reads of
  `serviceReports`, `serviceReportActiveDrafts`, and `serviceReportDraftKeys`
  all 403 `PERMISSION_DENIED`. Live runtime configuration embeds only the
  approved Worker origin and `luxace-service`; Public Tracking's Worker URL
  remains absent from the build. The full non-emulator application suite
  passed 315/315; the Firestore Rules emulator suite passed 19/19.
- **Zero synthetic or durable production writes** occurred at any point in
  this rollout — every write-shaped verification request was rejected at
  either the Worker's 401 auth boundary or the Rules' 403 permission boundary
  before reaching Firestore. No IAM, Auth, R2, Cron, or `deletionExecutor`
  change accompanied this rollout.
- **Rollback ordering, if any layer is ever separately approved for
  rollback:** Hosting first, then Rules, then Worker last — matching the
  established F5d-65 precedent that the user-facing layer should stop
  depending on new capability before the layers underneath it are touched.
  Do not roll the Worker back while newer Hosting is live; do not roll Rules
  back while newer Hosting still performs direct-client `serviceReports`
  reads/updates that depend on the new allowlist.

## Deferred test improvement

The Rules emulator suite covers legacy updates and hash immutability. A future
test-only improvement should explicitly attempt to add `createdAt` to a legacy
document and assert rejection. It is not a rollout change and is not part of
this phase.
