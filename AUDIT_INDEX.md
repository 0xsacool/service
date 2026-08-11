# Audit Index

## System map

`src/main.tsx` starts `src/app/App.tsx`, whose staff routes are guarded by
`src/auth/StaffRouteGuard.tsx`; public tracking uses
`src/features/tracking/pages/TrackHome.tsx` and `TrackResult.tsx`.
`src/auth/AuthSessionProvider.tsx` owns Firebase email/password session state,
own-profile allowlisting, and the Worker ID-token seam. Repository selection is
centralized in `src/repositories/repositoryProvider.ts`: Mock is the default;
Firestore is selected only by `VITE_BACKEND_KIND=firestore` and only after an
authorized staff profile selects a canonical brand.

Service Jobs flow through `src/repositories/firestoreServiceJobRepository.ts`
and `src/repositories/firestore/serviceJobMapping.ts`; creation/update/closure
rules live in `src/services/serviceJobCreation.ts`, `serviceJobUpdate.ts`, and
`serviceJobClosure.ts`. Customers use `firestoreCustomersRepository.ts` and
`firestore/customerMapping.ts`; product master uses
`firestoreProductMasterRepository.ts` and `firestore/productMasterMapping.ts`.
Attachments use `workerAttachmentsRepository.ts` for Worker file bytes and
`firestoreAttachmentsRepository.ts` plus `firestore/attachmentMapping.ts` for
metadata. The Worker is `worker/src/index.ts`; it uses the REST client in
`worker/src/firestoreClient.ts` and the private R2 binding
`ATTACHMENTS_BUCKET`.

Public tracking is deliberately separate. The browser captures only a URL
fragment token (`src/features/tracking/publicTrackingFragment.ts`) and posts it
to `POST /public/tracking/{trackingReference}` using the narrow DTO client in
`src/features/tracking/publicTracking.ts`. The Worker verifies it in
`worker/src/publicTracking.ts` / `publicTrackingToken.ts` and returns a
whitelisted DTO only. `worker/src/publicTrackingIssuance.ts` is an unexposed
trusted issuance/rotation/revocation module.

Retention lifecycle: a terminal Service Job receives immutable `closedAt`;
`src/services/attachmentRetention.ts` derives `deleteAfter` and
`retentionStatus`. `worker/src/retentionSweep.ts` reconciles status only.
`worker/src/deletionSafety.ts` selects/re-checks valid expired candidates;
`worker/src/deletionExecutor.ts` fresh-reads Firestore, validates eligibility
and key namespace, heads/deletes R2, then writes `deletedAt`. A non-null
`deletedAt` is fail-closed and normal attachment reads hide it; the intentional
internal audit path is `getForJobIncludingDeleted()`.

## Security index

| Concern                               | Current source                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Firebase login/session                | `src/auth/AuthSessionProvider.tsx`, `authSession.ts`, `authSessionContext.ts`, `src/lib/firebase/firebase.ts`            |
| Staff-profile parsing/allowlist       | `src/auth/staffProfile.ts`; Worker `worker/src/staffAuthorization.ts`                                                    |
| Brand validation and scope            | `src/types/brand.ts`, Firestore repositories/mappings, `firestore.rules`, Worker `brands.ts` and `staffAuthorization.ts` |
| Worker Firebase ID-token verification | `worker/src/firebaseAuth.ts`                                                                                             |
| File authorization                    | `worker/src/index.ts`, `staffAuthorization.ts`, `paths.ts`                                                               |
| Public token generation/verification  | `worker/src/publicTrackingToken.ts`; issuance boundary `publicTrackingIssuance.ts`                                       |
| Public DTO boundary                   | `worker/src/publicTracking.ts`, `src/features/tracking/publicTracking.ts`                                                |
| Browser Firestore access policy       | `firestore.rules`                                                                                                        |
| Attachment key validation             | `worker/src/paths.ts`                                                                                                    |
| Deletion safety/execution             | `worker/src/deletionSafety.ts`, `deletionExecutor.ts`, `firestoreClient.ts`                                              |

