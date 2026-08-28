# Service Tech Files Worker (Sprint F5a — foundation)

A Cloudflare Worker that is the _only_ thing allowed to talk to R2 for this
project's attachment storage. The Vite app calls this Worker over `fetch()`;
the Worker holds the R2 binding; nothing else in the codebase touches R2
directly, and no R2 access key or secret exists anywhere in this project.

**Scope note:** started as F5a foundation-only (no Firestore, no attachment
metadata, no retention). As of F5d-5 this Worker can read/patch
`serviceJobAttachments` for retention reconciliation (see "Firestore
access" below) — but there is still no automatic deletion, no usage
dashboard. Authentication, brand authorization, Firestore metadata, and the
production attachment path were added in later F5d phases. See the approved
F5 architecture proposal and the F5d Worker-access review for the full
picture.

**As of F5d-12 (2026-08-09), this Worker is deployed to production** with
a real, bound R2 bucket (`service-tech-attachments-prod`) and working
Firestore access (see "Firestore access" below) — the sections below that
still describe "local-only"/"never deployed" behavior are accurate for
local development, which is unchanged, but no longer describe the
project's only environment. See
[`PRODUCTION_FIRESTORE_ACCESS.md`](PRODUCTION_FIRESTORE_ACCESS.md) for the
full production history.

## Prerequisites

- Node.js 20+ (matches the main app)
- No Cloudflare account, login, or API token needed for local development —
  see "How local dev works" below.

## Setup

```bash
cd worker
npm install
```

This installs `wrangler` and `@cloudflare/workers-types` into `worker/`'s
own `node_modules`, isolated from the main Vite app's `package.json` —
nothing at the repo root changed to support this.

If `npm install` warns about pending install scripts (`esbuild`, `workerd`),
approve them — `workerd` is the actual Cloudflare Workers runtime binary
`wrangler dev` needs to run anything at all:

```bash
npm approve-scripts esbuild workerd
npm install
```

## Running locally

```bash
npm run dev
```

This starts `wrangler dev` on `http://127.0.0.1:8787`.

**How local dev works:** by default `wrangler dev` runs in _local_ mode,
which simulates every binding (including R2) in-process via Miniflare —
persisted to `worker/.wrangler/` (gitignored), never touching a real
Cloudflare account. The `bucket_name` in `wrangler.toml`
(`service-tech-attachments-dev`) is a placeholder for a bucket that does not
exist yet on any real account; local mode never needs it to exist. Nothing
about running this Worker locally requires `wrangler login`, an
`account_id`, or billing of any kind.

## Smoke test

With `npm run dev` running in one terminal:

```bash
npm run smoke
```

`scripts/smoke.mjs` is a plain Node script (no test framework — this repo
doesn't have one yet) that exercises the real endpoints end-to-end: uploads
a small file, downloads it back and byte-compares it, deletes it, confirms
a subsequent download 404s, and checks the content-type/category/size
validation guards (including a real ~51MB oversized upload rejected by the
streaming size guard, not just the spoofable `Content-Length` header). It
cleans up after itself — the one file it creates is deleted by the test
before it exits.

## Endpoints

| Method   | Path                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/health`                                | Liveness check — `{"status":"ok"}`                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST`   | `/files/service-jobs/{jobId}/{category}` | Authenticated staff upload. Requires `Authorization: Bearer <Firebase ID token>` plus the existing content headers. The Worker verifies the token and matching `staffProfiles/{uid}.brandId`/`serviceJobs/{jobId}.brandId` before the R2 write. |
| `GET`    | `/files/{path}`                          | Authenticated staff download. The validated key determines the owning job; token/profile/brand authorization happens before R2 read. |
| `DELETE` | `/files/{path}`                          | Authenticated staff delete. The validated key determines the owning job; authorization happens before R2 delete. Idempotent after authorization. |

`401` means a missing, malformed, or invalid Firebase ID token. `403` means a
valid token without a valid matching staff profile and Service Job brand.
`/health` remains a liveness endpoint. CORS is not authentication.

Validation enforced at the Worker boundary: content-type allowlist (415 if
rejected), a 50MB size cap enforced against the actual bytes read (413 if
exceeded — not just a `Content-Length` header check, which can't be
trusted), filename sanitization, and a server-generated UUID prefix so two
uploads can never collide or overwrite each other.

## Scheduled handler (F5d-31 deploy-safe, Cron still not activated)

The default `wrangler.toml` contains **no** `[triggers]` section, while
`src/index.ts` retains a `scheduled()` handler for future separately approved
use. A normal Worker code deployment therefore cannot activate Cron. Any
future Cron activation requires an explicit approved configuration and deploy
action. As of F5d-5, the handler runs a **real reconciliation sweep**
(`retentionSweep.ts`) whenever it's triggered locally, but it only ever
patches `retentionStatus` on already-existing `serviceJobAttachments`
documents — there is no R2 call and no document-delete call anywhere in
that code path. See "Firestore access" below for how it reaches Firestore.

Test the handler locally (no deploy):

```bash
npm run dev -- --test-scheduled
```

Then in another terminal:

```bash
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+3+*+*+*"
```

This triggers `scheduled()` exactly as a real cron fire would, without any
live Cloudflare resource involved. Expect a `200 OK` and a log line in the
`wrangler dev` terminal reporting how many attachments were scanned/updated.

## Firestore access (F5d-5)

This Worker can now read/patch the `serviceJobAttachments` collection for
retention reconciliation, following the architecture recommended in the
F5d review: a Google service-account JWT-bearer assertion (RFC 7523),
signed with Web Crypto (`crypto.subtle`, RS256) — not `firebase-admin`, not
`@google-cloud/firestore`, neither of which runs in the Workers runtime —
exchanged for a short-lived OAuth2 access token, used as a Bearer token on
plain Firestore REST calls (`fetch()`). See `src/googleAuth.ts` and
`src/firestoreClient.ts`.

**A real credential now exists, installed as of F5d-9 (2026-08-08).**
`GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` are
set as Cloudflare Worker secrets (`wrangler secret put` — never
`wrangler.toml`, never committed `.dev.vars`) for
`firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`. The
local JSON key used to install them was deleted immediately after and
verified gone from every location it could plausibly have ended up.
`FIRESTORE_PROJECT_ID` remains the one Firestore-related value that's
genuinely public (mirrors `VITE_FIREBASE_PROJECT_ID`) and lives in
`wrangler.toml`'s `[vars]`.

**As of F5d-10.3 (2026-08-09), production Firestore access works.** F5d-10
first deployed the real Worker code (`fetch`/`scheduled` handlers,
version `f799d94e-...`), but the production auth test failed with
`invalid_grant: "Invalid grant: account not found"`. F5d-10.1/F5d-10.2
diagnosed this read-only-only down to one leading whitespace character in
the `GOOGLE_SERVICE_ACCOUNT_EMAIL` Cloudflare secret (an artifact of how
it was originally installed in F5d-9), confirmed via a safe structural
check that never printed the secret itself. F5d-10.3 fixed it:
`googleAuth.ts` now trims the email before using it as the JWT `iss`
claim (`normalizeServiceAccountEmail()`, with a regression test), the
secret was re-installed cleanly (the private key secret was untouched, no
new GCP key was created), and the corrected code was redeployed (version
`e15604f6-...`, 100% traffic — still no R2 binding, still no Cron
trigger, both deliberately excluded, same as F5d-10). A read-only smoke
test against real production Firestore succeeded:
`{"ok":true,"attachmentCount":0,"sampleDocIds":[]}` — the empty count
reflects that this collection has no real data yet, not an error. Read
[`PRODUCTION_FIRESTORE_ACCESS.md`](PRODUCTION_FIRESTORE_ACCESS.md)'s
"F5d-10.3" section for the full record. This Worker is publicly reachable
at `https://service-tech-files-worker.sacool-spizy.workers.dev`
(Cloudflare enabled `workers_dev` by default on deploy, disclosed back in
F5d-10). Cron is not active. A real R2-deletion executor exists but remains
unwired from every production route and scheduled handler.

**Historical F5d-12 checkpoint (2026-08-09): `/files/*` became fully wired to a real,
private production bucket.** `service-tech-attachments-prod` was created
and `ATTACHMENTS_BUCKET` now binds to it (version
`9a8b83f2-861d-4700-9b4a-05260c4ee661`, 100% traffic) — `/files/*` no
longer 500s for lack of a binding. No public access or custom domain was
configured on the bucket; the only way to reach an object's bytes is
still went through the then-unauthenticated Worker. Later F5d phases added the
current authenticated and brand-scoped boundary described under "Security
posture" below. See
[`PRODUCTION_FIRESTORE_ACCESS.md`](PRODUCTION_FIRESTORE_ACCESS.md)'s
"F5d-12" section for the full record, including the two dashboard-related
stops it took to get there.

### Local development: the Firestore Emulator, not real Firestore

Set `FIRESTORE_EMULATOR_HOST` in your local `.dev.vars` (copy from
`.dev.vars.example`) and this Worker talks to the emulator instead of real
Firestore — `googleAuth.ts` skips the entire Google auth flow in that case
(the emulator never validates bearer tokens), and no real credential is
ever needed for local testing.

Requires the Firebase CLI (already used elsewhere in this project for
`firestore.rules` deploys — invoked via `npx firebase`, no new dependency)
**and a local JRE**, since the Firestore Emulator is Java-based. Neither is
declared as a project dependency; both are developer-machine prerequisites,
same as Node itself.

```bash
# from the repo root, not worker/
npx firebase emulators:start --only firestore
```

This reuses the project's real `firestore.rules` unmodified (see
`firebase.json`'s `emulators.firestore` block) — nothing about running the
emulator changes or deploys the real rules file. The emulator listens on
`127.0.0.1:8080` by default; set `.dev.vars`' `FIRESTORE_EMULATOR_HOST` to
match.

### What this Worker can and cannot do to Firestore

`firestoreClient.ts` exposes four operations, all scoped to
`serviceJobAttachments`:

- `listAttachments()` — read.
- `getAttachment(docId)` — read one document.
- `updateRetentionStatus(docId, status)` — patches only the
  `retentionStatus` field via Firestore's `updateMask`, never `deleteAfter`,
  never any other field, never a full-document overwrite.
- `markAttachmentDeleted(docId, deletedAt)` — an existing-document-only
  PATCH with `updateMask.fieldPaths=deletedAt` and
  `currentDocument.exists=true`; it never deletes the document.

There is no delete-a-document method and no write to any other collection.
`deletionExecutor.ts` can delete R2 only when a separately-wired caller
supplies an approved candidate; it remains unwired from production HTTP and
Cron paths, so automatic deletion is disabled.

### File flow — verified end-to-end in production (F5d-13, 2026-08-09)

Upload → R2 write → Firestore metadata write → download was mapped
directly from source (not assumed from this doc) and proven against real
production infrastructure: a uniquely QA-namespaced test object was
uploaded through the real Worker route, downloaded back byte-for-byte
identical, deleted, and confirmed gone (`404`) — no redeploy needed, no
Firestore document was ever created by the test. Full method-by-method
trace and the exact test key are in
[`PRODUCTION_FIRESTORE_ACCESS.md`](PRODUCTION_FIRESTORE_ACCESS.md)'s
"F5d-13" section.

### Deletion safety foundation — built, not wired (F5d-13, policy decided F5d-14)

`src/deletionSafety.ts` adds pure eligibility, re-verification,
key-namespace validation, circuit-breaker, and audit-entry helpers for a
**future** deletion executor — no R2 call, no Firestore write, never
imported by `index.ts`. Two of the four numeric policy values it
requires as mandatory parameters are now decided project policy —
**maximum deletions per run: 50, failure threshold: 3** — logged as
[DECISIONS.md #024](../DECISIONS.md). These are execution-throttling
limits only; they don't touch the existing 365-day retention period or
30-day expiring-soon window, and nothing calls `deletionSafety.ts`'s
functions with these values yet, since no deletion executor exists.
Retry count and grace period remain undefined. See
`PRODUCTION_FIRESTORE_ACCESS.md`'s "F5d-14" section for the full record.

### Real deletion executor — implemented, still unwired (F5d-15 / F5d-17)

`src/deletionExecutor.ts` implements the real R2 deletion sequence
(fresh Firestore re-read via `firestoreClient.ts`'s `getAttachment()`,
re-checked eligibility, key re-validation, then the actual R2 `delete()`,
then a Firestore `markAttachmentDeleted()` write) behind F5d-13's safety
foundation, using the approved 50/3 policy from DECISIONS.md #024. **It
is not imported by `index.ts`, not called from `scheduled()`, and has no
HTTP route** — confirmed by grep, not assumption.

### Firestore attachment lifecycle — decided and implemented (F5d-16 / F5d-17)

F5d-16 evaluated three options for what should happen to a
`serviceJobAttachments` document once its R2 object is deleted and the
user approved Option C (DECISIONS.md #025): the document is **retained
permanently, never hard-deleted** — a new `deletedAt: string | null`
field on `Attachment` records when its R2 object was physically removed,
while `RetentionStatus` keeps its original two-value meaning untouched.
F5d-17 implemented this: `deletionExecutor.ts`'s Step 6 now marks
`deletedAt` via a new `markAttachmentDeleted()` on `firestoreClient.ts`
(self-healing on a later run if the write ever fails); a record already
marked `deletedAt` is never re-selected as a candidate
(`deletionSafety.ts`'s `isEligibleForDeletion()`); and app-side,
`AttachmentMetadataStore.getForJob()`/`getById()` now exclude deleted
records by default (public `AttachmentsRepository` consumers, i.e. every
hook, never see them), with an internal-only `getForJobIncludingDeleted()`
reserved for a future audit view. F5d-18 added a six-check offline Firestore
PATCH contract test (86 total across five Worker test files) — see
`PRODUCTION_FIRESTORE_ACCESS.md`'s
"F5d-17" section for the full record.

F5d-22 converged the main app's manual attachment delete path to this same
lifecycle: after this Worker's idempotent `DELETE /files/{key}` succeeds, the
app retains the Firestore metadata and writes `deletedAt`. The Worker source,
routes, binding, and deployment are unchanged; this does not wire automatic
deletion or add Worker authorization.

### Controlled deletion QA — complete and cleaned up (F5d-18)

F5d-18 used a single fixed, clearly synthetic attachment only through
isolated Cloudflare preview versions; no production traffic moved and Cron
remained inactive. The first real executor run deleted the synthetic R2
object but its `markAttachmentDeleted()` PATCH received generic Firestore
`403 PERMISSION_DENIED`. Addressing and IAM update permission were verified.
The operation was then made explicitly update-only with
`currentDocument.exists=true`; one controlled self-heal run successfully
wrote `deletedAt` while R2 remained absent. This evidence does not establish
the precondition as the sole cause of the earlier 403. The retained synthetic
metadata document was then hard-deleted only as QA cleanup, consistent with
neither changing nor bypassing DECISIONS.md #025 for production behavior.

## F5d-24 staff authorization foundation — source only, not deployed

The source now verifies Firebase RS256 ID tokens using Worker Web Crypto and
Google signing keys. It validates token structure, `kid`, signature, audience,
issuer, expiry, issuance/authentication times, and subject; signing keys honor
their cache lifetime and refresh once for an unknown `kid`. All failures fail
closed and bearer tokens are never logged. Authorization does two direct
Firestore reads only: `staffProfiles/{uid}` then `serviceJobs/{jobId}`. Both
must be recognized canonical brands and match. Existing Worker IAM already
includes `datastore.entities.get`; no IAM change is needed.

These routes are only present in source until a separately approved deployment
and staff/Auth provisioning. Current production remains on the prior version,
with no Firebase Auth provider, staff profile, brand document, Rules update,
or Cron activation. `deletionExecutor.ts` remains unimported from `index.ts`
and has no HTTP route.

The full offline Worker suite passes 113 checks across six scripts, including
token, authorization, route, retention, and deletion-executor regressions.

## Configuration

`wrangler.toml`:

- `[[r2_buckets]]` — the `ATTACHMENTS_BUCKET` binding. As of F5d-12
  (2026-08-09), `bucket_name` points to the real production bucket
  `service-tech-attachments-prod` — `wrangler dev`'s local mode still
  simulates this binding entirely via Miniflare regardless, so local
  development is unaffected.
- `[vars] ALLOWED_ORIGINS` — comma-separated browser origins allowed to call
  this Worker (CORS). Defaults to the local Vite dev server origin.
- `[vars] FIRESTORE_PROJECT_ID` — public; see "Firestore access" above.

`.dev.vars` (gitignored, copy from `.dev.vars.example`) — local-only secret
overrides for `wrangler dev`. As of F5d-5, this is where `FIRESTORE_EMULATOR_HOST`
goes for local testing. **Never put an R2 access key/secret, or a real
Google service-account key, here or anywhere else in this project** — the
R2 binding needs no key at all by design. Production Google credentials are
Cloudflare Worker secrets; their values are not stored in this repository
(see "Firestore access" above).

## Security posture — read before relying on this for anything real

- **No R2 access keys or secrets exist anywhere in this project.** The
  Worker's R2 binding requires none — it's granted by the platform, not a
  credential the code holds. Nothing here uses S3-compatible keys or
  presigned URLs.
- **The real production bucket (`service-tech-attachments-prod`, created
  F5d-12) is private.** No public bucket access or custom domain was
  configured; the only way to reach an object's bytes is through this
  Worker.
- **Production staff routes are authenticated and brand-scoped.** File routes
  and `POST /service-jobs` require a Firebase ID token plus the approved staff
  profile/brand checks. `/health` remains intentionally public. Public
  Tracking routes remain unreachable because `PUBLIC_TRACKING_ENABLED` is
  absent; CORS is not treated as authorization.
- Basic abuse safeguards that do exist: content-type allowlist, a hard size
  cap enforced on real bytes, and CORS restricted to configured origins.
  Rate limiting is explicitly not implemented this sprint (see the F5
  proposal's Risks section) — flagged, not solved.

## Current production status — F5d-63/F5d-63C (2026-08-14)

The real R2 bucket (`service-tech-attachments-prod`) and the GCP service
account/custom IAM role are installed and working. The Worker is live at
version `06bc88e9-1437-4708-b68e-07f82caaf916`, 100% traffic, with
`ALLOWED_ORIGINS=http://localhost:5173,https://luxace-service.web.app`.
F5d-60 version `55d9120c-af26-416b-bd68-1b3a4a3d271a` is the rollback target
for this CORS-only rollout. Cron remains deliberately disabled, the default
`wrangler.toml` has no `[triggers]`, and Public Tracking remains disabled
(`PUBLIC_TRACKING_ENABLED` absent).

The F5d-63 staff frontend is live at `https://luxace-service.web.app` on
Hosting release `1786723383971000`, version `b9e59a97e9ded5cc`. Its approved
21-file, 1,116,259-byte artifact was independently matched live; Public
Tracking remains unavailable. Gate 7.1 already completed one authenticated
production allocation, creating `BRN-2026-000002` / `SR-2026-000001`;
F5d-63 post-deploy verification used read-only checks only. See
[`PRODUCTION_FIRESTORE_ACCESS.md`](PRODUCTION_FIRESTORE_ACCESS.md) and
[`../PROJECT_STATE.md`](../PROJECT_STATE.md) for the audited deployment and
artifact records.

Every step above went through the same explicit-confirmation process
every live Cloudflare/Firebase change in this project has gone through —
none of it was bundled or assumed.

## F5d-26 app token integration readiness (source only)

F5d-26 did not change or deploy Worker source, bindings, secrets, IAM, R2, or
Cron. It connects the app-side `WorkerTokenProvider` seam to the future
Firebase staff session: Worker attachment requests send a Firebase ID token,
refresh it once on a `401`, trigger local sign-out after a second `401`, and
do not retry a `403`. Tokens are not logged; Mock attachment mode does not
need Firebase Auth.

The production Worker remains version
`9a8b83f2-861d-4700-9b4a-05260c4ee661`; production traffic, Cron status, and
the unwired `deletionExecutor` are unchanged. A live app rollout still needs
separate approval for Auth enablement, privileged staff provisioning, Rules
deployment, and frontend/Worker deployment preflight.

## F5d-28 public tracking boundary (source/emulator only)

The current source adds `POST /public/tracking/{trackingReference}` as a
separate capability route. Its reference is only an exact document identifier;
the required body is a bounded JSON object containing one URL-safe random
256-bit token. The Worker hashes that token with SHA-256, compares hashes in
constant time, then returns only the approved public DTO. It does not accept a
job ID/key/target anywhere other than the route's exact tracking reference.

The route performs one direct `serviceJobs/{trackingReference}` GET. It has no
collection scan, attachment operation, R2 call, file URL, staff bearer-token
verification, or attachment metadata access. A malformed body, invalid token,
wrong token, missing record, malformed record, Firestore failure, and denied
future rate-limit check all return the same generic not-found response. The
safe timeline is status plus timestamp only; descriptions and internal fields
are never parsed into the DTO.

`src/services/publicTrackingToken.ts` supplies the runtime-neutral generation,
hashing, constant-time verification, rotation, and revocation helpers. A
future privileged issuance flow must persist only `publicTrackingTokenHash`;
it must show the raw token once and never log or store it. The normal app and
browser Rules cannot set this field.

This endpoint is not deployed. The production version remains
`9a8b83f2-861d-4700-9b4a-05260c4ee661`, production traffic has not changed,
Cron is inactive, and `deletionExecutor` is still unwired. Offline Worker
typecheck and 134 checks passed; the local Firestore Rules suite passed nine
tests. No credentials, IAM, R2 configuration, or production data changed.

## F5d-29 trusted issuance boundary (source only)

`src/publicTrackingIssuance.ts` is an internal Worker module, not a fetch or
scheduled route. It can issue, rotate, or revoke an exact tracking reference
only when a future privileged caller explicitly invokes it. Issuance writes
only `publicTrackingTokenHash` through an existing-document-only PATCH and
returns a share link whose raw token is confined to the fragment. Rotation
replaces the hash; revocation writes `null`.

The module must not be exposed until a staff/admin authorization decision and
caller are approved. It uses existing Firestore update permission only, so no
IAM change is necessary. The matching browser client posts the fragment token
to `/public/tracking/{reference}` without a staff bearer token. Neither the
issuance boundary nor the browser client is deployed; production remains on
`9a8b83f2-861d-4700-9b4a-05260c4ee661`, Cron is inactive, and the deletion
executor is unwired. Worker typecheck and 144 offline checks pass.

## PUB-TRACK-1 manual public tracking code (source only)

The source-only public tracking addition accepts a complete
`SRV-{YYYY}-{MMDD}-{XXXXXX}` code at `POST /public/tracking`. The body is
bounded to `{ code }`; the Worker reads a private direct lookup document,
then one Service Job, verifies `publicTrackingCodeHash`, and returns only the
minimal public tracking DTO. It does not scan Firestore, read attachments or
R2, authorize staff routes, or expose the lookup document. The legacy
fragment-token endpoint remains for compatibility.

Code generation and trusted preparation are offline/source seams only. The
six-character base36 space is `36^6 = 2,176,782,336`, so production use needs
an approved fail-closed rate-limit policy and a privileged atomic issuance
transaction. With no limiter, distributed guessing is unlimited; a basic
per-IP limiter is bypassable, so production needs layered edge/IP/device
throttling and fail-closed behavior. No public issuance route, Firestore write, Rules/IAM/Auth
change, deployment, R2 operation, or Cron change was made. The offline Worker
suite currently passes 147 checks.

## F5d-32 Service Job creation boundary (source only)

`POST /service-jobs` is an authenticated, staff-profile-authorized Worker route. It accepts only a bounded `{ intake }` body plus an `Idempotency-Key` UUIDv4 header. The Worker derives brand, Bangkok numbering year, tracking/Service Request numbers, document ID, timestamps, status, and initial security fields; the browser cannot select them. One Firestore transaction creates the private idempotency record, both sequence values, and a create-only Service Job. Collision probes are bounded and `BRN-2026-000001` is never modified. This route has not been deployed. F5d-38 applied its required `datastore.entities.create` permission to the existing custom role; browser Rules still must deny Service Job creation and the two private allocator collections before rollout.

## F5d-37 Gate 2 production provisioning

Firebase Email/Password is now enabled. The initial staff allowlist record is
`staffProfiles/qUbRfp5Iv3drX9IEZL3DyLBvcsj2` with only
`brandId: "bruno-thailand"`; its corresponding Auth user is
`sacool.spizy@gmail.com`. The canonical `brands/bruno-thailand` and
`brands/join-lux-club` documents also exist with their approved code/name
pairs. This provisioning does not deploy this Worker or the reviewed Rules, so
the deployed Worker remains
`9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic.

The first staff-profile write created `staffProfiles/.exists=false` because of
a PowerShell URI-interpolation defect. It was deleted under an approved
`updateTime` precondition and verified absent before a safe retry created the
intended UID record. The incident is fully remediated with no residual
production impact; this history is retained for audit.

## F5d-38 Gate 3 IAM production change

The existing Worker custom role now has exactly database get and entity
get/list/update/create. F5d-38 added only entity create; entity delete remains
absent and the service-account binding is unchanged. No Worker deploy, Rules,
Auth, data, R2, secret/configuration, Cron, or deletion-executor change
occurred. The Worker is still on version
`9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic.