The browser Rules and Worker IAM are distinct controls. Rules limit browser
Firestore access; the Worker uses service-account IAM for direct Firestore REST
calls and must enforce staff authorization in its own routes.

## Test inventory

| Test file                                    | Checks | Locality and major coverage                                                   |
| -------------------------------------------- | -----: | ----------------------------------------------------------------------------- |
| `test/serviceJobRetentionAnchor.test.mjs`    |      8 | Offline Service Job closure anchor and acknowledged writes                    |
| `test/serviceJobBrand.test.mjs`              |      6 | Offline canonical brand creation/immutability and public-token default        |
| `test/attachmentRetentionLifecycle.test.mjs` |     10 | Offline retention, retained metadata delete lifecycle, and hidden audit reads |
| `test/ownershipPublicTracking.test.mjs`      |      4 | Offline ownership mappings, scoped customer read, and legacy tracking denial  |
| `test/publicTrackingBrowser.test.mjs`        |      4 | Offline fragment handling, DTO client, and no direct Firestore/file transport |
| `test/authSession.test.mjs`                  |      4 | Offline session/profile allowlist fail-closed behavior                        |
| `test/firestoreReadiness.test.mjs`           |      5 | Offline scoped repository and no-auto-seed source contracts                   |
| `test/workerTokenProvider.test.mjs`          |      5 | Offline Worker bearer injection, 401 refresh, and 403 fail-closed behavior    |
| `test/firestoreRules.test.mjs`               |      9 | Local Firestore Emulator Rules authorization matrix                           |

Application Node tests total **46**; with the Emulator suite, application
evidence totals **55 passing tests**.

| Worker test file                                                                               | Checks | Locality and major coverage                                               |
| ---------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------- |
| `worker/test/googleAuthEmailNormalization.test.mts`                                            |      6 | Offline OAuth service-account email normalization                         |
| `worker/test/retentionDryRun.test.mts`                                                         |      7 | Offline retention status boundaries                                       |
| `worker/test/deletionSafety.test.mts`                                                          |     23 | Offline eligibility, key validation, caps, circuit breaker, audit entries |
| `worker/test/firestoreClientMarkDeleted.test.mts` via `runFirestoreClientMarkDeleted.test.mjs` |     10 | Offline existing-document PATCH contracts and public hash writer          |
| `worker/test/deletionExecutor.test.mts`                                                        |     44 | Offline fresh re-read, R2 handling, self-heal, cap, breaker, idempotency  |
| `worker/test/staffAuthorization.test.mts`                                                      |     27 | Offline Firebase token and staff/file-route authorization                 |
| `worker/test/publicTracking.test.mts`                                                          |     19 | Offline token, exact lookup, DTO, generic failure, rate-limit seam        |
| `worker/test/publicTrackingIssuance.test.mts`                                                  |      8 | Offline issue/rotate/revoke and fragment-only share links                 |

`worker/test/smoke.mjs` is a separate manual smoke artifact, not part of the
automated `test` command. `npm.cmd run typecheck` and `npm.cmd run test` in
`worker/` passed: **144 offline checks**. No suite exercises production
services.

## Deployment/config inventory

There is no frontend-host deployment configuration in the repository. Browser
Firebase configuration is runtime environment based (`VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and
`VITE_FIREBASE_APP_ID`); backend and Worker endpoint selection use
`VITE_BACKEND_KIND`, `VITE_FILES_BACKEND`, `VITE_FILES_WORKER_URL`, and
`VITE_PUBLIC_TRACKING_WORKER_URL`.

Firebase configuration is `firebase.json`, `.firebaserc`, `firestore.rules`,
`firestore.indexes.json`, and `firebase.rules-test.json`. Worker configuration
is `worker/wrangler.toml`: Worker `service-tech-files-worker`, R2 binding
`ATTACHMENTS_BUCKET` to `service-tech-attachments-prod`, vars
`ALLOWED_ORIGINS` and `FIRESTORE_PROJECT_ID`, and source-declared daily Cron
`0 3 * * *`. Secret names only: `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`; local-only emulator override is
`FIRESTORE_EMULATOR_HOST`.

The source `scheduled()` handler calls only `runRetentionSweep()`. The
deletion executor is not imported by `worker/src/index.ts`, has no HTTP route,
and has no production invocation path. The public tracking HTTP route exists
in source but is not deployed on the production version.

## Known production facts

Documented, previously verified live facts (not re-queried by this audit):
production traffic is 100% on Worker version
`9a8b83f2-861d-4700-9b4a-05260c4ee661`; its R2 binding is present; Cron is
NONE/inactive; R2 bucket `service-tech-attachments-prod` is private; and the
deletion executor is unwired. F5d-18's sole synthetic QA object and retained
metadata were cleaned up. F5d-24 through F5d-29 are source/emulator-only: no
Firebase Auth provider/user, staff profile, brand document, Rules deployment,
Worker/frontend deployment, token issuance, or production data backfill is
recorded.

## Documentation drift list

- `worker/wrangler.toml` retains historical comments saying the Worker was
  never deployed and that real credentials/service account do not exist;
  documented production facts contradict those comments.
- `src/types/attachment.ts` retains pre-F5d-17 wording that nothing deletes
  files/no Cron exists. Manual deletion and the unwired executor now exist;
  production Cron is still inactive.
- `src/repositories/firestoreServiceJobRepository.ts` retains a "Seed before
  listening" rationale despite no seed call; `firestoreReadiness` explicitly
  verifies automatic seed writes are absent.
- `DATABASE_SCHEMA.md` remains a relational/Supabase-era target schema using
  tables such as `service_jobs`; it is not a canonical description of the
  implemented Firestore collections, auth model, ownership fields, or public
  tracking hash.
- `PROJECT_STATE.md` and `AI_HANDOFF.md` have current F5d-29 sections, but
  their early high-level wording and historic sprint sections need careful
  reading so historical "no auth/no endpoint" statements are not treated as
  claims about the present source-only implementation.

## Hygiene findings

No active `TODO`, `FIXME`, or `HACK` markers were found in production source
or Rules. Mock fixtures/repositories are intentional and remain the default
backend. `@supabase/supabase-js` is installed but documented as unused.

The three Firestore repository implementations use scoped `onSnapshot`
listeners (Service Jobs by validated `brandId`, Customers by membership,
Product Master global for staff); the current session architecture deliberately
does not expose teardown. Product Master create/update writes are intentional
fire-and-forget operations with `.catch()` logging; this is a deployment-risk
candidate because client Rules currently deny product writes. Console logging
is confined to expected error/operational paths (repository listener/write
errors, Worker upload/sweep telemetry, and ErrorBoundary); no raw bearer token
or secret logging was found in the inspected security paths.

## Rollout dependency graph

`Firebase email/password enabled` -> `privileged staff user provisioned` ->
`staffProfiles/{uid}` and canonical `brands/*` provisioned -> `ServiceJob`
brand-data review/backfill -> restrictive Firestore Rules deployment ->
frontend staff auth/repository deployment -> authenticated Worker file-route
deployment.

Separately: `public tracking Worker deployment` -> `approved privileged
issuance caller/UI` -> token issuance/rotation/revocation -> approved
Cloudflare rate limiting. Public tracking remains independent of customer
accounts and must not expose files.

For retention: `operational deletion review` -> approved candidate-selection
and observability design -> explicitly approved Worker deployment -> separate
Cron activation. Automatic retention deletion must remain after the preceding
auth/Rules rollout and remains independently gated.

## Unresolved decisions

- Production rollout order, preflight evidence, and rollback ownership for
  Firebase Auth, staff provisioning, brands, backfill, Rules, frontend, and
  Worker deployment.
- Classification/backfill authorization for legacy Service Job
  `BRN-2026-000001`; it must continue to fail closed until explicitly decided.
- Exact privileged caller/authorization model and staff UX for public-token
  issue/rotate/revoke.
- Cloudflare public-tracking rate-limit policy and numeric threshold.
- Product Master's eventual write authority/workflow under restrictive Rules.
- Automatic deletion candidate source, observability/audit retention,
  invocation approval, and Cron activation remain unapproved.
