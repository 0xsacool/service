# Production Firestore Access — Setup Plan (F5d-6 / F5d-7 / F5d-8 / F5d-9 / F5d-10 / F5d-10.1 / F5d-10.2 / F5d-10.3 / F5d-11 / F5d-12 / F5d-13 / F5d-14 / F5d-15 / F5d-16 / F5d-17)

> **Status as of F5d-17 (2026-08-09): Firestore post-delete lifecycle
> IMPLEMENTED — executor still UNWIRED.** F5d-16's Option C was approved
> (DECISIONS.md #025): `deletedAt: string | null` added to `Attachment`
> (both `src/types/attachment.ts` and the Worker's
> `AttachmentRetentionRecord`), never a hard delete of the Firestore
> document. `worker/src/deletionExecutor.ts`'s Step 6 — previously a
> deliberate stop — now calls a new `markAttachmentDeleted()` REST method
> on `worker/src/firestoreClient.ts`, attempted after both a genuine R2
> delete and a confirmed-already-absent object (self-healing a prior
> run's failed write). `worker/src/deletionSafety.ts`'s
> `isEligibleForDeletion()` now fails closed on any record already marked
> `deletedAt`, so nothing is ever reprocessed. App-side, repository read
> methods (`AttachmentMetadataStore.getForJob()`/`getById()`, and
> transitively the public `AttachmentsRepository` every hook consumes)
> exclude deleted records by default; a deliberate internal-only
> `getForJobIncludingDeleted()` exists for a future audit view, never
> exposed through the public interface. 14 new offline regression checks
> (80 total across all four worker test files) pass using fakes — no
> production R2 object, Firestore document, IAM, secret, or Cron setting
> was touched, and no Worker deployment occurred (production traffic
> stayed on `9a8b83f2-...` throughout). **The executor remains completely
> unwired** — this sprint only completed what Step 6 does, it did not
> connect anything to `scheduled()`, an HTTP route, or Cron. See "F5d-17"
> below for the full record.
>
> **Status as of F5d-16 (2026-08-09): DECISION SPRINT — options
> presented, nothing adopted yet.** F5d-15 stopped its executor
> immediately after a successful R2 delete because no rule anywhere in
> this project defines what should happen to a `serviceJobAttachments`
> metadata document afterward. This sprint re-confirmed that gap (fresh
> grep of `DECISIONS.md`, `BUSINESS_RULES.md`, the codebase — still
> nothing defines it) and evaluated three options: **(A)** hard-delete the
> Firestore doc after R2 deletion (the pattern already shipped for manual
> staff delete, but never for the automatic/batched path), **(B)** widen
> `RetentionStatus` with a new `'deleted'` value, **(C)** keep
> `RetentionStatus` untouched and add a separate `deletedAt: string | null`
> field. **Recommended: Option C** — full audit retention (this is a
> repair-tracking system where an attachment may carry dispute/audit
> value after a job closes) without widening a union that
> `deletionSafety.ts` already treats as a strict two-value,
> non-deletion signal. **No source code was changed this sprint** except
> the reads needed to do this analysis; no R2 object, Firestore document,
> IAM, secret, or Cron setting was touched; no `DECISIONS.md` entry was
> added (that happens only after explicit approval). See "F5d-16" below
> for the full options table and the exact decision needed.
>
> **Status as of F5d-15 (2026-08-09): Real R2 deletion executor
> implemented — COMPLETE and production-capable in code, but UNWIRED.**
> `worker/src/deletionExecutor.ts` performs the full deletion sequence —
> structural candidate validation, a fresh Firestore metadata re-read
> (via a new read-only `getAttachment()` on `firestoreClient.ts`,
> read-only, no IAM change needed), re-checked eligibility, key
> re-validation, then the real R2 delete (via `head()` first to
> distinguish "already gone" from a genuine failure, never conflating
> the two) — applying the approved policy (`maxDeletionsPerRun: 50`,
> `failureThreshold: 3`, DECISIONS.md #024) exactly as decided, with no
> alternative defaults introduced. **It stops immediately after a
> successful R2 delete.** No Firestore mutation is attempted after that
> point, by design — nothing in this project defines what should happen
> to the metadata document once its R2 object is gone (confirmed via a
> fresh repo-wide check this sprint; same gap already flagged in F5d-13),
> and inventing that behavior was explicitly out of scope. 31 new offline
> regression checks (66 total across all four worker test files) pass
> using fakes for R2/Firestore — no production infrastructure was
> touched. **The executor is imported by nothing** — not `index.ts`, not
> `scheduled()`, no HTTP route — confirmed by direct grep, not assumption.
> **No Worker deployment occurred this sprint; Cron remains disabled; no
> production data was read, written, or deleted.** See "F5d-15" below for
> the full record and the exact question still open before this can ever
> be wired to a real trigger.
>
> **Status as of F5d-14 (2026-08-09): POLICY DECIDED (documentation only —
> no code change).** The two deletion-safety values F5d-13 left
> undefined are now approved project policy, logged as
> [DECISIONS.md #024](../DECISIONS.md): **maximum 50 deletions per run**,
> **halt after 3 failures within a run**. These are execution-throttling
> limits only — they do **not** change the existing 365-day retention
> period, the existing 30-day expiring-soon window, `deleteAfter` on any
> attachment, or deletion eligibility itself; they only bound how much a
> future deletion executor is allowed to do once it exists and is
> separately approved to run. **No source code was changed this sprint**
> — `deletionSafety.ts`'s `maxDeletionsPerRun`/`failureThreshold`
> parameters remain exactly as required-with-no-default as F5d-13 left
> them; no caller anywhere passes 50/3 yet, because no deletion executor
> has been built. **Cron remains disabled. No production data of any kind
> was touched.** See "F5d-14" below for the full record.
>
> **Status as of F5d-13 (2026-08-09): COMPLETE — file flow proven
> end-to-end in production; deletion safety foundation built, not wired.**
> Part A mapped the real upload → R2 → Firestore-metadata → download flow
> directly from source (not docs) and proved it works against real
> production infrastructure: a uniquely QA-namespaced test object
> (`service-jobs/qa-f5d13-1786254797/documents/a56d512e-...-f5d13-qa-test.pdf`)
> was uploaded through the real Worker HTTP route, downloaded back
> byte-for-byte identical, then deleted and confirmed gone (404) — no
> redeploy needed, no Firestore document was ever created (the test hit
> only the Worker's R2 routes directly, not the frontend repository).
> Part B added `worker/src/deletionSafety.ts` — pure eligibility,
> re-verification, key-namespace validation, circuit-breaker, and
> auditability helpers for a **future** deletion executor — with a 26-check
> offline regression test. **Nothing was wired to actual deletion; no R2
> object, Firestore document, IAM, secret, or Cron setting was touched
> beyond the one test object (created and deleted).** Four numeric policy
> values (max deletions per run, failure threshold, retry count, grace
> period) are undefined anywhere in this project and were deliberately
> **not** invented — see "F5d-13" below for the full record and the exact
> question this raises for the user.
>
> **Status as of F5d-12 (2026-08-09): COMPLETE — production R2 bucket
> created and bound.** After two earlier stops (no documented production
> bucket name; R2 not yet enabled on the account; a stale-token dead end
> that turned out not to be the real cause), R2 access was confirmed live
> (`wrangler r2 bucket list` succeeded, returning an empty list) and the
> approved bucket **`service-tech-attachments-prod`** was created —
> confirmed to be the only bucket on the account both before and after
> creation. `worker/wrangler.toml`'s `ATTACHMENTS_BUCKET` binding now
> points to it (the dev placeholder `service-tech-attachments-dev` name is
> gone from the real config). The Worker was deployed via the same
> temporary-config technique used in F5d-10/F5d-10.3 to keep `[triggers]`
> out of the deployment — version `9a8b83f2-861d-4700-9b4a-05260c4ee661`,
> 100% traffic. Verified via `wrangler versions view --json`: real
> `["scheduled","fetch"]` code, exactly 5 bindings (the R2 binding
> pointing at `service-tech-attachments-prod`, the 2 plain vars, and the
> same 2 Google service-account secrets — nothing added, nothing
> removed), no routes/custom domains, no Cron trigger anywhere. **No test
> object was created** — the deployed version's binding data from
> Cloudflare's own API is authoritative proof the binding is wired
> correctly, and R2 bindings (unlike the Firestore GCP credential) are
> platform-granted with no separate auth step that could still fail
> despite a correct-looking config. **Cron remains disabled. No public
> access or custom domain was configured on the bucket. Nothing was
> deleted.** See "F5d-12" below for the full record.
>
> **Status as of F5d-11 (2026-08-09): PROVEN SAFE — production retention
> sweep dry run succeeded with zero writes.** Using the real production
> Worker/authentication path (no new credential, no secret change), a
> read-only dry run of the actual retention-sweep logic
> (`runRetentionSweepDryRun()`, sharing the exact same
> `listAttachments()`/`deriveRetentionStatus()` code path as the real
> `runRetentionSweep()`, but never calling `updateRetentionStatus()`) ran
> against real production Firestore: **`{"ok":true,"attachmentsTotal":0,
"aborted":false, ...}`.** `serviceJobAttachments` currently holds 0
> production documents, so an empty result is the expected, correct proof
> — not a failure. All five required boundary conditions (open-job stays
> `active`; >30/=30/<30 days and overdue all resolve correctly) were
> proven offline against the real `deriveRetentionStatus()` function via a
> new regression test, since production has no real data yet to exercise
> them against. A source-level safety check confirms the dry-run path has
> no R2 dependency, no delete operation anywhere in the Firestore client,
> and never references the `serviceJobs` collection. **Cron remains
> disabled and R2 remains unbound/unavailable — this sprint did not touch
> either.** See "F5d-11" below for the full record.
>
> **Status as of F5d-10.3 (2026-08-09): FIXED AND VERIFIED — production
> Firestore access works.** `googleAuth.ts` now normalizes
> `GOOGLE_SERVICE_ACCOUNT_EMAIL` with `.trim()` before using it as the
> JWT's `iss` claim (`normalizeServiceAccountEmail()`, with a regression
> test). `GOOGLE_SERVICE_ACCOUNT_EMAIL` was re-installed with a byte-clean
> value — `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` was **not** touched, and no
> new GCP key was created. The corrected Worker code is deployed (version
> `e15604f6-2e4a-46ba-b210-4626e7393d99`, 100% traffic; no R2 binding, no
> Cron trigger). A safe, read-only production Firestore smoke test — run
> via the same isolated, non-traffic-affecting technique as every prior
> sprint — succeeded: **`{"ok":true,"attachmentCount":0,"sampleDocIds":[]}`.**
> OAuth token exchange succeeded, service-account authentication
> succeeded, and the Worker successfully read the (currently empty)
> `serviceJobAttachments` collection. See "F5d-10.3" below for the full
> record, including two tooling quirks encountered along the way (an
> unexpected reappearance of deleted temp files, and a
> `wrangler secret put` limitation that required
> `wrangler versions secret put` instead). **Cron remains inactive and R2
> remains unbound — this sprint did not touch either.**
>
> **Status as of F5d-10.2 (2026-08-09): CONFIRMED — root cause found, not
> yet fixed.** `GOOGLE_SERVICE_ACCOUNT_EMAIL` contains exactly one
> character of **leading** whitespace (raw length 67, trimmed length 66;
> `raw.trim()` exactly equals the real service-account email). Because
> `googleAuth.ts` uses this value verbatim as the JWT's `iss` claim with no
> trimming, every token request currently sends an `iss` that is not
> byte-identical to the real service account — a precise, confirmed
> explanation for Google's `invalid_grant: "Invalid grant: account not
found"` response. The private key secret was checked too and shows no
> comparable corruption (see "F5d-10.2" below for full detail). **This was
> fixed in F5d-10.3 above.**
>
> **Status as of F5d-10.1 (2026-08-09): diagnosed, not yet fixed.** The
> production Firestore auth failure from F5d-10
> (`invalid_grant: "Invalid grant: account not found"`) has been
> investigated read-only-only — every piece of GCP-side state (service
> account, custom role, IAM binding, key) is independently confirmed exact
> and correct (see "F5d-10.1" below for the full evidence). The leading
> hypothesis was a malformed `GOOGLE_SERVICE_ACCOUNT_EMAIL` Cloudflare
> secret value, combined with `googleAuth.ts` never trimming that value
> before using it as the JWT's `iss` claim — **confirmed correct in
> substance by F5d-10.2 above, though the actual contamination turned out
> to be one leading whitespace character, not the originally-guessed
> trailing one.**
>
> **Status as of F5d-10 (2026-08-08): real Worker code is deployed; the
> production Firestore auth test FAILED.** The Worker `service-tech-files-worker`
> now runs the actual repository code (`fetch` + `scheduled` handlers,
> version `f799d94e-...`, 100% traffic) — no R2 binding and no Cron trigger
> attached to this deploy, both deliberately excluded (see "F5d-10" below
> for why and how). A safe, isolated, non-traffic-affecting smoke test
> against real production Firestore, using the real installed secrets,
> returned **`Google token endpoint returned 400: invalid_grant — "Invalid
grant: account not found"`** — the production service account cannot
> currently authenticate. Per the explicit "prefer read-only first, stop
> rather than improvise" instruction, **no write test was attempted** and
> no further live changes were made to investigate.
>
> Exactly one user-managed key exists for
> `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`
> (created 2026-08-08T16:23:11Z), and its two fields are installed as
> Cloudflare Worker secrets (`GOOGLE_SERVICE_ACCOUNT_EMAIL`,
> `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`). **The local JSON key file was
> deleted immediately after upload and verified gone — no copy exists
> anywhere in this project, `.wrangler/`, or the scratchpad temp
> directory.** See "F5d-9 — Production credential installed" below for
> that full phase-by-phase record.
>
> **Flag from F5d-9, resolved by a follow-up read-only audit:** installing
> the first secret required `wrangler secret put` to auto-create a Worker
> on Cloudflare named `service-tech-files-worker`. A dedicated read-only
> audit (`wrangler versions view --json`, `wrangler deployments
list/status`, `wrangler secret list`) confirmed it is an **empty
> placeholder script** — `handlers: ["fetch"]` only on every version, no
> `scheduled` handler at all (our real `worker/src/index.ts` exports
> both), identical `etag` across all 3 versions (the script content never
> changed, only secrets were layered on), **zero bindings besides the two
> secrets** (no R2 `bindings`, no `routes`, no `custom_domains`, no cron
> `triggers` anywhere in the version resource data). One thing wrangler's
> read-only CLI cannot confirm either way: whether a `workers.dev` public
> URL is reachable — that requires checking the Cloudflare dashboard
> directly (Workers & Pages → `service-tech-files-worker` → Settings).
> Full detail in "F5d-9a — Read-only Cloudflare Worker audit" below.
>
> **What is still NOT true, and must not be assumed by a future session:**
> this Worker has not been deliberately deployed with real
> `worker/src/index.ts` code by any sprint in this sequence; the scheduled
> Cron trigger is not active/confirmed-firing; no R2 object has ever been
> deleted or ever will be by any code in this repository (no delete path
> exists); `firestore.rules` and production Firestore data are untouched.
> Deployment, Cron activation, and any future R2-deletion feature all
> remain separately gated behind their own explicit approval, same as
> every sprint before this one.

## F5d-7 — Live audit (read-only, 2026-08-08)

**Read this before assuming anything below has been done.** Authenticating
`gcloud` only proves a human can now issue commands against the real
project — it is not, by itself, permission for this assistant (or any
future one) to run the creation commands further down this document. Each
of Step 2 (custom role), Step 3 (service account), and Step 4 (IAM
binding) still requires its own separate, explicit go-ahead before
execution, exactly as F5d-6 and F5d-7's specs required.

What F5d-7's audit actually did — entirely `gcloud ... describe`/`list`
calls, nothing that creates, modifies, deletes, deploys, binds, or
generates any resource or credential:

| Check                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcloud auth list`                                                                 | `sacool.spizy@gmail.com` — the project owner's own account, authenticated by the user themselves via `gcloud auth login` (not by this assistant)                                                                                                                                                                                                                                                                                                                                                                                      |
| `gcloud config list`                                                               | No default project set in local `gcloud` config — every command below explicitly passed `--project=luxace-service` rather than relying on an ambient default                                                                                                                                                                                                                                                                                                                                                                          |
| `gcloud projects describe luxace-service`                                          | Project exists, `lifecycleState: ACTIVE`, `projectNumber: 769692662603` — matches `769692662603` already visible in `.env`'s `VITE_FIREBASE_MESSAGING_SENDER_ID`/`VITE_FIREBASE_APP_ID`, cross-confirming this is the same real project the app already uses, not a different one                                                                                                                                                                                                                                                     |
| `gcloud firestore databases list --project=luxace-service`                         | One database, `(default)`, `FIRESTORE_NATIVE`, `locationId: asia-southeast3` — matches `PROJECT_STATE.md`'s documented "asia-southeast3 (Bangkok)"                                                                                                                                                                                                                                                                                                                                                                                    |
| `gcloud projects get-iam-policy luxace-service`                                    | 6 bindings, all either `sacool.spizy@gmail.com` → `roles/owner`, or Firebase's own auto-provisioned service agents (`firebase.managementServiceAgent`, `firebase.sdkAdminServiceAgent`, `firebaserules.system`, `firestore.serviceAgent`, `iam.serviceAccountTokenCreator` on `firebase-adminsdk-fbsvc@...`). **Nothing related to this Worker exists in the policy today.**                                                                                                                                                          |
| `gcloud iam service-accounts list --project=luxace-service`                        | One service account: `firebase-adminsdk-fbsvc@luxace-service.iam.gserviceaccount.com` (Firebase's own default Admin SDK account, auto-created when the Firebase project was set up — unrelated to this Worker). **`firestore-retention-sweeper` does not exist.**                                                                                                                                                                                                                                                                     |
| `gcloud iam roles list --project=luxace-service` (and again with `--show-deleted`) | 0 project-level custom roles, including none soft-deleted. **`firestoreRetentionSweeper` does not exist, and has never existed and been deleted.**                                                                                                                                                                                                                                                                                                                                                                                    |
| `gcloud services list --project=luxace-service --available --filter=...`           | `iam.googleapis.com`: **DISABLED**. `iamcredentials.googleapis.com`: **DISABLED**. `firestore.googleapis.com`: enabled (expected — the app already uses Firestore). `cloudresourcemanager.googleapis.com`: not confirmed via this exact query (the check hung and was killed after ~2 minutes with no clear cause — network hiccup against the full API catalog listing, not a permissions error) — but inferred enabled, since `gcloud projects describe`/`get-iam-policy` above both succeeded, and those calls depend on that API. |

**New finding this sprint: the IAM API (`iam.googleapis.com`) is disabled
on this project.** Custom role creation and service account creation both
require it. Enabling it is itself a project-configuration change and is
not something this audit performed — it would need to happen as its own
explicit step, most likely bundled with Step 2/3's approval rather than as
a separate ask, but flagged here so it isn't a surprise when Step 2 is
actually attempted.

**Net result: the plan in this document exactly matches reality.** Nothing
named `firestoreRetentionSweeper` or `firestore-retention-sweeper` exists
under any name, live or deleted. Creating them still requires: (a)
enabling `iam.googleapis.com`, (b) creating the custom role, (c) creating
the service account, (d) binding the role — four separate live changes,
none performed yet, each still gated on your explicit approval.

## F5d-8 — Proposed live changes (2026-08-08) — awaiting approval

**Nothing in this section has been run.** This is the exact, categorized
proposal presented to the user in chat for F5d-8 — a superset of F5d-7's
audit findings, turned into an actual plan of what to run, still not
executed. It **corrects** F5d-7's speculation that
`iamcredentials.googleapis.com` might be needed later: it is not part of
this proposal and is not part of this architecture at all (see category 1
below for why).

Four separate categories — deliberately kept separate because they have
different blast radii, per the user's explicit request to distinguish them:

| #   | Category                       | What it changes                                                                                                                                                                                         | Grants any access?                                                                                                                                                                                                                                             |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Enable APIs**                | Turns on `iam.googleapis.com` for the project — a feature flag, not a resource. Nothing before this point can create a custom role or service account at all; every later category depends on this one. | No — enabling an API grants no one any permission by itself.                                                                                                                                                                                                   |
| 2   | **Create the custom IAM role** | Defines `firestoreRetentionSweeper` (4 permissions — see "IAM role design" above) as a named role _available_ to bind, project-scoped.                                                                  | No — an unbound role is inert. Nothing can use it yet.                                                                                                                                                                                                         |
| 3   | **Create the service account** | Creates the identity `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`. No key, no binding.                                                                                          | No — an identity with no key can't authenticate as anything, and with no binding has no permissions even if it could.                                                                                                                                          |
| 4   | **Create the IAM binding**     | Attaches category 2's role to category 3's service account in the project's IAM policy.                                                                                                                 | **This is the one that actually matters.** After this, the service account _would_ have get/list/update access to Firestore _if_ it could ever authenticate — but it still can't, because no key exists (explicitly excluded from F5d-8, same as F5d-6/F5d-7). |

Exact commands for all four, plus verification commands to run after
each, are in "Exact commands" below (steps 1–4 there correspond 1:1 to
the four categories above; steps 5–6 there — key creation and `wrangler
secret put` — remain explicitly out of scope for F5d-8, same as every
prior sprint in this sequence).

**Waiting on:** the user's explicit go-ahead in chat, category by category
or in full, before any of these four commands runs. Neither this document
existing, nor F5d-7's audit, nor `gcloud` being authenticated is that
go-ahead.

### Category 1 — executed (2026-08-08), approved explicitly by the user

`gcloud services enable iam.googleapis.com --project=luxace-service` was
run and verified (`gcloud services list --enabled` shows
`iam.googleapis.com: ENABLED`). Categories 2–4 were re-checked immediately
after and confirmed untouched: 0 custom roles, only the pre-existing
`firebase-adminsdk-fbsvc` service account, and the same 6 IAM policy
bindings as F5d-7's audit — no role, no service account, no binding, no
key, no secret, no deploy.

**Unrequested side effect, disclosed rather than hidden:** enabling
`iam.googleapis.com` also auto-enabled `iamcredentials.googleapis.com` —
confirmed via `gcloud services list --enabled`, went from `DISABLED`
(F5d-7) to `ENABLED` without ever being named in the single command that
was run or approved. This appears to be Google Cloud's own dependency
graph (`iamcredentials.googleapis.com` is a known dependent of
`iam.googleapis.com`), not anything this session did deliberately or
could have suppressed with a narrower command. It remains true that this
architecture never calls the IAM Credentials API (see Category 1's
rationale above) — an enabled-but-uncalled API grants no one any access,
the same reasoning already established for why enabling an API alone is
harmless. Left as-is pending the user's own decision on whether to
explicitly disable it; not touched further without a separate go-ahead
either way.

### Category 2 — executed (2026-08-08), approved explicitly by the user

First attempt (`gcloud iam roles create firestoreRetentionSweeper
--project=luxace-service --file=worker/gcp/firestore-retention-sweeper-role.yaml`)
was **rejected by the IAM API**: `INVALID_ARGUMENT: The description
length (314) is longer than the maximum allowed length 300.` Not a
permissions rejection — the four permissions were never evaluated; the
role's `description` field alone was over Google's 300-char limit.
Verified read-only immediately after: 0 roles existed, live or
soft-deleted — the failure was atomic, nothing partial was created. Per
the user's own instruction not to broaden the role automatically, the
description was not silently shortened and retried — a specific
277-character replacement was proposed in chat and explicitly approved
before `worker/gcp/firestore-retention-sweeper-role.yaml` was edited or
the command re-run.

Retry succeeded: `Created role [firestoreRetentionSweeper]`. Verified via
`gcloud iam roles describe firestoreRetentionSweeper --project=luxace-service`
— `includedPermissions` is exactly `datastore.databases.get`,
`datastore.entities.get`, `datastore.entities.list`,
`datastore.entities.update`, no more and no fewer; `title` unchanged
(`Firestore Retention Sweeper (Service Tech Worker)`); `stage: GA`.
Re-confirmed Categories 3–4 untouched immediately after: service accounts
still just the pre-existing `firebase-adminsdk-fbsvc`, IAM policy still
the same 6 bindings as F5d-7/Category 1 — no service account, no binding,
no key, no secret, no deploy.

### Category 3 — executed (2026-08-08), approved explicitly by the user

```bash
gcloud iam service-accounts create firestore-retention-sweeper \
  --project=luxace-service \
  --display-name="Firestore Retention Sweeper" \
  --description="Cloudflare Worker retention-reconciliation sweep. Read+update only, no delete, no R2 access. See worker/PRODUCTION_FIRESTORE_ACCESS.md."
```

Succeeded: `Created service account [firestore-retention-sweeper]`, email
`firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com` —
exactly the name reviewed in Category 3's approval.

Verified:

- `gcloud iam service-accounts describe` — account exists, email exact match, `disabled: false` (implicit — no `disabled` field present).
- `gcloud iam service-accounts keys list --managed-by=user` — **0 items**. This is the check that actually matters for "no key created": it excludes Google's own system-managed keys (which every service account has by default — visible in the unfiltered `keys list`, but internal to Google, never downloadable, not created by any user action, and irrelevant to the "no key" requirement). No user-generated key exists.
- `gcloud projects get-iam-policy ... --filter="bindings.members:firestore-retention-sweeper@..."` — **0 items**. No IAM binding exists yet; this account currently has zero Firestore access (or any access at all).
- Full service account list now shows exactly 2: the pre-existing `firebase-adminsdk-fbsvc` and the new `firestore-retention-sweeper`.
- Full IAM policy bindings unchanged — still the same 6 as Category 1/2, confirming Category 4 was not touched.
- The `firestoreRetentionSweeper` role from Category 2 re-verified intact and unmodified.

### Category 4 — executed (2026-08-08), approved explicitly by the user

```bash
gcloud projects add-iam-policy-binding luxace-service \
  --member="serviceAccount:firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com" \
  --role="projects/luxace-service/roles/firestoreRetentionSweeper"
```

Succeeded: `Updated IAM policy for project [luxace-service]` — the
returned policy shows exactly one new binding, `firestore-retention-sweeper@...`
→ `projects/luxace-service/roles/firestoreRetentionSweeper`, alongside the
same 6 pre-existing bindings, unchanged.

Verified:

- `gcloud projects get-iam-policy ... --filter="bindings.members:firestore-retention-sweeper@..."` — exactly one role: `projects/luxace-service/roles/firestoreRetentionSweeper`. **No additional role was granted to this service account.**
- `gcloud projects get-iam-policy ... --filter="bindings.role:.../firestoreRetentionSweeper"` — exactly one member: `serviceAccount:firestore-retention-sweeper@...`. **No other principal holds this role.**
- Full policy bindings list: now 7 total — the original 6 plus this one. Nothing else changed.
- `gcloud iam roles describe firestoreRetentionSweeper` re-verified: still exactly `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.update` — unmodified by binding it.
- `gcloud iam service-accounts keys list --managed-by=user`: still **0 items** — the service account now has real (bindable) permissions on paper, but still no way to actually authenticate as itself. It is access-configured but functionally inert until a key exists.

**This completes all four F5d-8 categories.** The service account is now
exactly as designed in F5d-6/F5d-7: identity + narrow role + binding, zero
key material anywhere. The only way for it to ever actually do anything is
a private key — which remains its own separate, unapproved, explicitly
out-of-scope step for every sprint so far in this sequence.

## F5d-9 — Production credential installed (2026-08-08), approved explicitly by the user

**Phase 1 (read-only precheck).** Re-verified against live GCP: SA email
exact match, custom role exactly 4 permissions, exactly 1 IAM binding, 0
user-managed keys, `googleAuth.ts:135` confirmed both
`GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
are required together, fresh `npm run build` + bundle grep for
credential-shaped strings — 0 matches. All matched the approved F5d-8
end state; nothing differed.

**Blocker found and resolved before Phase 2:** `wrangler whoami` showed no
Cloudflare authentication — `wrangler secret put` needs it, same category
of gap as F5d-7's `gcloud` situation. Stopped, asked the user, the user
ran `wrangler login` themselves (interactive OAuth into their own
Cloudflare account — not performed by this assistant), confirmed via a
fresh `wrangler whoami` before proceeding.

**Phase 2 (create key).**

```bash
gcloud iam service-accounts keys create <scratchpad-path>/firestore-retention-sweeper-key.json \
  --iam-account=firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com --project=luxace-service
```

Created key ID `d88a48de...4733c0` (truncated here deliberately — full ID
is non-secret and available via `gcloud iam service-accounts keys list`,
but truncating it in this doc avoids habituating "paste identifiers from
this file into chat" as a pattern). Written to the session's isolated
scratchpad temp directory — **never** into `worker/`, the project root, or
`.wrangler/`. Inspected only the safe fields (`project_id`,
`client_email`, and a boolean/length check that `private_key` was
present) — the actual key value was never printed to any terminal output
or chat message at any point.

**Phase 3 (install Cloudflare secrets).** Both fields piped directly from
the parsed JSON into `wrangler secret put`'s stdin (`$json.client_email |
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL`, same pattern for
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) — the value never appeared as a
literal in any command string or output. Both succeeded. `wrangler secret
list` (names only, not values) confirms exactly these two secrets exist.
`FIRESTORE_PROJECT_ID` needed no secret — it's already a public
`wrangler.toml` `[vars]` entry.

**Unresolved flag from this phase — read before assuming deploy status:**
the first `wrangler secret put` call reported _"There doesn't seem to be a
Worker called 'service-tech-files-worker'. Do you want to create a new
Worker with that name and add secrets to it?"_ and auto-answered yes in
this non-interactive session, then _"Creating new Worker
'service-tech-files-worker'..."_. `wrangler deployments list` afterward
shows three real deployment/version events, the first one tagged `Source:
Upload` / `Message: Automatic deployment on upload` — i.e. this was not
merely an empty secret container; wrangler pushed _something_ to create
it. **This assistant did not run `wrangler deploy` and did not choose
this outcome** — it is wrangler's own required behavior for attaching a
secret to a Worker name that doesn't exist yet, and there was no way to
complete the explicitly-approved secret installation without triggering
it. What code is actually live at that Worker (almost certainly an empty
placeholder stub, not `worker/src/index.ts`'s real logic — untested), and
whether it's publicly reachable via a `workers.dev` subdomain, has **not**
been independently confirmed. No remediation (disabling the Worker,
checking its live behavior, etc.) was attempted without asking first.
Check the Cloudflare dashboard (Workers & Pages) directly for ground
truth.

**Phase 4 (destroy local key material).** Deleted the scratchpad JSON key
file immediately after both secret uploads confirmed success; verified
gone (`test -f` → not found). Searched the entire project tree for the
filename (0 matches), for `BEGIN PRIVATE KEY` outside `node_modules` (5
matches — all confirmed to be the literal PEM-delimiter _string_ inside
`googleAuth.ts`'s parsing regex and its compiled `.wrangler/tmp/dev-*`
bundle artifacts from earlier local emulator sessions, not real key
material), and listed the scratchpad directory directly to confirm no
stray copy. `worker/.dev.vars` still doesn't exist. Project is still not
a git repository, so no git-tracked-file risk applies.

**Phase 5 (verify GCP key state).** `gcloud iam service-accounts keys list
--managed-by=user` — exactly 1 key (the one created in Phase 2, matching
its `private_key_id`). No additional key was created. Value never
exposed.

**Phase 6 (validation).** Worker `tsc`, main app `tsc`, ESLint, Prettier,
production build — all clean (no source code changed this sprint). Fresh
bundle grep for `GOOGLE_SERVICE_ACCOUNT`, `BEGIN PRIVATE KEY`, the SA
email, the role name, and the key ID — 0 matches in `dist/`.

**What remains explicitly not approved:** deliberately deploying
`worker/src/index.ts`'s real code to this now-existing Worker, enabling
the live Cron, and any R2-deletion feature (which doesn't exist in the
codebase at all). None of these were touched.

## F5d-9a — Read-only Cloudflare Worker audit (2026-08-08)

Follow-up to F5d-9's disclosed flag, requested explicitly by the user as a
read-only-only sprint. Every command below is a `list`/`view`/`status`
read; nothing was deployed, updated, deleted, or modified.

**Existence and version status.** `wrangler deployments status` /
`wrangler deployments list`: the Worker `service-tech-files-worker`
exists, currently at version `84c4d743-3ebf-46c9-bc18-41c7c9ae9194`
(version number 3, 100% traffic). Full history is exactly 3 versions, all
`author: sacool.spizy@gmail.com`, all `last_deployed_from: wrangler`
(auto-generated, not a manual `wrangler deploy`):

1. `7b95efc5...` — `triggered_by: upload` — the auto-created placeholder script, 0 bindings.
2. `c8aabfc1...` — `triggered_by: secret` — `GOOGLE_SERVICE_ACCOUNT_EMAIL` added.
3. `84c4d743...` — `triggered_by: secret` — `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` added.

**Script identity — confirmed placeholder, not our code.**
`wrangler versions view <id> --json` on versions 1 and 3: `etag` is
**identical** (`3adc2d44...bc2571`) across every version — the actual
script bytes never changed, only bindings were added on top. `handlers:
["fetch"]` on every version, with **no `scheduled` handler at any point**
— our real `worker/src/index.ts` exports both `fetch` and `scheduled`
(see `index.ts:140` and `:153`), so this is conclusively not that code.
It's the minimal stub Cloudflare/wrangler generates automatically to have
something to attach a secret to.

**Bindings — exactly the two secrets, nothing else.** Version 3's
`resources.bindings`: exactly
`[{name: GOOGLE_SERVICE_ACCOUNT_EMAIL, type: secret_text}, {name:
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, type: secret_text}]`. **No R2
binding** (`ATTACHMENTS_BUCKET` or otherwise) — confirmed both by this
JSON and by there being no `r2_bucket`-typed entry anywhere. `wrangler
secret list` independently confirms the same two secret names, no others.

**Routes, custom domains, Cron triggers — none present.** The version
resource JSON has no `routes`, `custom_domains`, or `triggers`/`crons`
key anywhere in its `resources` object for any version. Consistent with
never having run `wrangler deploy` (the command that would normally read
`wrangler.toml`'s `[triggers] crons` and push it) — this Worker was never
touched by that command.

**Public reachability (`workers.dev`) — not resolvable via read-only CLI,
genuinely unknown from this session.** Wrangler's CLI has no read-only
command that reports whether the account's `workers.dev` subdomain
routing is enabled for this script; that's normally reported by `wrangler
deploy` itself (not run here) or visible directly in the dashboard. **This
is the one open question from this audit** — check Workers & Pages →
`service-tech-files-worker` → Settings → Domains & Routes in the
Cloudflare dashboard for a definitive answer.

**No other Cloudflare resources.** Nothing in this project's command
history (this sprint or any prior one) has created an R2 bucket, KV
namespace, D1 database, queue, or any other Cloudflare resource — the
`service-tech-attachments-dev` R2 bucket named in `wrangler.toml` remains
a placeholder that has never been provisioned for real (see
`worker/README.md`'s "How local dev works").

**Net assessment:** this Worker is, as best this audit can determine,
functionally inert — a bare `fetch`-only stub holding two secrets, no R2
access, no scheduled execution capability, no configured routes. The one
remaining unknown is whether it's reachable at a public `workers.dev` URL
at all; even if it is, the stub script has no logic that could touch R2,
Firestore, or do anything with the secrets it holds — those secrets are
inert until `worker/src/index.ts`'s real code is deliberately deployed
over this placeholder, which remains a separate, unapproved, explicitly
gated step.

## F5d-10 — Real Worker deployed; production Firestore auth FAILED (2026-08-08)

### Preflight findings

- Worker name, secret names (`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`_PRIVATE_KEY`,
  no others), `worker/src/index.ts` exporting both `fetch` and
  `scheduled`, Worker `tsc` — all confirmed clean before deploying.
- **Two real conflicts found and resolved before deploying:**
  1. `wrangler.toml`'s `[triggers] crons = ["0 3 * * *"]` would activate a
     live Cron on a normal `wrangler deploy` — directly against this
     sprint's "do not enable Cron" boundary.
  2. `wrangler r2 bucket list` → `ERROR: Please enable R2 through the
Cloudflare Dashboard. [code: 10042]` — **R2 itself isn't enabled on
     this Cloudflare account**, not just missing the specific bucket.
     Deploying with `[[r2_buckets]]` intact would very likely fail the
     _entire_ deployment (Cloudflare validates bindings at deploy time).
     Stopped and asked the user rather than guessing; the user chose to
     deploy without the R2 binding for now.

### Deploy — how Cron and R2 were excluded without touching the real config

Created a temporary file, `worker/.wrangler-deploy-f5d10.toml` (same
directory as the real config, so `main = "src/index.ts"` resolves
identically), containing only `name`/`main`/`compatibility_date`/`[vars]`
— no `[[r2_buckets]]`, no `[triggers]`. Ran
`wrangler deploy -c .wrangler-deploy-f5d10.toml --keep-vars`, then deleted
the temp file immediately. **The real `worker/wrangler.toml` was never
edited** — re-read and confirmed byte-for-byte identical to before the
deploy, including its still-present (but now genuinely inert, since this
deploy didn't reference it) `[triggers]`/`[[r2_buckets]]` sections.

**Disclosed side effect:** the deploy warned `Because 'workers_dev' is
not in your Wrangler file, it will be enabled for this deployment by
default`, producing a real public URL:
`https://service-tech-files-worker.sacool-spizy.workers.dev`. This wasn't
explicitly discussed beforehand — flagging it now. Impact is limited: the
`/files/*` endpoints will 500 (no R2 binding), `/health` is harmless, and
there is no HTTP-reachable path to Firestore or the retention sweep (only
`scheduled()` touches Firestore, and it isn't reachable via `fetch()`).
Still worth the user's awareness given `worker/README.md`'s own
"Security posture" section already flags this Worker as unauthenticated.

### Post-deployment verification (`wrangler versions view <id> --json`)

Version `f799d94e-5095-49a5-a05e-125239199715`, 100% traffic:

- `handlers: ["scheduled", "fetch"]` — **the real code, both handlers.**
- `bindings`: `ALLOWED_ORIGINS` (plain_text), `FIRESTORE_PROJECT_ID`
  (plain_text), `GOOGLE_SERVICE_ACCOUNT_EMAIL` (secret_text),
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (secret_text) — **no R2 binding**,
  secrets survived the deploy intact.
- No `routes`, `custom_domains`, or `triggers`/`crons` anywhere in the
  resource data — **no Cron trigger activated.**
- `wrangler secret list` re-confirms exactly the same two secret names,
  no others.

### Production Firestore smoke test — FAILED

**Why the obvious approach (`--test-scheduled`) was rejected:** the only
code path that touches Firestore is `scheduled()` → `runRetentionSweep()`,
which can write (`updateRetentionStatus`) if any real record's computed
status differs from its stored one. The sprint boundary explicitly said
not to run the full sweep — so this was never attempted.

**What was tried instead — twice, refining as the first attempt proved
unreliable:**

1. `wrangler dev --remote` with a temporary, git-untracked, read-only-only
   entry file (`.diag-firestore-check.ts` — never imported by
   `index.ts`, never deployed) that calls only
   `firestoreClient.ts`'s `listAttachments()`, never
   `updateRetentionStatus()`. Result: `invalid_grant: account not found`.
   Distrusted this result — remote-dev's secret handling isn't guaranteed
   to reflect the real deployed Worker's Cloudflare-injected secret
   values, so a negative result here isn't conclusive either way.
2. **The trustworthy version:** `wrangler versions upload` with the same
   temporary read-only entry — this uploads a real version to Cloudflare
   (genuinely holds the real, Cloudflare-injected secret, same as any
   other version) but does **not** shift production traffic; it gets its
   own isolated Preview URL and the currently-live version keeps serving
   100% of real traffic throughout. Uploaded version
   `e5ac9841-3e1c-466a-a33e-238ff57a717c`, preview URL
   `https://e5ac9841-service-tech-files-worker.sacool-spizy.workers.dev`.
   `curl`ing it returned:
   ```json
   {
     "ok": false,
     "errorMessage": "Google token endpoint returned 400: {\"error\":\"invalid_grant\",\"error_description\":\"Invalid grant: account not found\"}"
   }
   ```
   This is the real, trustworthy result — genuine Cloudflare-hosted
   execution, real secret values, real Google OAuth2 endpoint. **The
   production service account cannot currently authenticate.**

**No secret value, private key, OAuth token, or Authorization header was
ever printed** at any point in either attempt — only this sanitized error
message (which itself contains no credential material — Google's OAuth
error bodies never echo back the failed assertion or key).

**Verified this had zero effect on production traffic:** `wrangler
deployments status` re-checked immediately after — still 100% on
`f799d94e...`, the clean deploy. The preview-only version
(`e5ac9841...`) never received any real traffic; it's inert except at its
own hard-to-guess preview URL.

**Per the explicit instruction to prefer read-only first and stop rather
than improvise:** since the read/auth test failed, no write test was
attempted — there is nothing to safely test-write against without a
working authentication path first, and inventing one would be exactly
the "improvising" this sprint said not to do.

### Cleanup

Both temporary files (`worker/src/.diag-firestore-check.ts`,
`worker/.wrangler-diag-f5d10.toml`) deleted immediately after the test;
confirmed absent. `worker/src/index.ts` and `worker/wrangler.toml` were
never modified by any part of this sprint — only read and (for
`wrangler.toml`) worked around via a separate temporary file for the
deploy step.

### Hypotheses for the auth failure — not confirmed, offered for the user's next step

- **Most likely: propagation delay.** Newly created GCP service accounts/
  keys are occasionally slow (documented Google behavior, sometimes
  minutes) to become fully usable for OAuth2 token exchange across all of
  Google's auth infrastructure, even though `gcloud` itself already shows
  the account/key/binding as fully created. F5d-9's key was created
  2026-08-08T16:23:11Z; this test ran roughly 2.5 hours later in wall-clock
  terms across this conversation, which argues against pure propagation
  delay — but Google's exact SLA here isn't publicly guaranteed, so it
  remains possible, especially if something in between (e.g. a key
  rotation event) reset propagation state, which nothing in this project's
  history should have done.
- **Possible: a value-transfer issue with the secret itself.** The private
  key was piped from a parsed JSON file directly into
  `wrangler secret put`'s stdin via PowerShell — believed correct and
  consistent with documented CI patterns, but not independently verified
  byte-for-byte against the original (deliberately, since doing so would
  require printing/comparing the secret value, which this sprint's
  security rules forbid). A subtle corruption (line-ending change,
  truncation) during that transfer is possible, though the equivalent
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` transfer used the identical technique and
  is a plain string, less prone to corruption — if the email itself is
  intact, that narrows suspicion toward the multi-line private key
  specifically.
- **Not yet ruled out:** something specific to "account not found" as
  opposed to "invalid signature" points at the `iss` (issuer) claim not
  resolving to a real, currently-recognized account from Google's
  perspective at request time — worth an independent `gcloud`-side check
  (e.g. re-describing the service account, confirming the key ID is still
  listed as active) before assuming the Cloudflare-side secret is at
  fault.

None of these were investigated further this sprint — doing so would mean
either creating another key (explicitly excluded from F5d-10's scope) or
more live testing, both of which need their own approval.

## F5d-10.1 — Diagnose the auth failure (read-only, 2026-08-09)

**Everything in this section is a `describe`/`list` read or a source-code
review. Nothing was created, deleted, modified, deployed, or rotated.** No
new service-account key, no secret change, no `wrangler secret put`, no
`wrangler deploy`, no IAM change, no R2/Cron change, no Firestore rules or
data change.

### Check 1 — GCP identity, read-only

`gcloud iam service-accounts describe firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com --project=luxace-service`:

| Field      | Value                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email      | `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com` — exact match to every other reference in this document                         |
| Exists     | Yes                                                                                                                                                  |
| Disabled   | No `disabled` field present in the describe output — per GCP's own API convention this means the account is enabled, consistent with F5d-8's finding |
| `uniqueId` | `101673463910811035695`                                                                                                                              |

`gcloud iam service-accounts keys list --iam-account=... --managed-by=user`:

| Field             | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Key count         | Exactly 1                                                                                |
| Key resource      | `.../keys/d88a48de94db6734b0c1ec33aa20b2ccf36fc841`                                      |
| `keyType`         | `USER_MANAGED`                                                                           |
| `keyOrigin`       | `GOOGLE_PROVIDED`                                                                        |
| `keyAlgorithm`    | `KEY_ALG_RSA_2048`                                                                       |
| `validAfterTime`  | `2026-08-08T16:23:11Z` — **exact match** to F5d-9 Phase 2's logged creation time         |
| `validBeforeTime` | `9999-12-31T23:59:59Z` (no expiry — normal; user-managed keys don't expire on their own) |

The private key value itself was never read or printed — only these
non-sensitive metadata fields.

**Minor documentation note, not a finding:** F5d-9's write-up truncated
the key ID as `d88a48de...4733c0`; the real full ID (confirmed above) ends
`...36fc841`. Both share the same `d88a48de` prefix and there is exactly
one user-managed key on this service account, so this is a transcription
slip in the earlier doc, not evidence of a second/replaced key.

### Check 2 — IAM, read-only

- `gcloud iam roles describe firestoreRetentionSweeper --project=luxace-service`
  → `includedPermissions` is exactly `datastore.databases.get`,
  `datastore.entities.get`, `datastore.entities.list`,
  `datastore.entities.update` — no more, no fewer. Unchanged since F5d-8.
- `gcloud projects get-iam-policy luxace-service --filter="bindings.members:firestore-retention-sweeper@..."`
  → exactly one role bound: `projects/luxace-service/roles/firestoreRetentionSweeper`.
  **No additional project-level role of any kind** is granted to this
  service account.

### Check 3 — Worker authentication implementation, source review

Re-read `worker/src/googleAuth.ts`, `worker/src/firestoreClient.ts`,
`worker/src/env.ts` in full.

| Item                                                | Finding                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token endpoint                                      | `https://oauth2.googleapis.com/token` (`DEFAULT_TOKEN_ENDPOINT`), overridable only by `GOOGLE_TOKEN_ENDPOINT` — unset in this project, so the real Google endpoint is always used. Correct.                                                                                                                                                                                               |
| `iss` claim                                         | `env.GOOGLE_SERVICE_ACCOUNT_EMAIL`, used **verbatim, with no `.trim()` or sanitization anywhere in `googleAuth.ts`**.                                                                                                                                                                                                                                                                     |
| `aud` claim                                         | The token endpoint URL itself — correct per RFC 7523 / Google's own JWT-bearer flow documentation.                                                                                                                                                                                                                                                                                        |
| `scope` claim                                       | `https://www.googleapis.com/auth/datastore` — correct for Firestore REST access.                                                                                                                                                                                                                                                                                                          |
| `iat`/`exp`                                         | `iat = now`, `exp = iat + 3600` (1 hour) — standard, no clock-skew red flags in the code itself.                                                                                                                                                                                                                                                                                          |
| Private-key parsing                                 | `importPrivateKey()` strips `-----BEGIN/END PRIVATE KEY-----` and **all whitespace** (`.replace(/\s+/g, '')`) before base64-decoding to DER and importing as `pkcs8`/`RSASSA-PKCS1-v1_5`/SHA-256. **This means PEM line-ending differences (CRLF vs LF, literal vs escaped `\n`) cannot corrupt the key material** — every whitespace character, of any kind, is removed before decoding. |
| RSA algorithm                                       | `RSASSA-PKCS1-v1_5` with SHA-256 — matches the key's `keyAlgorithm: KEY_ALG_RSA_2048` from Check 1 and is the algorithm Google's token endpoint expects for service-account JWTs.                                                                                                                                                                                                         |
| Could the JWT identify a different service account? | No secondary/fallback email exists anywhere in the Env type or code — `GOOGLE_SERVICE_ACCOUNT_EMAIL` is the only source for `iss`, and Check 4 (below) found no stale or conflicting email anywhere in the codebase.                                                                                                                                                                      |

**The one gap found:** `env.GOOGLE_SERVICE_ACCOUNT_EMAIL` is used directly
as the `iss` claim with **no trimming**. If the Cloudflare secret's stored
value contains so much as one trailing newline or space character, the
resulting `iss` string would not be byte-identical to the real service
account email — see "Ranked diagnosis" below for why this matters.

No private key, JWT assertion, access token, or Authorization header was
printed at any point in this review.

### Check 4 — Configuration identity cross-check

- GCP project: `luxace-service`, `projectNumber: 769692662603`,
  `lifecycleState: ACTIVE` (`gcloud projects describe`) — matches
  `wrangler.toml`'s `FIRESTORE_PROJECT_ID = "luxace-service"` and the
  project number already cross-confirmed against `.env`'s Firebase config
  in F5d-7.
- Service account email domain (`@luxace-service.iam.gserviceaccount.com`)
  belongs to the same project.
- Grepped the entire repo for `iam.gserviceaccount.com` and for
  `GOOGLE_SERVICE_ACCOUNT`/`GOOGLE_TOKEN_ENDPOINT`/`FIRESTORE_PROJECT_ID`
  references: the only service-account emails anywhere are (a)
  `firestore-retention-sweeper@...` (this Worker's intended identity,
  referenced consistently everywhere) and (b) the pre-existing, unrelated
  `firebase-adminsdk-fbsvc@...` (Firebase's own auto-created default
  Admin SDK account, already correctly identified as unrelated back in
  F5d-7). **No stale or conflicting service-account email exists in
  source, config, or docs.**

### Check 5 — Key metadata correlation

- The single user-managed key (Check 1) unambiguously belongs to
  `firestore-retention-sweeper@...` — it's returned by a `keys list`
  scoped to exactly that `--iam-account`.
- `validAfterTime: 2026-08-08T16:23:11Z` is an exact match to F5d-9 Phase
  2's logged creation timestamp — this is the same key created that
  sprint, not a different one.
- GCP's service-account key API has no separate "ACTIVE/DISABLED" status
  field for individual keys (unlike service accounts themselves) — a key
  either exists (as this one does, returned by `keys list`) or has been
  deleted (it would simply be absent). Its presence in this read-only list
  is itself the confirmation that it has not been deleted or replaced.
- No second key, past or present, was found anywhere (F5d-8 and F5d-9 both
  independently confirmed 0 keys before this one was created; this check
  confirms exactly 1 now) — no evidence of any rotation or replacement
  event.

### Check 6 — Ranked diagnosis

1. **Most likely: the `GOOGLE_SERVICE_ACCOUNT_EMAIL` Cloudflare secret
   contains trailing whitespace/newline contamination, and the Worker
   never trims it before using it as the JWT `iss` claim.** F5d-9 Phase 3
   installed both secrets via
   `$json.client_email | wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL`
   (and the equivalent for the private key) — piping a single-line
   PowerShell string object into a native executable's stdin is
   well-documented to append a trailing line terminator to what the child
   process receives. Check 3 confirms `googleAuth.ts` applies **zero**
   trimming or sanitization to `GOOGLE_SERVICE_ACCOUNT_EMAIL` before
   embedding it verbatim as `iss`. A single stray trailing character
   there means the JWT's `iss` is no longer byte-identical to the real
   `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com` —
   which is a precise fit for Google's error text: **"account not found"**
   describes a failed _lookup_ of the account named in the token, as
   opposed to "Invalid JWT signature" (a wrong-key error) or a
   clock-skew-specific message (neither of which is what was returned).
   This also fits why the private key is comparatively _less_ suspect for
   the same failure mode: `importPrivateKey()` strips **all** whitespace
   before decoding (Check 3), so an equivalent trailing-newline artifact
   in the private-key secret would have no effect on the actual signing
   key bytes — but nothing strips whitespace from the email.
2. **Possible but less likely: real corruption of the private key's
   non-whitespace bytes** during the same stdin-pipe transfer (e.g. a
   character substitution, not just an added newline). This would more
   typically surface as a signature-verification failure
   ("Invalid JWT Signature") rather than "account not found," which makes
   it a weaker fit for the specific error observed — but it cannot be
   ruled out without recreating the key, which is out of scope for this
   sprint.
3. **Effectively ruled out: GCP-side propagation delay.** This was F5d-10's
   leading hypothesis, offered when the smoke test ran ~2.5 hours after
   key creation. This diagnostic sprint runs roughly a day after that same
   key creation (`2026-08-08T16:23:11Z`), and every piece of GCP state
   checked above (service account, key, role, binding) is independently
   confirmed correct and stable. Google's documented propagation windows
   for new service accounts/keys are on the order of minutes, not most of
   a day — this explanation no longer fits the timeline.

**This has not been confirmed** — confirming hypothesis 1 without
violating the "never print a secret value" rule would require a
non-destructive check (e.g., a temporary read-only diagnostic endpoint
that reports only `GOOGLE_SERVICE_ACCOUNT_EMAIL`'s length and whether it's
equal to its own `.trim()`, never the string itself), delivered the same
way F5d-10's smoke test was — which still means putting a new version on
Cloudflare. F5d-10.1's scope explicitly listed "deploy the Worker" as
prohibited, so that check was **not** performed this sprint, even though
it would be non-traffic-affecting the same way F5d-10's `wrangler versions
upload` smoke test was.

### Exact next action required (not performed — needs separate approval)

Two independent options, either of which would confirm or rule out
hypothesis 1 without exposing any secret value:

- **Code fix + retest (most direct):** add `.trim()` to
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` (and defensively to
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, even though Check 3 shows it's not
  at risk from whitespace) in `googleAuth.ts`, deploy, and rerun the same
  read-only Firestore smoke test methodology F5d-10 used
  (`wrangler versions upload`, isolated preview URL, `listAttachments()`
  only). This is a source change plus a deploy — both need their own
  explicit go-ahead, same as every prior live step in this sequence.
- **Diagnostic-only (no code change to the real auth path):** a temporary,
  git-untracked entry point (same pattern as F5d-10's
  `.diag-firestore-check.ts`) that reports only
  `GOOGLE_SERVICE_ACCOUNT_EMAIL.length` and
  `GOOGLE_SERVICE_ACCOUNT_EMAIL === GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()`
  (a boolean), delivered via `wrangler versions upload` to an isolated
  preview URL exactly as before — confirms or refutes hypothesis 1 without
  ever printing the email itself or touching production traffic. Also
  needs separate approval, since it's still a new Cloudflare version.

Neither of these was performed this sprint. **No infrastructure was
changed by F5d-10.1** — this was a read-only audit and a source-code
review only.

## F5d-10.2 — Confirm Cloudflare secret formatting (read-only, 2026-08-09)

**Everything in this section is a read-only structural check performed
inside an isolated, non-traffic-affecting Cloudflare Worker version. No
secret was changed, no `wrangler secret put`/`delete` was run, no GCP key
was created/rotated/deleted, no IAM/R2/Cron/Firestore-rules/Firestore-data
change was made, and the deployed version never received production
traffic.**

### Method

F5d-10.1 established that the only way to inspect a Cloudflare secret's
actual runtime value (even just its length/whitespace, never its content)
is to run code inside the Worker runtime — `wrangler secret list` only
ever exposes secret _names_. This sprint's own scope explicitly authorized
exactly that, via "an isolated diagnostic version" that must not become
the live 100%-traffic version.

Built a temporary, git-untracked entry point,
`worker/src/.diag-secret-check.ts` — never imported by `index.ts`, no
Firestore call, no R2 call, no scheduled handler. It read
`env.GOOGLE_SERVICE_ACCOUNT_EMAIL` and `env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
and returned **only** the safe structural fields specified in this
sprint's brief (lengths, whitespace booleans, a match-after-trim boolean,
PEM-delimiter-after-trim booleans) — never the values themselves, never a
substring, never a JWT/token/Authorization header.

Paired with a temporary config, `worker/.wrangler-diag-f5d10-2.toml`
(`name`/`main`/`compatibility_date`/`[vars] FIRESTORE_PROJECT_ID` only — no
`[[r2_buckets]]`, no `[triggers]`), used with
`wrangler versions upload -c .wrangler-diag-f5d10-2.toml` — this is the
same mechanism F5d-10's smoke test used: it creates a real Cloudflare
version with the genuine, Cloudflare-injected secret values, but does
**not** shift production traffic. It received its own isolated preview
URL (`https://09f7ba08-service-tech-files-worker.sacool-spizy.workers.dev`),
queried once via `curl`, and both temporary files were deleted immediately
after. `wrangler deployments status`, re-checked afterward, confirmed
production traffic never moved off the existing clean version
(`f799d94e-5095-49a5-a05e-125239199715`, still 100%).

### Result

```json
{
  "emailCheck": {
    "present": true,
    "rawLength": 67,
    "trimmedLength": 66,
    "lengthDiff": 1,
    "isTrimClean": false,
    "hasLeadingWhitespace": true,
    "hasTrailingWhitespace": false,
    "trimmedMatchesExpected": true
  },
  "keyCheck": {
    "present": true,
    "nonEmpty": true,
    "rawLength": 1704,
    "normalizedLength": 1624,
    "wholeValueTrimEqualsRaw": false,
    "beginsWithPemHeaderAfterTrim": true,
    "endsWithPemFooterAfterTrim": true
  }
}
```

No part of this output contains the secret value itself, a partial
value, first/last characters, a JWT, a token, or an Authorization header
— only lengths and booleans, exactly as this sprint's brief required.

### Conclusion: A) CONFIRMED — email secret contains formatting contamination

`GOOGLE_SERVICE_ACCOUNT_EMAIL`'s raw value is **67 characters, one
character longer than its trimmed form (66)**, and that one character is
**leading** whitespace (`hasLeadingWhitespace: true`,
`hasTrailingWhitespace: false`) — the opposite end from F5d-10.1's
original guess (trailing, from the PowerShell-stdin-pipe theory), though
the underlying mechanism (a pipe-related artifact from F5d-9's secret
installation) is the same category of cause. Critically,
**`trimmedMatchesExpected: true`** — stripping that one character produces
exactly `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`,
the real, correct service account email confirmed independently via
`gcloud` in F5d-10.1's Check 1.

This directly and precisely explains the production failure.
`googleAuth.ts`'s `signServiceAccountAssertion()` uses
`env.GOOGLE_SERVICE_ACCOUNT_EMAIL` verbatim as the JWT's `iss` claim, with
no `.trim()` anywhere in the code path (confirmed in F5d-10.1's Check 3).
Every token request this Worker has ever made against real production
Firestore has therefore sent an `iss` claim of
`" firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com"`
(one leading whitespace character, value not reproduced verbatim here
beyond what's needed to state the finding) — which is **not**
byte-identical to any service account Google actually has on file. Google
's OAuth2 token endpoint resolves `iss` by exact string lookup; a
one-character mismatch at the start of that string is exactly the kind of
input that produces **`invalid_grant: "Invalid grant: account not
found"`** — a failed _account lookup_, not a signature or permissions
error, matching everything observed since F5d-10.

**The private key shows no comparable evidence of corruption.**
`normalizedLength: 1624` (the fully-whitespace-and-delimiter-stripped
base64 payload actually fed to `crypto.subtle.importKey`) is consistent
with a standard 2048-bit RSA PKCS8 key — matching the key's own
`keyAlgorithm: KEY_ALG_RSA_2048` metadata from F5d-10.1's Check 1 — and
both `beginsWithPemHeaderAfterTrim`/`endsWithPemFooterAfterTrim` are
`true`, confirming the PEM delimiters are intact at both ends after
trimming the whole blob. `wholeValueTrimEqualsRaw: false` shows the raw
secret does carry some surrounding whitespace too (consistent with the
same installation method), but — as already established in F5d-10.1's
Check 3 — `importPrivateKey()` strips **all** whitespace unconditionally
before decoding, so this is provably harmless to the actual signing key
material, unlike the untrimmed email.

### What was NOT changed

- No Cloudflare secret was read, printed, modified, or deleted.
- No `wrangler secret put`/`wrangler secret delete` was run.
- No GCP service-account key was created, rotated, or deleted.
- No IAM role or binding was changed.
- No R2 resource was enabled, created, or modified.
- No Cron trigger was enabled.
- No `firestore.rules` or production Firestore document was touched.
- Production traffic remained on version `f799d94e-...` throughout,
  confirmed via `wrangler deployments status` both before and after.
- Both temporary files (`worker/src/.diag-secret-check.ts`,
  `worker/.wrangler-diag-f5d10-2.toml`) were deleted immediately after use
  and confirmed absent.

### Next step (not performed — needs separate approval)

Root cause is now confirmed, not merely suspected. The fix itself — most
directly, re-installing `GOOGLE_SERVICE_ACCOUNT_EMAIL` via
`wrangler secret put` with a cleanly-trimmed value (and defensively adding
`.trim()` in `googleAuth.ts` so future secret installations can't
reintroduce this class of bug) — was **not** applied this sprint. That is
a secret change plus a source change plus a redeploy plus a retest, each
requiring its own explicit go-ahead, exactly like every other live step in
this sequence.

## F5d-10.3 — Fix confirmed formatting bug (2026-08-09)

**Scope executed: exactly the fix, and nothing else.** JWT algorithm,
private-key handling, OAuth endpoint, scopes, IAM permissions, the
Firestore client, and the retention logic were not touched. No new GCP
key was created. `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` was not modified.

### 1. Code fix

`worker/src/googleAuth.ts` gained a small, exported, pure function:

```ts
export function normalizeServiceAccountEmail(email: string): string {
  return email.trim();
}
```

`getAccessToken()` now calls
`normalizeServiceAccountEmail(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)` at the one
point this value is passed into `signServiceAccountAssertion()` (and from
there into the JWT's `iss` claim), instead of using the raw env value
directly. This protects against the whole class of bug F5d-10.2 found —
not just the one incident — should a future secret installation
reintroduce stray whitespace.

**Regression test added**, matching this repo's existing "no test
framework, plain Node script" convention (`test/smoke.mjs`):
`worker/test/googleAuthEmailNormalization.test.mts`, runnable directly by
Node (this environment's Node 24 executes `.ts`/`.mts` natively, no
transpilation step or new dependency needed) via the new `npm test`
script. Six checks: leading whitespace stripped (the exact F5d-10.2
contamination), trailing whitespace stripped, both at once, a tab
character, an already-clean value round-trips unchanged, and — to keep
the function's contract precise — internal whitespace is deliberately
left alone. All six passed.

### 2. Cloudflare secret

**Only `GOOGLE_SERVICE_ACCOUNT_EMAIL` was re-installed.**
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` was never read, printed, or changed.
No new GCP key was created or requested — same single key from F5d-9
(`.../keys/d88a48de94db6734b0c1ec33aa20b2ccf36fc841`) remains the only one
in use, re-verified unchanged throughout this sprint.

The value was piped via `printf '%s' '<email>' | wrangler ...` rather than
the PowerShell object-pipe technique that most likely produced the
original contamination — `printf '%s'` writes the exact bytes given, with
no implicit trailing newline and no object-formatting layer in between.

**Tooling note:** the plain `wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL`
command was rejected — `Secret edit failed. You attempted to modify a
secret, but the latest version of your Worker isn't currently deployed.`
This is Cloudflare's own safeguard: the most recently _uploaded_ version
was F5d-10.2's read-only diagnostic (correctly never deployed to
production traffic), and `wrangler secret put`'s classic flow refuses to
implicitly bundle a secret change with an undeployed version. Used
`wrangler versions secret put GOOGLE_SERVICE_ACCOUNT_EMAIL` instead — this
updates the secret and creates a new version (`51c59bed-9def-4ae2-8a99-86e6ae9347af`)
**without deploying it**, cleanly separating "fix the secret" from
"deploy the code," exactly matching this sprint's step ordering.

### 3. Validation (before any deploy)

- Worker `tsc --noEmit`: clean.
- `npm test` (the new regression test): 6/6 passed.
- Main app `tsc`: clean (worker changes don't touch it).
- Main app ESLint: clean (`worker/` is excluded from the root ESLint
  config, per existing project setup).
- Prettier, on every changed file (`googleAuth.ts`,
  `googleAuthEmailNormalization.test.mts`, `package.json`): clean.
- No secret value was printed at any point in this process.

### 4. Deploy

Same temporary-config technique as F5d-10 —
`worker/.wrangler-deploy-f5d10-3.toml` (`name`/`main`/`compatibility_date`/
`[vars]` only, no `[[r2_buckets]]`, no `[triggers]`) with
`wrangler deploy -c .wrangler-deploy-f5d10-3.toml --keep-vars`, deleted
immediately after and confirmed absent. The real `worker/wrangler.toml`
was never edited. Deployed version
`e15604f6-2e4a-46ba-b210-4626e7393d99` carries forward the corrected
`GOOGLE_SERVICE_ACCOUNT_EMAIL` secret from step 2 automatically (Cloudflare's
versions model inherits existing secret bindings into a new version unless
explicitly changed) alongside the untouched `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.

### 5. Production Firestore smoke test — SUCCEEDED

Same read-only-only technique as F5d-10/F5d-10.2: a temporary,
git-untracked `worker/src/.diag-firestore-check.ts` calling **only**
`listAttachments()` — no `updateRetentionStatus()`, no write path, no R2
call — delivered via `wrangler versions upload` (isolated, non-traffic-
affecting; preview URL, production traffic unaffected throughout).

Result:

```json
{ "ok": true, "attachmentCount": 0, "sampleDocIds": [] }
```

**OAuth token exchange succeeded. Service-account authentication
succeeded. The Firestore read succeeded.** `attachmentCount: 0` reflects
that the `serviceJobAttachments` collection is currently empty in
production — expected and correct for a pre-launch app with no real
customer activity yet (per `PROJECT_STATE.md`), not an error condition.
Authentication did not fail, so there was nothing to "stop and report" per
this sprint's own contingency instruction.

Both temporary files
(`worker/src/.diag-firestore-check.ts`, `worker/.wrangler-diag-f5d10-3.toml`)
were deleted immediately after and confirmed absent.

### 6. Post-deploy verification

`wrangler versions view e15604f6-... --json`:

| Check                              | Result                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handlers                           | `["scheduled", "fetch"]` — the real corrected source, not a placeholder                                                                                                                           |
| Bindings                           | Exactly `ALLOWED_ORIGINS` (plain_text), `FIRESTORE_PROJECT_ID` (plain_text), `GOOGLE_SERVICE_ACCOUNT_EMAIL` (secret_text), `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (secret_text) — **no R2 binding** |
| Routes / custom domains / triggers | None present anywhere in the version resource data — **Cron not active**                                                                                                                          |

`wrangler deployments status`: **100% traffic on `e15604f6-...`**, checked
both immediately after deploy and again after the smoke test — never
moved.

`wrangler secret list`: exactly `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, by name only. **No additional secret
was created.** No R2 bucket, KV namespace, D1 database, or other
Cloudflare resource was created by this sprint.

### Anomaly encountered and disclosed: deleted temp files reappeared

Partway through this sprint, `worker/src/.diag-secret-check.ts` and
`worker/.wrangler-diag-f5d10-2.toml` — both temporary files created during
F5d-10.2, deleted, and explicitly confirmed absent at the end of that
sprint's report — were found back on disk at the start of F5d-10.3, with
content byte-identical to what was written and deleted in F5d-10.2 (no
tampering, nothing added or changed). Cause not established; re-deleted
immediately and re-confirmed absent before continuing. **Flagging this
plainly: an earlier report's "confirmed absent" was accurate at the time
it was written, but this environment appears able to restore previously
deleted scratch files between sessions/turns by some mechanism outside
this sprint's control** (not a GCP/Cloudflare/git artifact — this project
isn't a git repository — most likely some local session/checkpoint
restore behavior). Every temporary file created in F5d-10.3 itself
(`.wrangler-deploy-f5d10-3.toml`, `src/.diag-firestore-check.ts`,
`.wrangler-diag-f5d10-3.toml`) was re-verified absent immediately before
concluding this report, including one extra `ls`-based recheck beyond the
usual `test -f` pattern. If a future session finds a stray temp file that
a report claims was deleted, this is the likely explanation — re-delete
and re-verify rather than assuming it indicates an unreported live change.

### What was NOT changed by this sprint

- No Cron trigger was enabled.
- No R2 bucket was created or attached.
- No `firestore.rules` or Firestore document/collection data was
  modified (`listAttachments()` performs GET requests only).
- No IAM role or binding was changed.
- No GCP key was created, rotated, or deleted — the single F5d-9 key
  remains the only one.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` was never read, printed, or
  modified.

### Remaining approval gates

Firestore access is now confirmed working end-to-end, but this sprint's
own instructions stop here. Still separately gated, exactly as before:
enabling the Cron trigger so `scheduled()` actually fires on a schedule;
enabling R2 on the Cloudflare account and creating/attaching a real
bucket; and any retention-deletion feature (which still does not exist
anywhere in this codebase — only `updateRetentionStatus()` exists, no
delete-a-document or delete-an-R2-object method exists on any client in
this Worker).

## F5d-11 — Production retention sweep dry run (2026-08-09)

**Nothing was written. No Cron was enabled. No R2 was touched. No new
credential or secret was created or changed.** This sprint added one new
read-only function, ran it once against real production Firestore via the
established isolated-preview technique, and deleted every temporary file
afterward.

### Phase 1 — read-only production inventory

Via the real production Worker/authentication path (the same
`createFirestoreClient()`/`getAccessToken()` code proven working in
F5d-10.3):

| Metric                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attachment metadata documents          | **0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| retentionStatus distribution           | `{}` — empty, nothing to distribute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Any `deleteAfter` values present       | No — 0 of 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Closed/open parent `serviceJobs` count | **Not determinable from this data source, and moot at zero attachments.** The retention sweep (real and dry-run) never reads the `serviceJobs` collection at all — by design, confirmed in `retentionSweep.ts`'s own header comment and re-verified by grep this sprint (see "Phase 3" below). Cross-referencing parent job status would require a new, separate Firestore read outside this Worker's existing narrow client, which this sprint did not add — moot regardless, since there are no attachments to have parent jobs for. |

No secret value, OAuth token, Authorization header, or private key was
printed. No customer PII exists in this collection's schema at all
(`docId`, `path`, `deleteAfter`, `retentionStatus` only — see
`firestoreClient.ts`).

### Phase 2 — dry-run retention calculation

Added `runRetentionSweepDryRun()` to `worker/src/retentionSweep.ts`,
directly alongside the real `runRetentionSweep()`. It calls the exact same
`client.listAttachments()` and the exact same `deriveRetentionStatus()`
per attachment — this proves what the _real_ sweep would do, not a
reimplementation of it. For each attachment it records
`{docId, storedRetentionStatus, calculatedRetentionStatus, wouldUpdate}`
and aggregates counts/distributions. **It never calls
`client.updateRetentionStatus()`** — there is no call to that method
anywhere in the function's body.

Because production currently has 0 attachments, the live dry run
naturally has nothing to iterate. The specific boundary conditions this
sprint was required to prove were instead demonstrated offline, against
the real `deriveRetentionStatus()` function (`src/attachmentRetention.ts`)
— the identical function both the real sweep and the dry run call — via a
new regression test, `worker/test/retentionDryRun.test.mts` (same
no-framework convention as the existing `test/smoke.mjs` and
`test/googleAuthEmailNormalization.test.mts`, run via `npm test`):

| Case                                         | Result             |
| -------------------------------------------- | ------------------ |
| Open-job attachment (`deleteAfter === null`) | `active` ✅        |
| More than 30 days remaining                  | `active` ✅        |
| Exactly 30 days remaining                    | `expiring-soon` ✅ |
| Fewer than 30 days remaining (10 days)       | `expiring-soon` ✅ |
| Overdue (`deleteAfter` already in the past)  | `expiring-soon` ✅ |
| One day past the boundary (31 days)          | `active` ✅        |
| One day inside the boundary (29 days)        | `expiring-soon` ✅ |

All 7 checks passed. `deleteAfter` is never an output of this function —
it only ever reads the value already passed in — so "deleteAfter is never
changed by the sweep" is a structural property of the function's
signature (`(deleteAfter: string | null, now: Date) => RetentionStatus`),
not just an observed behavior.

### Phase 3 — safety check (source-level proof)

Verified by direct grep of the actual source, not assumption:

| Claim                                    | Evidence                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No R2 dependency in the dry-run path     | Zero matches for `ATTACHMENTS_BUCKET`/`R2Bucket` in `retentionSweep.ts` or `firestoreClient.ts`                                                                                                                                              |
| No delete operation exists               | `FirestoreClient` (`firestoreClient.ts`) exposes exactly two methods — `listAttachments()` (GET) and `updateRetentionStatus()` (PATCH, `retentionStatus` field only) — no delete method exists on the interface or its implementation at all |
| Cannot delete Firestore documents        | Same as above — structurally absent, not disabled                                                                                                                                                                                            |
| Cannot modify `deleteAfter`              | `updateRetentionStatus()`'s PATCH body is hardcoded to `{ fields: { retentionStatus: ... } }` with `updateMask.fieldPaths=retentionStatus` — no code path anywhere writes `deleteAfter`                                                      |
| Cannot create documents                  | No POST-with-create call anywhere in `firestoreClient.ts`                                                                                                                                                                                    |
| Cannot modify `ServiceJobs`              | Zero matches for a `serviceJobs` (as opposed to `serviceJobAttachments`) collection reference anywhere in `worker/src`                                                                                                                       |
| `runRetentionSweepDryRun()` never writes | `updateRetentionStatus` is called exactly once in the entire file (`retentionSweep.ts`), inside `runRetentionSweep()` — zero occurrences inside `runRetentionSweepDryRun()`, confirmed by grep                                               |

The existing `retentionSweep.ts` could run safely in dry-run mode as-is
(it already never touches R2, never deletes, and only ever patches one
field) — no production behavior was modified to make this sprint
possible; `runRetentionSweepDryRun()` is a pure addition alongside the
untouched original.

### Phase 4 — production result

Live run, via the same isolated `wrangler versions upload` + preview-URL
technique used in F5d-10/F5d-10.2/F5d-10.3 (a temporary, git-untracked
`worker/src/.diag-retention-dryrun.ts` calling only
`runRetentionSweepDryRun()`, deleted immediately after):

```json
{
  "ok": true,
  "attachmentsTotal": 0,
  "attachmentsOpenJob": 0,
  "attachmentsWithDeleteAfter": 0,
  "storedStatusDistribution": {},
  "calculatedStatusDistribution": {},
  "wouldUpdateCount": 0,
  "entryCount": 0,
  "aborted": false
}
```

**`aborted: false` is the load-bearing field here** — per
`runRetentionSweepDryRun()`'s own contract, `aborted` is only ever `true`
if `listAttachments()` itself failed. `false` means authentication
succeeded, the Firestore list call succeeded, and the sweep logic ran to
completion — exactly the proof this sprint required. The zero counts are
the correct, expected consequence of an empty collection, not evidence
the sweep didn't execute.

**Proof of zero writes:** `wrangler deployments status`, checked
immediately after, still shows 100% traffic on
`e15604f6-2e4a-46ba-b210-4626e7393d99` (the F5d-10.3 corrected version,
unchanged) — the isolated diagnostic version was never promoted to
production traffic, and `runRetentionSweepDryRun()` itself never calls a
write-capable method regardless. **Proof Cron remains disabled:** the
temporary diagnostic config (`.wrangler-diag-f5d11.toml`) had no
`[triggers]` section, matching every prior sprint's technique, and the
live production version's bindings (last verified in F5d-10.3, unchanged
since) still show no `triggers`/`crons` anywhere. **Proof R2 remains
unavailable/unbound:** the temporary diagnostic config had no
`[[r2_buckets]]` section either; R2 has not been enabled on this
Cloudflare account at any point in this project's history.

Both temporary files
(`worker/src/.diag-retention-dryrun.ts`, `worker/.wrangler-diag-f5d11.toml`)
were deleted immediately after and their absence confirmed twice (the
standard `test -f` check plus an additional `ls`-based recheck, following
the same extra-caution practice adopted in F5d-10.3 after that sprint's
unexplained temp-file-reappearance anomaly — no recurrence this time).

### Validation

- Worker `tsc --noEmit`: clean.
- `npm test` (both regression tests — email normalization and the new
  retention boundary test): 13/13 checks passed, re-run again after
  Prettier's reformatting to confirm no behavior changed.
- Main app `tsc`, ESLint, production build: all clean (this sprint didn't
  touch `src/`, run for the same zero-regression confirmation as every
  prior worker-only sprint).
- Prettier: clean on every changed/added file.

### What was NOT changed by this sprint

- No Cron trigger was enabled or modified.
- No R2 bucket was created; R2 remains disabled on the Cloudflare account.
- No Firestore document was created, modified, or deleted —
  `runRetentionSweepDryRun()` only ever calls the existing
  `listAttachments()` GET method.
- No `retentionStatus` or `deleteAfter` value was updated.
- No `ServiceJob` record was touched.
- No `firestore.rules` change.
- No IAM role, binding, or service-account key was created, rotated, or
  deleted.
- No Cloudflare secret was changed.
- Production traffic never moved off `e15604f6-...` (the F5d-10.3
  version) — the new `runRetentionSweepDryRun()` code exists in the
  source tree but was only ever exercised via an isolated, non-traffic
  preview version, never deployed to production traffic.

### Exact next approval gate

The retention-sweep logic is now proven correct (via offline boundary
tests) and proven safe to execute against real production Firestore (via
the live dry run) — but it still has never run automatically, and this
sprint changes none of that. Still separately gated, unchanged from
F5d-10.3: enabling the Cron trigger so `scheduled()` (the real,
write-capable `runRetentionSweep()`) actually fires on a schedule;
enabling R2 and provisioning a real bucket; and any retention-deletion
feature, which still does not exist anywhere in this codebase.

## F5d-12 — R2 production bucket setup (BLOCKED, 2026-08-09)

**Nothing live was changed.** This sprint stopped before its first live
action, per its own explicit instruction not to guess an ambiguous
resource name.

### Pre-flight name check

Grepped the entire project (`wrangler.toml`, `worker/README.md`,
`worker/PRODUCTION_FIRESTORE_ACCESS.md`, `DECISIONS.md`,
`PROJECT_STATE.md`) for any documented production R2 bucket name.
**Result: none exists.** The only name anywhere is
`service-tech-attachments-dev`, and every reference to it — including its
own comment in `wrangler.toml` — explicitly calls it a placeholder never
created on any real account. `worker/README.md`'s own "Deploying for
real" section already expects `bucket_name` to be changed, not reused, for
a real deploy. This matched this sprint's own stop condition exactly, so
the user was asked directly rather than guessing or reusing the dev name.

**Confirmed by the user: the production bucket name is
`service-tech-attachments-prod`.**

### R2 account status — still blocked

`wrangler r2 bucket list` (read-only): still returns
`ERROR: Please enable R2 through the Cloudflare Dashboard. [code: 10042]`
— identical to the finding in F5d-10. R2 has never been enabled on this
Cloudflare account at any point in this project's history. This is a
one-time, account-level activation gated entirely behind the Cloudflare
Dashboard (Account Home → R2 → enable), which typically requires accepting
R2's terms and confirming billing consent for the product (R2 has a free
tier, but Cloudflare still requires this one-time activation step before
any bucket — even a free-tier one — can exist). No `wrangler`/API command
can perform this step, and account-setting/billing-consent changes are
outside what this assistant performs even when technically possible —
this requires the account owner directly.

### What happens next

Once R2 is enabled via the Dashboard, F5d-12 can resume from bucket
creation:
`wrangler r2 bucket create service-tech-attachments-prod`, verify it
exists, update `wrangler.toml`'s `bucket_name` to match (or use the same
temporary deploy-only config technique from F5d-10 if the real
`wrangler.toml` shouldn't be edited directly — to be decided when this
resumes), deploy with `[triggers]` excluded exactly as every prior deploy
in this sequence has done, and verify the binding. None of that happened
this sprint.

### What was NOT changed by this sprint

- R2 was not enabled (cannot be, by this assistant).
- No R2 bucket was created.
- `wrangler.toml` was not modified.
- The Worker was not deployed.
- No Cron trigger was touched.
- No Firestore data, rules, IAM, GCP key, or Cloudflare secret was
  touched.
- No test object of any kind was created (nothing to test — no bucket
  exists).

### Remaining approval gates

1. **User action required, outside this assistant's ability:** enable R2
   for this Cloudflare account via the Dashboard.
2. Once enabled: bucket creation, `wrangler.toml`/binding update, and
   deploy — all still to be done under this same F5d-12 scope once
   unblocked, with the same Cron-exclusion and no-deletion-testing
   boundaries as originally specified.
3. Unchanged from before: Cron activation, retention-sweep-against-real-data,
   and any deletion feature all remain separately gated beyond F5d-12.

## F5d-12 — R2 production bucket setup (COMPLETE, 2026-08-09)

This sprint took three attempts across separate messages to get past its
own pre-flight checks before any live change was made — each stop is
recorded here for the full picture, not just the successful end state.

### Attempt 1 — stopped: no documented production bucket name

Grepped `wrangler.toml`, `worker/README.md`,
`worker/PRODUCTION_FIRESTORE_ACCESS.md`, `DECISIONS.md`, and
`PROJECT_STATE.md`. The only bucket name anywhere in the project was
`service-tech-attachments-dev`, explicitly documented everywhere as a
placeholder never created on any real account — `README.md`'s own
"Deploying for real" section already expects this value to be _changed_
for production, not reused. Per this sprint's explicit instruction not to
guess an ambiguous name, stopped and asked. **User confirmed:
`service-tech-attachments-prod`.**

### Attempt 2 — stopped: R2 still not enabled

Before creating anything, `wrangler r2 bucket list` was re-checked and
returned the same `ERROR: Please enable R2 through the Cloudflare
Dashboard. [code: 10042]` first found in F5d-10. This is a one-time
account-level activation gated entirely behind the Cloudflare Dashboard
(accepting R2's terms and confirming billing consent for the product) —
no `wrangler`/API call can perform it, and it's outside what this
assistant does even where technically possible (account-setting and
billing-consent changes require the user directly). Stopped and asked the
user to enable R2 via the Dashboard.

### Attempt 3 — stopped again: same error after user reported R2 enabled

After the user reported enabling R2, `wrangler r2 bucket list` still
returned the identical `code: 10042` error. Investigated further:
`wrangler whoami` showed no `r2` scope in the token's permission list,
which looked initially like the real cause (a stale OAuth token issued
before R2 was enabled, missing R2 scope). The user re-ran `wrangler
login`, but the resulting token showed the **identical** permission list
— disproving the stale-token theory, since a fresh login produced no
change at all. Since the `code: 10042` error comes directly from
Cloudflare's own API (not a local wrangler scope check), the only
remaining explanation was that R2 genuinely wasn't yet active for the
specific account `wrangler` was authenticated against
(`3dd8b936e8537e30e1b0c421580cdac7`, `sacool.spizy@gmail.com`) — so the
user was asked to confirm account identity and dashboard state directly.
**User confirmed: same account, R2 Object Storage active, billing
enabled, $0.00 usage, no bucket created yet.**

### Pre-write verification (this final attempt)

```
wrangler whoami        → same account (Sacool.spizy@gmail.com's Account,
                          3dd8b936e8537e30e1b0c421580cdac7)
wrangler r2 bucket list → succeeded (exit code 0), empty list
```

R2 was reachable for the first time in this project's history, and the
bucket list was genuinely empty — `service-tech-attachments-prod` did not
already exist. Safe to proceed.

### Bucket creation

```
wrangler r2 bucket create service-tech-attachments-prod
```

Succeeded: `Created bucket 'service-tech-attachments-prod' with default
storage class of Standard.` Re-ran `wrangler r2 bucket list` immediately
after: **exactly one bucket**, `service-tech-attachments-prod`, created
`2026-08-09T05:08:03.833Z` — no second/unexpected bucket appeared.
Default R2 buckets are private with no public access and no custom domain
— neither was touched or configured by this sprint.

### `wrangler.toml` change

```diff
 [[r2_buckets]]
 binding = "ATTACHMENTS_BUCKET"
-bucket_name = "service-tech-attachments-dev"
+bucket_name = "service-tech-attachments-prod"
```

The binding name (`ATTACHMENTS_BUCKET`) was preserved exactly as the
existing architecture already uses it — `wrangler r2 bucket create`'s own
suggested snippet proposed a different binding name
(`service_tech_attachments_prod`), which was deliberately **not** used,
since this sprint's scope was to connect the _existing_ binding, not
redesign it. No other line in `wrangler.toml` was touched — `[triggers]`
and `[vars]` are unchanged.

### Deploy — same Cron-exclusion technique as F5d-10/F5d-10.3

A temporary file, `worker/.wrangler-deploy-f5d12.toml` (`name`/`main`/
`compatibility_date`/`[[r2_buckets]]` pointing at the new production
bucket/`[vars]` — no `[triggers]`), used with
`wrangler deploy -c .wrangler-deploy-f5d12.toml --keep-vars`, deleted
immediately after and confirmed absent. The real `worker/wrangler.toml`'s
own `[triggers]` section (still present, still inert — never referenced
by any deploy in this project's history) was untouched by the deploy
itself.

### Post-deploy verification

Version `9a8b83f2-861d-4700-9b4a-05260c4ee661`, 100% traffic
(`wrangler versions view --json` / `wrangler deployments status`):

| Check                                | Result                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Handlers                             | `["scheduled", "fetch"]` — real code                                                     |
| `ATTACHMENTS_BUCKET` binding         | `r2_bucket`, `bucket_name: "service-tech-attachments-prod"` ✅                           |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | present, `secret_text` ✅                                                                |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | present, `secret_text` ✅                                                                |
| Other bindings                       | `ALLOWED_ORIGINS`, `FIRESTORE_PROJECT_ID` (unchanged plain vars)                         |
| Total bindings                       | Exactly 5 — nothing added beyond the R2 binding, nothing removed                         |
| Routes / custom domains              | None present anywhere in the resource data                                               |
| `triggers`/`crons`                   | None present anywhere in the resource data — **Cron not active**                         |
| `wrangler secret list`               | Exactly `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — no extras |
| `wrangler r2 bucket list`            | Exactly one bucket, unchanged since creation                                             |

### Why no test object was created

This sprint's instructions preferred configuration/binding verification
over creating a live test object, and only called for one "if the binding
genuinely cannot be verified without one." It can be: Cloudflare's own
`wrangler versions view --json` output is authoritative server-side data
about exactly what resource a deployed version's binding points to — the
same kind of evidence this project has relied on throughout (e.g. F5d-9a's
placeholder-script audit). Unlike the Firestore GCP credential (where a
correct-looking IAM/key configuration could still fail at the OAuth layer,
as F5d-10 through F5d-10.3 found the hard way), an R2 binding is
platform-granted directly by Cloudflare to the Worker — there is no
separate credential exchange that could still fail despite a correct
binding configuration. No test object was created, so none needed to be
cleaned up.

### Validation

- Worker `tsc --noEmit`: clean (no worker source code changed, only
  `wrangler.toml`).
- Main app `tsc`, ESLint, production build: all clean (this sprint didn't
  touch `src/`).
- `wrangler.toml` confirmed to contain `bucket_name =
"service-tech-attachments-prod"` (re-read after the edit).
- Cron confirmed disabled both in the temporary deploy config (no
  `[triggers]`) and in the live version's resource data (no
  `triggers`/`crons` key at all).

### What was NOT changed by this sprint

- No public access was enabled on the bucket.
- No custom domain was configured for the bucket.
- Nothing was deleted — no object, no bucket, nothing.
- No Firestore data, rules, IAM role/binding, or GCP key was touched.
- No Cloudflare secret was changed.
- No KV namespace, D1 database, Queue, or any other Cloudflare resource
  was created.
- No Cron trigger was enabled.
- No retention sweep was run against production.

### Remaining approval gates

Unchanged from before, still separately gated: enabling the Cron trigger
so `scheduled()` (the real, write-capable `runRetentionSweep()`) actually
fires on a schedule and can now genuinely reach both Firestore and R2;
uploading/downloading/deleting any real production file through the
now-bound R2 bucket; and any retention-deletion feature, which still does
not exist anywhere in this codebase.

## F5d-13 — Production file flow + deletion safety foundation (2026-08-09)

### Part A — File flow, mapped directly from source

Every claim below was verified by reading the actual implementation
(`worker/src/index.ts`, `worker/src/paths.ts`, `worker/src/validation.ts`,
`src/repositories/workerAttachmentsRepository.ts`,
`src/repositories/firestoreAttachmentsRepository.ts`,
`src/repositories/firestore/attachmentMapping.ts`), not assumed from
documentation.

1. **Upload reaches the Worker via** `workerAttachmentsRepository.ts`'s
   `upload()` — `POST {WORKER_URL}/files/service-jobs/{jobId}/{category}`,
   raw file bytes as the body, `Content-Type` and `X-File-Name` headers.
2. **The Worker writes bytes to R2 via** `index.ts`'s `handleUpload()`:
   validates `jobId` (`isSafeJobId`), `category` (`isAttachmentCategory`),
   `Content-Type` (`isAllowedContentType`, an explicit allowlist of image/
   video/PDF/Word types), and size (`exceedsDeclaredSize` fast-path +
   `readBodyWithLimit`'s real enforcement against actual bytes read, 50MB
   cap) — then `env.ATTACHMENTS_BUCKET.put(path, body, { httpMetadata:
{ contentType } })`.
3. **Firestore metadata is stored by** the frontend repository, not the
   Worker — `workerAttachmentsRepository.ts`'s `upload()` builds an
   `Attachment` object from the Worker's JSON response (`path`,
   `contentType`, `size`, `uploadedAt`) with `deleteAfter: null`,
   `retentionStatus: 'active'`, `retentionExtensions: []` defaults, then
   calls `firestoreAttachmentsRepository.ts`'s `create()`, which
   `setDoc()`s at document ID `attachmentDocId(path)` (the R2 key with
   `/` → `__`) in the `serviceJobAttachments` collection. **The Worker
   itself never touches Firestore during upload** — that's an entirely
   separate write, made by the frontend, only after the Worker's response
   confirms the bytes are already durably in R2.
4. **Download works via** `getDownloadUrl(id)` (a pure string build,
   `${baseUrl}/files/${id}`, no round-trip) → a direct browser/client GET
   to the Worker's `/files/{path}` route → `index.ts`'s `handleDownload()`
   validates the key (`isValidAttachmentKey`) and streams
   `env.ATTACHMENTS_BUCKET.get(key)`'s body back with the stored
   `Content-Type` and `Cache-Control: private, no-store`.
5. **The attachment ID/object key is derived entirely server-side, at
   upload time**, by `paths.ts`'s `generateAttachmentPath(jobId, category,
fileName)`: `service-jobs/{jobId}/{category}/{crypto.randomUUID()}-{sanitizedFileName}`.
   The client supplies `jobId`/`category`/`fileName`; the UUID prefix is
   always server-generated, so two uploads named identically can never
   collide and a client can never fully determine the final key in
   advance. This exact string becomes `Attachment.id` **and**
   `Attachment.path` (the same value, by convention) in Firestore, and is
   separately transformed into the Firestore _document ID_ via
   `attachmentDocId()`'s `/` → `__` substitution — three different
   representations of the same one identity (R2 key / Attachment field /
   Firestore doc ID), each documented, none accidental.
6. **Worker routes are actually wired**, confirmed by direct code
   inspection of `index.ts`'s `fetch()`: `POST`/`GET`/`DELETE` under
   `/files/*` all dispatch to real handlers (`handleUpload`/
   `handleDownload`/`handleDelete`), not stubs. This was independently
   re-confirmed live in production this sprint (see below) — not assumed
   from the code reading alone.
7. **Frontend repository and Worker implementation are consistent**:
   `workerAttachmentsRepository.ts` posts to exactly the path shape and
   header names the Worker's `handleUpload()` reads; `getDownloadUrl()`/
   `deleteAttachment()` build `/files/{id}` matching the Worker's GET/
   DELETE routes exactly, with `id` always equal to the real R2 key. No
   drift found between the two sides.

### Production verification — real end-to-end test performed

Config/binding verification alone (F5d-12's `wrangler versions view
--json`) only proves the R2 _binding_ points at the right bucket — it
doesn't prove the Worker's actual `handleUpload`/`handleDownload`/
`handleDelete` code correctly reads/writes through it. This sprint's goal
was explicitly to prove the _file flow_, not just the binding, so a real
round trip was performed — against the already-deployed production
Worker, no redeploy needed.

**Why the literal `__qa__/f5d13/<unique-id>` key suggested in this
sprint's brief wasn't used as given:** the Worker's real upload route
never accepts a caller-supplied key — `generateAttachmentPath()` always
derives it server-side from `jobId`/`category`/`fileName`, and
`isValidAttachmentKey()` (enforced on every GET/DELETE) requires the
exact `service-jobs/{id}/{category}/{name}` shape — a literal
`__qa__/f5d13/...` key would be rejected by the Worker's own validation on
any GET/DELETE. Adapted the same intent (a clearly, unambiguously
QA-namespaced key) into the real convention instead: `jobId =
"qa-f5d13-1786254797"` (a Unix timestamp suffix for uniqueness),
`category = "documents"`, `fileName = "f5d13-qa-test.pdf"`.

**Exact steps, against the real production Worker
(`https://service-tech-files-worker.sacool-spizy.workers.dev`), via
`curl` — never through the frontend, so zero Firestore documents were
created or touched by this test:**

1. `POST /files/service-jobs/qa-f5d13-1786254797/documents`,
   `Content-Type: application/pdf`, `X-File-Name: f5d13-qa-test.pdf`, body
   `"F5d-13 QA test object -- safe to delete."` (40 bytes) →
   **`201 Created`**, returned key:
   `service-jobs/qa-f5d13-1786254797/documents/a56d512e-7dc6-4ed0-adfa-99b74223b815-f5d13-qa-test.pdf`.
2. `GET /files/{that exact key}` → **`200 OK`**, `Content-Type:
application/pdf`, `Content-Length: 40` — body byte-compared (`diff`)
   against the original upload content: **identical**.
3. `DELETE /files/{that exact key}` → **`204 No Content`**.
4. `GET /files/{that exact key}` again → **`404 {"error":"Not found"}`** —
   object confirmed gone.
5. `wrangler deployments status`, checked immediately after → still 100%
   on `9a8b83f2-861d-4700-9b4a-05260c4ee661` (unchanged from F5d-12) —
   **no deployment was required or performed for this test.**

**Test key (for the record):**
`service-jobs/qa-f5d13-1786254797/documents/a56d512e-7dc6-4ed0-adfa-99b74223b815-f5d13-qa-test.pdf`
— created and deleted within this sprint, confirmed gone via a live `404`
from the Worker's own API (the same signal the real application relies
on), never a customer/production key, no Firestore document ever existed
for it.

### Part B — Deletion safety foundation (`worker/src/deletionSafety.ts`)

New file, pure functions and types only — no R2 call, no Firestore write,
no import of any mutating method, never imported by `index.ts` (not
wired into the deployed Worker's request-handling path in any way). Maps
onto this sprint's ten evaluation points:

| #   | Requirement                            | How it's addressed                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dry-run                                | Unchanged — F5d-11's `runRetentionSweepDryRun()` in `retentionSweep.ts` was not touched.                                                                                                                                                                                                                                                                                                                                                     |
| 2   | Max deletions per run                  | `selectDeletionCandidates(attachments, now, maxDeletionsPerRun)` — `maxDeletionsPerRun` is a **required** parameter with no default anywhere; the function throws if called without a valid non-negative integer. **Value approved by F5d-14: 50 — see [DECISIONS.md #024](../DECISIONS.md). Not yet wired into any caller.**                                                                                                                |
| 3   | Re-check immediately before deletion   | `recheckEligibilityBeforeDelete(staleAttachment, freshAttachment, now)` — requires two independently-obtained records (typed identically, so a single stale read can't satisfy both parameters by accident); refuses if `deleteAfter` changed between selection and delete time (e.g. a staff "Extend Retention" action ran in between).                                                                                                     |
| 4   | Explicit eligibility                   | `isEligibleForDeletion()` — the **only** correct signal is `now >= deleteAfter`. Deliberately does **not** use `retentionStatus` alone: `'expiring-soon'` covers both "within the 30-day warning window" and "already overdue" (existing, documented behavior — see `attachmentRetention.ts`), so status-only eligibility would make files deletable up to 30 days early. Regression-tested explicitly for this exact trap.                  |
| 5   | Missing/invalid metadata → fail closed | `isEligibleForDeletion()`: `deleteAfter === null` → not eligible; unparseable `deleteAfter` → not eligible. No branch defaults to `true`.                                                                                                                                                                                                                                                                                                    |
| 6   | R2 key validation                      | `isDeletionCandidateKeyValid()` — reuses (does not reimplement) `paths.ts`'s existing `isValidAttachmentKey()`, the same pattern already enforced on every real GET/DELETE — one single source of truth for "does this key belong to the expected namespace."                                                                                                                                                                                |
| 7   | Failure handling                       | `DeletionExecutionContract` documents the required order for any future executor: R2 delete must succeed **before** the Firestore metadata document is touched — mirroring the exact ordering already shipped in `workerAttachmentsRepository.ts`'s manual `deleteAttachment()`. `DeletionOutcome` distinguishes `'r2-delete-failed'` from `'firestore-delete-failed'` from `'deleted'` — no outcome can be silently conflated with success. |
| 8   | Per-run circuit breaker                | `shouldHaltRun(failuresSoFar, failureThreshold)` — `failureThreshold` is **required**, no default, throws if non-positive. **Value approved by F5d-14: 3 — see [DECISIONS.md #024](../DECISIONS.md). Not yet wired into any caller.**                                                                                                                                                                                                        |
| 9   | Auditability                           | `DeletionAuditEntry`/`buildDeletionAuditEntry()` — `attachmentId`, `objectKey`, `reason`, `timestamp`, `outcome` only. No secret, token, key, or file content can appear in this shape.                                                                                                                                                                                                                                                      |
| 10  | Idempotency                            | `DeletionOutcome` includes `'already-deleted'` as a first-class, non-failure outcome — the concrete contract that a future executor finding an R2 object already gone (e.g. on a retried run) must record success, not error, and never attempt a second destructive action.                                                                                                                                                                 |

**On the "does `deleteExpiredAttachment` already exist" check:** it does
not. Grepped the entire project for anything resembling a
deletion-triggering function name (`deleteExpired`, plus the four
ambiguous-policy identifier patterns) — no matches anywhere in `worker/`
or `src/`. `firestoreClient.ts`'s `FirestoreClient` interface has exactly
two methods (`listAttachments`, `updateRetentionStatus`) and no delete
method exists on it at all, same finding already established in F5d-11.

**26/26 offline regression checks pass**
(`worker/test/deletionSafety.test.mts`, `npm test`) — fail-closed cases,
the retention-status boundary trap, the extension-during-window recheck
scenario, key-namespace validation (valid key / path-traversal-shaped key
/ unrecognized category), the required-parameter guarantees for both
`maxDeletionsPerRun` and `failureThreshold` (calling without them throws
rather than silently defaulting), a mixed-candidate selection scenario,
and the audit entry shape.

**One tooling change made to support this:** `worker/tsconfig.json`
gained `"allowImportingTsExtensions": true` — needed because
`deletionSafety.ts` imports `paths.ts` by value, and Node's native
TypeScript execution (used by every regression test in this project, see
F5d-10.3) requires explicit `.ts` extensions on relative specifiers,
which TypeScript's `Bundler` resolution mode only permits with this flag
set (valid here since the project already has `noEmit: true`). This
doesn't change `wrangler`'s esbuild-based bundling behavior — no other
file's imports were changed, and `deletionSafety.ts` isn't imported by
`index.ts`, so it has zero effect on the deployed bundle. Not logged as a
`DECISIONS.md` entry — judged as a tooling enabler for the existing
"plain Node script, no test framework" convention, not a new
architectural decision.

### Unresolved ambiguities as of F5d-13 — two resolved by F5d-14, two still open

**Four numeric deletion-policy values were undefined anywhere in this
project** — grepped the whole repository (code, `DECISIONS.md`,
`BUSINESS_RULES.md`, `PROJECT_STATE.md`, `worker/PRODUCTION_FIRESTORE_ACCESS.md`)
for any prior decision on these; none existed:

1. **Maximum deletions per run** — how large a single automated deletion
   batch is allowed to be before something is clearly wrong. **Resolved
   by F5d-14: 50.** See [DECISIONS.md #024](../DECISIONS.md).
2. **Failure threshold (circuit breaker)** — how many individual deletion
   failures within one run should halt the rest of that run. **Resolved
   by F5d-14: 3.** See [DECISIONS.md #024](../DECISIONS.md).
3. **Retry count** — whether/how many times a failed individual deletion
   should be retried before being recorded as a permanent failure. **Still
   undefined** — F5d-14's scope was limited to the two values above; not
   addressed.
4. **Grace period** — nothing in this project defines any grace period
   beyond the already-decided 30-day `EXPIRING_SOON_WINDOW_DAYS` warning
   window itself (`attachmentRetention.ts`). **Still undefined** — F5d-14
   did not introduce one; the 50/3 policy is explicitly not a grace
   period (see "F5d-14" below).

**None of these were invented by this assistant.** (1) and (2) were
supplied directly by the user as explicit project policy in F5d-14. (3)
and (4) remain unaddressed — no function in this codebase requires them
yet, since no retry logic or grace-period logic has been built.

### What was NOT changed by this sprint

- No Cron trigger was enabled or modified.
- No real/customer R2 object or Firestore document was touched — the one
  test object was created and deleted within this sprint, confirmed gone.
- No Firestore document was ever created by the production test (it hit
  only the Worker's R2 routes, never the frontend repository that also
  writes Firestore metadata).
- No actual deletion capability was implemented or wired — no function in
  `deletionSafety.ts` calls R2's `delete()` or Firestore's delete/update
  methods.
- No retention sweep was run in write mode against production.
- No `firestore.rules`, IAM role/binding, GCP key, or Cloudflare secret
  was touched.
- No additional Cloudflare resource was created.
- The R2 bucket was not made public; no custom domain was configured.
- Production traffic never moved off `9a8b83f2-...` — no redeploy
  occurred this sprint at all.

### Validation

- Worker `tsc --noEmit`: clean.
- `npm test` (all three regression test files — email normalization,
  retention dry-run, and the new deletion-safety suite): 26 new checks
  plus all prior checks, all passing.
- Main app `tsc`, ESLint, production build: all clean (this sprint's only
  `src/`-adjacent activity was reading files for the architecture map;
  nothing under `src/` was modified).
- Prettier: clean on every changed/added file.

### Exact next approval gate

Before any real deletion capability can be implemented (let alone wired
or scheduled), this project needs an explicit decision on the four values
above. Recommended next step: a short, decision-only sprint (no code) to
settle **maximum deletions per run** and **failure threshold** at
minimum (the two values `deletionSafety.ts` already structurally
requires) — retry count and grace period only if a real design for them
is wanted. Only after that is decided does implementing and wiring an
actual deletion executor become a well-scoped next sprint. Cron activation
and R2's file-cleanup-on-schedule remain separately gated regardless.

## F5d-14 — Retention deletion policy decision (2026-08-09, documentation only)

**No source code was changed this sprint.** F5d-13 left
`deletionSafety.ts`'s `maxDeletionsPerRun`/`failureThreshold` parameters
required with no default, specifically so a real policy decision could be
recorded before any number was chosen. F5d-14 records that decision — it
does not implement, wire, or call anything with it.

### The approved policy

Logged as [DECISIONS.md #024](../DECISIONS.md) (the next sequential
decision number after #023 — no numbering scheme was invented, the
existing one was simply continued):

| Policy                              | Value  | Reasoning given                                                                                                                       |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum deletions per run           | **50** | Conservative initial production safety limit — pre-launch, zero attachment metadata in production, deletion mechanism never activated |
| Failure threshold (circuit breaker) | **3**  | Same reasoning — halt a run early rather than let repeated failures compound                                                          |

These were supplied directly by the user as explicit project policy —
this assistant did not derive, guess, or propose either number.

### What these limits are — and, explicitly, what they are not

| This IS                                                                         | This is NOT                                                                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An execution-throttling cap on a future deletion run                            | A change to `RETENTION_PERIOD_DAYS` (365 days, unchanged)                                                        |
| A circuit breaker for repeated failures within one run                          | A change to `EXPIRING_SOON_WINDOW_DAYS` (30 days, unchanged)                                                     |
| A safety limit on destructive execution, once enabled                           | A grace period — `deleteAfter` is not touched by these values in any way                                         |
| Applied only after a deletion executor exists and is separately approved to run | A change to deletion eligibility — `isEligibleForDeletion()`'s `now >= deleteAfter` logic (F5d-13) is unaffected |

`retention period` (365 days), `expiring-soon threshold` (30 days), and
`deletion safety limits` (50 / 3, this sprint) are three distinct,
independently-decided concepts. Conflating any two would be a
misreading of this decision.

### What was NOT changed by this sprint

- No R2 object, real or test, was created, modified, or deleted.
- No Firestore document was created, modified, or deleted.
- No `firestore.rules`, IAM role/binding, GCP key, or Cloudflare secret
  was touched.
- No Cloudflare resource was created.
- No Cron trigger was enabled or modified — **Cron activation remains a
  separate, explicitly-gated approval**, unchanged from every prior
  sprint in this sequence.
- No deletion executor was implemented, wired, or called — **actual
  production deletion remains a separate, explicitly-gated approval**,
  unchanged.
- `worker/src/deletionSafety.ts` itself was not modified — its
  `maxDeletionsPerRun`/`failureThreshold` parameters remain exactly as
  required-with-no-default as F5d-13 left them. This sprint recorded the
  values that a future caller must supply; it did not supply them to any
  actual call site, because no call site exists yet.
- The Worker was not deployed — nothing about this sprint's output
  affects the deployed bundle.

### Validation

- Prettier: clean on `DECISIONS.md`, `worker/PRODUCTION_FIRESTORE_ACCESS.md`.
- No `tsc`/ESLint/build run was needed — no source file changed.
- `wrangler deployments status`: unchanged, still 100% on
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` (from F5d-12/F5d-13).

### Exact next approval gate

Retry count and grace period remain undefined and out of this sprint's
scope — address them only if a real design for retry/grace-period
behavior is wanted before F5d-15. Recommended F5d-15: implement the real
deletion executor behind the now-fully-parametrized safety foundation
(passing `maxDeletionsPerRun: 50`, `failureThreshold: 3` at its call
site), but keep it **unwired/disabled** — no Cron, no scheduled
invocation, no production write — until a further, separate approval
explicitly authorizes activating it.

## F5d-15 — Production deletion executor implementation, UNWIRED (2026-08-09)

**Complete and production-capable in code. Not reachable from any real
execution path.** This sprint added two files
(`worker/src/deletionExecutor.ts`, new) and one narrow addition to an
existing file (`worker/src/firestoreClient.ts`'s `getAttachment()`), plus
a new 31-check offline regression test. No Worker deployment happened —
production traffic stayed on `9a8b83f2-...` throughout, confirmed via
`wrangler deployments status` both before and after this sprint's work.

### Architecture

`executeSingleDeletion()` (one candidate) and `runDeletionExecutor()`
(the batch entry point) implement exactly the order this sprint
specified, reusing F5d-13's `deletionSafety.ts` helpers rather than
duplicating their logic:

1. **Structural validation** — `docId` non-empty and free of a raw `/`
   (real Firestore doc IDs always have `/` encoded as `__`); `path`
   non-empty. Catches a corrupted candidate before any network call.
2. **Fresh Firestore re-read** — the new `firestoreClient.ts`'s
   `getAttachment(docId)`, a single-document GET. Added specifically
   because F5d-13's `recheckEligibilityBeforeDelete()` requires a truly
   independent, freshly-obtained record, not a re-slice of an earlier
   `listAttachments()` snapshot. Read-only — uses
   `datastore.entities.get`, a permission the existing custom IAM role
   already grants but had never been exercised until now; no IAM change
   was needed.
3. **Re-checked eligibility** — `recheckEligibilityBeforeDelete()` (F5d-13,
   unmodified) against the fresh record, not the stale candidate.
4. **Key re-validation** — `isDeletionCandidateKeyValid()` (F5d-13,
   unmodified) against the freshly-read `path`.
5. **R2 delete** — `head()` first, deliberately, then `delete()` only if
   the object is confirmed present. R2's `delete()` call itself resolves
   successfully whether or not the key existed, so `head()` is the only
   way to honestly distinguish "genuinely deleted this run" from "was
   already gone" — the idempotency requirement this sprint asked for.
6. **Stops.** See the next section.

### The Firestore post-delete boundary — confirmed still undefined, execution stops there

Per this sprint's explicit instruction, checked again before writing any
Firestore-mutation code: grepped `DECISIONS.md`, `BUSINESS_RULES.md`,
`PROJECT_STATE.md`, and the codebase itself for any rule on what should
happen to a `serviceJobAttachments` document once its R2 object is
deleted (delete it, mark it, retain it, archive it). **None exists.** The
`RetentionStatus` type's own comment in `attachmentRetention.ts` says so
directly: _"there is no distinct 'expired'/'deleted' state yet because
nothing in this app actually deletes a file... Revisit this union once
F5d-3 or later introduces real deletion."_ F5d-3 came and went without
resolving it; F5d-13 flagged the same gap; it remains open.

**`executeSingleDeletion()` performs zero Firestore writes after a
successful R2 delete.** No document delete, no field update, no new
status value invented. The function's `'deleted'` result exists (as this
sprint's brief explicitly required) to describe the R2 object's deletion
— it makes no claim about the metadata document's state, and its
`reason` field says so explicitly: _"R2 object deleted; Firestore
metadata intentionally left untouched — no approved post-delete
lifecycle rule exists."_ This is asserted, not silently implied, so a
future reader of an audit log can't mistake "R2 gone" for "fully cleaned
up."

**This is the boundary this sprint's instructions said to stop at rather
than invent past.** No lifecycle state was added to `RetentionStatus` or
anywhere else. Before this executor is ever wired to a real trigger, a
decision is needed: does successful R2 deletion delete the Firestore
document, mark it with a new status, leave it as-is permanently, or
something else — and if "mark it," what should that status be called and
does it require widening `RetentionStatus`'s union (currently
`'active' | 'expiring-soon'` only)? None of that was decided or invented
this sprint.

### Idempotency and error handling — the exact result vocabulary

| Result            | Meaning                                                                                                                                                                                           | Counts toward `maxDeletionsPerRun`? | Counts toward `failureThreshold`? |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| `deleted`         | R2 object genuinely removed this run                                                                                                                                                              | Yes                                 | No                                |
| `already-deleted` | `head()` found nothing — idempotent no-op, no destructive action taken                                                                                                                            | No                                  | No                                |
| `skipped`         | Any fail-closed rule tripped (missing metadata, invalid key, not yet due, changed since selection, malformed candidate, or the run-level cap/threshold reached before this candidate was reached) | No                                  | No                                |
| `failed`          | A genuine, unrelated R2 or Firestore error (a thrown exception, never a clean "not found")                                                                                                        | No                                  | Yes                               |
| `halted`          | Assigned to every candidate remaining once the circuit breaker tripped — never attempted at all                                                                                                   | No                                  | No                                |

**Only genuine destructive R2 deletions count against the 50-per-run
cap** — an implementation decision made this sprint (not a new numeric
policy value; the cap itself is fixed at 50 per DECISIONS.md #024, this
only defines what counts toward it), reasoned as: the cap exists to bound
how much real destructive action one run performs, and an already-absent
object requires none. Documented in code comments; flagged here in case
the user wants this counted differently.

**A genuine, unrelated R2 error is never conflated with "already
deleted."** `head()`/`delete()` throwing is caught and classified as
`'failed'`, distinct from `head()` cleanly returning `null` (the
legitimate "not found" signal) — regression-tested explicitly (test
cases 10 and 11/11b) to prove these two paths can't be confused with each
other.

### Batch safety — exact approved values, no alternatives

`runDeletionExecutor(candidates, deps, maxDeletionsPerRun, failureThreshold)`
requires both numbers as explicit arguments — there is no default
anywhere in this file, mirroring F5d-13's `deletionSafety.ts` design. The
values this sprint's brief specified are the only ones ever exercised in
this sprint's tests: **`maxDeletionsPerRun: 50`, `failureThreshold: 3`**
(DECISIONS.md #024). Passing a negative cap or a non-positive threshold
throws immediately, before any candidate is processed — a misconfigured
run fails closed, not silently.

When the cap is reached: remaining candidates are recorded as `'skipped'`
with an explicit "maximum deletions per run reached — not processed"
reason — never silently dropped. When the failure threshold is reached:
`halted: true` is set, a `haltedReason` is recorded, and every remaining
candidate is recorded as `'halted'` — all results obtained before the
halt are preserved in the same `results` array, never discarded.

### Testing

`worker/test/deletionExecutor.test.mts` — 31 checks, all offline, using
an in-memory `FakeFirestoreClient` (a `Map`) and `FakeR2Bucket` (a `Set`)
— no network call, no real credential, no production infrastructure
touched by any test. Covers all 18 scenarios this sprint's brief
required: valid eligible candidate, missing metadata, malformed
attachment ID, invalid object key, missing/invalid `deleteAfter`,
not-yet-expired, metadata-changed-during-recheck, successful R2 delete,
already-missing R2 object, an unrelated R2 error at both `head()` and
`delete()`, the 50-item cap (tested with 55 candidates), the 3-failure
circuit breaker (tested with all-failing deletes), halted-run result
preservation, no-processing-after-halt, malformed policy parameters, a
literal repeated-execution idempotency check (same candidate run twice —
first `deleted`, second `already-deleted`, never a failure), and the
audit entry's exact shape (including a check that no secret-shaped
string ever appears in an entry).

Full suite: `npm test` — 66 checks across all four worker test files, all
passing.

### Source-level safety check — confirmed, not assumed

- `grep -ri "deletionExecutor" worker/src` — the **only** file
  referencing it is `deletionExecutor.ts` itself. Not imported by
  `index.ts`, not referenced by `scheduled()`, no HTTP route touches it.
- `wrangler.toml`'s `[triggers]`/`crons` — unchanged, still present but
  inert (never pushed to Cloudflare by any deploy in this project's
  history, same as every prior sprint).
- `wrangler deployments status` — unchanged, still 100% on
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` (F5d-12/F5d-13's version) — **no
  deploy occurred this sprint.**
- Grepped `deletionExecutor.ts` itself for `updateRetentionStatus`,
  `setDoc`, `deleteDoc`, `PATCH`, `POST` — the only match is the module
  comment's own prose describing why none of those are called; zero
  actual invocations.

### Validation

- Worker `tsc --noEmit`: clean.
- `npm test`: 66/66 checks pass (31 new).
- Main app `tsc`, ESLint, production build: all clean (no `src/` file was
  modified).
- Prettier: clean on every changed/added file.

### What was NOT changed by this sprint

- No R2 object, real or test, was created, modified, or deleted — every
  test ran against in-memory fakes.
- No Firestore document, real or test, was read, created, modified, or
  deleted — every test ran against an in-memory fake; the real
  `getAttachment()` addition was type-checked and unit-composed but never
  invoked against real Firestore this sprint.
- No Cron trigger was enabled or modified.
- No HTTP route was added.
- No `firestore.rules`, IAM role/binding, GCP key, or Cloudflare secret
  was touched.
- No Cloudflare resource was created.
- The Worker was not deployed — production traffic never moved.
- No `DECISIONS.md` entry was added — no new architectural decision was
  made this sprint (the counting-toward-the-cap choice is an
  implementation detail of an already-decided numeric value, not a new
  policy).

### Exact next approval gate

Before this executor can ever run for real: (1) the Firestore
post-delete lifecycle decision above needs to be made and logged in
`DECISIONS.md`; (2) only after that, wiring `runDeletionExecutor()` to an
actual invocation path (manual trigger, or eventually `scheduled()`) and
Cron activation remain two further, separately-gated approvals, exactly
as every prior sprint in this sequence has required.

---

## F5d-16 — Firestore attachment lifecycle decision (2026-08-09, decision sprint — no code change)

**Decision sprint only.** No source file was modified except for reading.
No R2 object, Firestore document, IAM, secret, or Cron setting was
touched. This sprint resolves the exact open question F5d-15 stopped at:
what should happen to a `serviceJobAttachments` metadata document once
its R2 object has been deleted. It presents options and a recommendation
only — nothing below is adopted until the user explicitly approves it,
at which point a `DECISIONS.md` entry gets logged and a follow-up sprint
implements the approved schema change.

### 1. Current attachment lifecycle model

Confirmed by reading `src/types/attachment.ts`, `src/services/attachmentRetention.ts`,
`src/repositories/firestoreAttachmentsRepository.ts`,
`src/repositories/firestore/attachmentMapping.ts`, and
`worker/src/deletionSafety.ts`/`deletionExecutor.ts`:

- `RetentionStatus = 'active' | 'expiring-soon'` — exactly two values. Its
  own comment in `attachmentRetention.ts` says so directly: _"there is no
  distinct 'expired'/'deleted' state yet because nothing in this app
  actually deletes a file... Revisit this union once F5d-3 or later
  introduces real deletion."_ **No suitable existing state represents
  "physically removed from R2."** Confirmed — `deletionSafety.ts` itself
  independently warns that `retentionStatus` must never be read as a
  deletion-eligibility or deletion-outcome signal, for the same reason.
- `Attachment` has no field of any kind that records object-existence —
  only `deleteAfter`/`retentionStatus` (time-based retention windows) and
  `retentionExtensions` (an append-only audit log of staff-extended
  retention, per DECISIONS.md #023). Nothing analogous exists for
  deletion.
- **A real precedent already exists, but only for manual staff deletion.**
  `workerAttachmentsRepository.ts`'s `deleteAttachment()` — reachable
  today only from application code, never from the Worker's Cron/executor
  path — deletes the R2 object via the Worker's DELETE route, then calls
  `firestoreAttachmentsRepository.ts`'s `deleteById()`, a genuine
  `deleteDoc()` **hard delete** of the Firestore document. This is
  Option A below, already shipped — but only for the one-at-a-time,
  staff-initiated case, not the batched, automatic, retention-driven case
  this sprint is about. The two don't have to resolve the same way, and
  currently don't need to (the manual path can keep hard-deleting
  regardless of what's decided here), but a future consistency question
  is worth flagging: should staff manual delete and automatic retention
  delete leave metadata in the same state? Not decided here.

### 2. Options

**A — Delete Firestore metadata after successful R2 deletion**

| Dimension              | Assessment                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data integrity         | Simple — no doc ever survives pointing at a gone R2 object.                                                                                                                                                                                                                                                                                                                                                           |
| Audit/history          | Weakest. Once deleted, zero record an attachment ever existed for that service job — no uploader, no category, no timestamp, nothing. For a repair system where a customer or staff member might later dispute "was there ever a before/after photo," this is a real loss, not just a cosmetic one.                                                                                                                   |
| UI implications        | Simplest — nothing to filter, nothing to badge.                                                                                                                                                                                                                                                                                                                                                                       |
| Recovery implications  | None, but consistent: bytes and metadata vanish together, no dangling reference.                                                                                                                                                                                                                                                                                                                                      |
| Query complexity       | Simplest — `getForJob()`/`getById()` never need a lifecycle filter.                                                                                                                                                                                                                                                                                                                                                   |
| Migration impact       | None — zero schema change, reuses `deleteById()` exactly as it exists today.                                                                                                                                                                                                                                                                                                                                          |
| Failure/retry behavior | If the R2 delete succeeds but the Firestore delete fails, the doc is left stale — still says `active`/`expiring-soon`, pointing at bytes that no longer exist, with nothing marking it as such. A later read (UI gallery, download attempt) would hit a 404 against R2 with no explanation. This exact failure mode is already named in `deletionSafety.ts`'s `DeletionExecutionContract.onFirestoreFailure` comment. |
| Compatibility          | Fully compatible today, zero type changes — the only option requiring no schema work at all.                                                                                                                                                                                                                                                                                                                          |

**B — Retain metadata, add an explicit `deleted` lifecycle state (widen `RetentionStatus`)**

| Dimension              | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data integrity         | Strong — clear, queryable distinction between "exists" and "was deleted."                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit/history          | Strong — full record (uploader, category, name, size, timestamps) preserved permanently, consistent with this project's established append-only-history philosophy (`timeline_events`, `notes`, `repair_report_approvals`, `retentionExtensions`).                                                                                                                                                                                                                                                                  |
| UI implications        | Every `getForJob()` consumer (photo gallery, attachment lists) needs a filter/badge for the new state — one bounded change, but touches more than one call site.                                                                                                                                                                                                                                                                                                                                                    |
| Recovery implications  | Metadata "recovers" trivially (nothing to recover, doc still there); the actual file bytes are still permanently gone either way.                                                                                                                                                                                                                                                                                                                                                                                   |
| Query complexity       | One more value to handle everywhere `retentionStatus` is already read or compared.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Migration impact       | Requires widening the `RetentionStatus` union in **two** places kept manually in sync today — `src/types/attachment.ts` and the Worker's own duplicate in `worker/src/attachmentRetention.ts`/`firestoreClient.ts` — plus every switch/comparison against that union (`deriveRetentionStatus()`, `deletionSafety.ts`'s explicit "only two values" assumption, any future UI status badge). Existing docs need no data migration (`fromFirestoreData()`'s `?? 'active'` fallback already tolerates a missing field). |
| Failure/retry behavior | Same "R2 succeeded, Firestore write failed" gap as Option A, but recoverable — a reconciliation pass can look for `deleteAfter` past due with a status still `active`/`expiring-soon` and re-verify against R2's real state, since the doc wasn't deleted.                                                                                                                                                                                                                                                          |
| Compatibility          | Reuses the existing `retentionStatus` field, no new field — but **conflicts with `deletionSafety.ts`'s own documented assumption** that this field carries exactly two values and is never a deletion signal; widening it here re-introduces the exact ambiguity that module's comments warn a future maintainer away from.                                                                                                                                                                                         |

**C — Retain metadata, use a separate deletion marker/status (new field, `RetentionStatus` untouched)**

| Dimension              | Assessment                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data integrity         | Same strength as B.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Audit/history          | Same strength as B.                                                                                                                                                                                                                                                                                                                                                                                                 |
| UI implications        | Same as B — one new condition (`deletedAt !== null`) to check at the same call sites.                                                                                                                                                                                                                                                                                                                               |
| Recovery implications  | Same as B.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Query complexity       | Same as B, but as a boolean-shaped check (`deletedAt !== null`) rather than a third string value threaded through every existing `retentionStatus` comparison.                                                                                                                                                                                                                                                      |
| Migration impact       | Smaller and cleaner than B — purely additive field (e.g. `deletedAt: string \| null`, defaulting `null`); every existing reader of `retentionStatus` (including `deletionSafety.ts`, the Worker's own copy, and `deriveRetentionStatus()`) needs zero changes, since that field's meaning and value set are untouched. Only readers that specifically care about deletion need to learn about the new field at all. |
| Failure/retry behavior | Same recoverability as B — a reconciliation pass can scan for `deleteAfter` past due with `deletedAt` still null.                                                                                                                                                                                                                                                                                                   |
| Compatibility          | Best fit: keeps `retentionStatus` meaning exactly what `deletionSafety.ts` already assumes it means (a time-based retention window signal, never a deletion-outcome signal), avoiding the exact conflation that module's own comments explicitly warn against. Mirrors the shape (a narrow, single-purpose `updateDoc`) already used for `updateRetention()`/`extendRetention()`.                                   |

### 3. Recommended option

**Option C.** It's the specific shape of "explicit lifecycle state" the
brief's own recommendation leans toward — full audit retention, matching
this project's established append-only/durable-record philosophy for
service/repair history — while avoiding Option B's side effect of
widening a union that a different, already-shipped module
(`deletionSafety.ts`) explicitly documents as a strict two-value,
non-deletion signal. Option A is not recommended: for a repair-tracking
system where an attachment (a before/after photo, a customer document)
may have dispute or audit value well after a service job closes, silently
losing all record that it ever existed is a bigger cost than the schema
work Option C avoids, and Option A's stale-doc failure mode on a
mid-sequence Firestore failure is strictly worse than B/C's (nothing
marks the doc as broken; under B/C, the reconciliation path already
described in F5d-2/F5d-3's pattern can detect and correct it).

### 4. Exact schema change required, if approved

Not implemented this sprint — proposed only:

- `src/types/attachment.ts` — add `deletedAt: string | null` to
  `Attachment`, defaulting `null` at every creation site (Mock and
  Worker-backed).
- `src/repositories/firestore/attachmentMapping.ts` — add `deletedAt` to
  `AttachmentFirestoreFields`/`toFirestoreFields()`; `fromFirestoreData()`
  gets `data.deletedAt ?? null`, the same fallback shape already used for
  `deleteAfter`/`retentionStatus`/`retentionExtensions`.
- `src/repositories/firestoreAttachmentsRepository.ts` — add a narrow
  `markDeleted(id: string, deletedAt: string): Promise<void>` to
  `AttachmentMetadataStore`, mirroring `updateRetention()`'s shape
  exactly (single-field `updateDoc()`, no read-modify-write).
- `worker/src/firestoreClient.ts` — add a `markAttachmentDeleted(docId,
deletedAt)` method, mirroring `updateRetentionStatus()`'s existing
  PATCH-with-`updateMask` pattern — the Worker has no route to
  `AttachmentMetadataStore` (that's app-side/Firebase-SDK-only), so it
  needs its own REST-based write, same as its existing
  `updateRetentionStatus()`.
- `worker/src/deletionExecutor.ts` — Step 6 (currently a deliberate stop)
  gets exactly one new call: `firestoreClient.markAttachmentDeleted(fresh.docId,
now.toISOString())`, after a successful R2 delete, before returning the
  `'deleted'` result. Requires widening `DeletionExecutorDeps.firestoreClient`'s
  `Pick<...>` to include the new method. **Not implemented this sprint —
  next sprint's scope, pending this decision.**
- Open sub-question, flagged rather than decided: should `getForJob()`/
  `getById()` filter out `deletedAt !== null` attachments themselves (so
  every existing UI caller gets the new behavior automatically, with zero
  call-site changes), or should filtering be left to callers (more
  explicit, more call sites to touch, but no risk of a caller that
  secretly wanted the record — e.g. a future admin/audit view — being
  unable to get it)? Recommend filtering at the repository read methods,
  consistent with how this project has generally kept business rules out
  of components (`CLAUDE.md`), but this is a judgment call for the
  approval, not asserted as decided.

### 5. Migration / backward-compatibility impact

- **Zero backfill needed.** Production currently holds zero attachment
  metadata documents (confirmed live as of F5d-11/F5d-13) — there is
  nothing existing to migrate.
- Purely additive field — any future doc written before this field
  existed is handled by the same `?? null` fallback pattern already used
  for every other optional field in `attachmentMapping.ts`.
- No existing reader of `retentionStatus` needs to change under Option C
  — `deletionSafety.ts`, the Worker's own retention copy, and
  `deriveRetentionStatus()` are all untouched.
- `firestore.rules`' current `serviceJobAttachments` block does not need
  a rule change for a plain additive field, but should be reviewed
  alongside whatever writes `deletedAt` (the Worker's REST client
  authenticates via its own service account, not through
  `firestore.rules` at all, consistent with how `updateRetentionStatus()`
  already writes today).

### 6. Exact decision required from the user

1. Approve **Option C** (recommended), or choose **A** or **B** instead.
2. If C: approve the field name `deletedAt: string | null` (or specify a
   different name/shape).
3. Approve the filtering judgment call above (filter in the repository's
   `getForJob()`/`getById()`, vs. leave filtering to each caller).
4. Confirm whether the existing manual staff-delete path
   (`workerAttachmentsRepository.deleteAttachment()`, currently a hard
   `deleteDoc()`) should be left as-is (a deliberate, intentional
   inconsistency with the new automatic path) or changed to match the
   newly-approved lifecycle — **not required to decide now**, flagged for
   awareness only, out of scope for this sprint either way.

Once approved, the decision gets logged in `DECISIONS.md` with the next
sequential ID (025) — not done this sprint, per this sprint's own scope
limit.

### 7. Recommended F5d-17 (after approval)

Implement the exact schema change from Section 4 above: extend the
`Attachment` type, mapping, `AttachmentMetadataStore`, and
`firestoreClient.ts`; wire `deletionExecutor.ts`'s Step 6 to call the new
`markAttachmentDeleted()`; extend `worker/test/deletionExecutor.test.mts`
with new checks covering the Firestore-write step (including a
Firestore-write-failure case, per Option C's failure/retry analysis
above); update `firestore.rules` only if required. **Still explicitly
UNWIRED** — implementing Step 6 makes the executor's per-candidate logic
complete, but does not itself call `runDeletionExecutor()` from anywhere
real; Cron activation and any invocation path remain separate, later
approvals, unchanged from F5d-15's own stopping point.

---

## F5d-17 — Implement the approved Firestore attachment lifecycle (2026-08-09)

Implements F5d-16's approved Option C (DECISIONS.md #025) exactly as
specified — no schema decision, wiring, Cron activation, or production
deletion beyond what was explicitly approved.

### Files changed

- `src/types/attachment.ts` — `Attachment.deletedAt: string | null` added.
- `src/repositories/firestore/attachmentMapping.ts` — `deletedAt` added
  to `AttachmentFirestoreFields`, `toFirestoreFields()`, and
  `fromFirestoreData()` (falls back to `null`, same pattern as every
  other optional field here).
- `src/repositories/firestoreAttachmentsRepository.ts` — `getForJob()`/
  `getById()` now exclude `deletedAt !== null` records; new
  `getForJobIncludingDeleted()` internal escape hatch; new `markDeleted()`
  write method (narrow single-field `updateDoc()`, mirroring
  `updateRetention()`'s shape). Not called by anything yet, matching
  `extendRetention()`'s own precedent.
- `src/repositories/attachmentsRepository.ts` (Mock) and
  `src/repositories/workerAttachmentsRepository.ts` — `deletedAt: null`
  added at every attachment-creation site.
- `worker/src/firestoreClient.ts` — `AttachmentRetentionRecord.deletedAt`
  added and parsed; new `markAttachmentDeleted(docId, deletedAt)` REST
  method (PATCH with `updateMask.fieldPaths=deletedAt`, mirroring
  `updateRetentionStatus()`'s exact shape).
- `worker/src/deletionSafety.ts` — `isEligibleForDeletion()` and
  `recheckEligibilityBeforeDelete()`'s Pick types widened to include
  `deletedAt`; a record with `deletedAt !== null` is now always
  ineligible ("fail closed against reprocessing"). `DeletionOutcome`'s
  `'firestore-delete-failed'` member renamed to
  `'firestore-mark-deleted-failed'`; `DeletionExecutionContract`'s
  comments updated to describe a mark, not a delete.
- `worker/src/deletionExecutor.ts` — Step 6 now calls
  `markFirestoreDeleted()`; `DeletionExecutorResultState` gains
  `'deleted-metadata-write-failed'`; `DeletionExecutorDeps.firestoreClient`
  widened to `Pick<FirestoreClient, 'getAttachment' | 'markAttachmentDeleted'>`.
- `worker/test/deletionSafety.test.mts` — fixture updated with
  `deletedAt: null`; 2 new checks for the fail-closed reprocessing guard;
  `selectDeletionCandidates`'s mixed-attachments case extended with an
  already-processed record.
- `worker/test/deletionExecutor.test.mts` — `FakeFirestoreClient` widened
  to implement `markAttachmentDeleted()` against a real in-memory store
  (not a stub) plus a `throwOnMarkDeleted` flag; 9 new checks (3 new
  scenario blocks, F5d-17a/b/c) plus updates to tests 10, 17, and 18 to
  assert the new self-healing/fail-closed/marked-not-deleted behavior.
- `DECISIONS.md` — new entry #025, recording the approved decision.
- This file and `worker/README.md` — updated.

No other file was modified. No R2 object, Firestore document, IAM,
secret, or Cron setting was touched. No Worker deployment occurred —
production traffic stayed on `9a8b83f2-861d-4700-9b4a-05260c4ee661`
throughout, confirmed via `wrangler deployments status` both before and
after this sprint's work.

### What Step 6 does now

After the R2 object is confirmed gone — either genuinely deleted this
run, or found already absent via `head()` — the executor calls
`firestoreClient.markAttachmentDeleted(docId, now)`. This is attempted in
**both** branches, not just the "really deleted it this run" branch: the
already-absent branch is only reachable when `deletedAt` was still `null`
on the fresh read (since `recheckEligibilityBeforeDelete()` already fails
closed on a non-null `deletedAt`, per `deletionSafety.ts`'s new guard) —
meaning the only way to reach it is a prior run whose own
`markAttachmentDeleted()` write failed. Attempting the write here too is
a deliberate self-heal: the metadata converges on reflecting R2's true
state within a bounded number of future runs, with no separate repair
mechanism needed.

The write never rolls back the R2 delete on failure — R2 offers no such
capability, and rolling back a completed destructive action because a
bookkeeping write failed would be worse than leaving a stale-but-visible
record. A failed write after a genuine delete is reported as the new
`'deleted-metadata-write-failed'` state, distinct from `'deleted'`.

### Result vocabulary — updated

| Result                          | Meaning                                                                                                                                                                                             | Counts toward `maxDeletionsPerRun`? | Counts toward `failureThreshold`? |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| `deleted`                       | R2 object genuinely removed this run **and** `markAttachmentDeleted()` succeeded                                                                                                                    | Yes                                 | No                                |
| `deleted-metadata-write-failed` | R2 object genuinely removed this run, but the Firestore write failed — R2 is not rolled back; the document is left stale (`deletedAt` still `null`) and self-heals on a later run                   | Yes                                 | No (see reasoning below)          |
| `already-deleted`               | `head()` found nothing — either a prior run's own successful delete, or (self-heal case) a prior run whose delete succeeded but whose write failed; `markAttachmentDeleted()` is attempted here too | No                                  | No                                |
| `skipped`                       | Any fail-closed rule tripped — including, new this sprint, "attachment already has `deletedAt` set — fail closed against reprocessing"                                                              | No                                  | No                                |
| `failed`                        | A genuine, unrelated R2 or Firestore _read_ error (never a Firestore _write_ failure — that's `deleted-metadata-write-failed` now)                                                                  | No                                  | Yes                               |
| `halted`                        | Circuit breaker tripped, never attempted                                                                                                                                                            | No                                  | No                                |

**`deleted-metadata-write-failed` does not count toward the circuit
breaker** — an explicit, flagged implementation judgment call, same
pattern as F5d-15's "only genuine deletions count toward the cap"
reasoning. The R2 delete — the actual destructive action the breaker
exists to bound — succeeded; a metadata bookkeeping failure is a
different, self-healing failure mode, and conflating it with genuine R2
failures would trip the breaker for reasons unrelated to R2 risk. Flagged
here in case the user wants this counted differently.

### Testing

14 new checks: 2 in `deletionSafety.test.mts` (the fail-closed
reprocessing guard, at both `isEligibleForDeletion()` and
`recheckEligibilityBeforeDelete()`, plus an extended
`selectDeletionCandidates()` mixed-batch case), 9 in
`deletionExecutor.test.mts` across three new scenario blocks:

- **F5d-17a** — R2 delete succeeds, `markAttachmentDeleted()` fails:
  reports `deleted-metadata-write-failed`; R2 object genuinely gone;
  Firestore left at `deletedAt: null`; counts toward `deletedCount`, not
  `failedCount`.
- **F5d-17b** — R2 object already absent, self-heal write also fails:
  still reports `already-deleted`; counts toward neither counter;
  Firestore remains unmarked for a future attempt.
- **F5d-17c** — a candidate whose fresh record already has `deletedAt`
  set is `skipped`, never reprocessed.

Plus updates to tests 10 (asserts the self-heal write actually happened),
17 (idempotency: the second run on the same candidate is now `skipped`,
not `already-deleted`, since the first run's write succeeded), and 18
(the `'deleted'` reason text now asserts the document was marked, not
deleted).

Full suite: `npm test` — **80 checks across all four worker test files,
all passing** (up from 66 before this sprint).

### Source-level safety check — confirmed, not assumed

- `grep -ri "deletionExecutor" worker/src` — still only self-referencing
  files (`deletionExecutor.ts`, `deletionSafety.ts`'s comment,
  `firestoreClient.ts`'s comment). `index.ts` has zero matches.
- `wrangler.toml`'s `[triggers]`/`crons` — unchanged, still inert.
- `wrangler deployments status` — unchanged, still 100% on
  `9a8b83f2-861d-4700-9b4a-05260c4ee661` — **no deploy occurred this
  sprint.**

### Validation

- Worker `tsc --noEmit`: clean.
- `npm test`: 80/80 checks pass (14 new).
- Main app `tsc -b`, ESLint, production build: all clean.
- Prettier: clean on every file changed this sprint. (Two pre-existing,
  untouched worker files — `src/attachmentRetention.ts`, `src/index.ts`
  — show pre-existing formatting drift unrelated to this sprint's
  changes; left as-is, out of this sprint's scope.)

### What was NOT changed by this sprint

- No R2 object, real or test, was created, modified, or deleted.
- No Firestore document, real or test, was read, created, modified, or
  deleted — every test ran against in-memory fakes.
- No Cron trigger was enabled or modified.
- No HTTP route was added.
- No `firestore.rules`, IAM role/binding, GCP key, or Cloudflare secret
  was touched.
- The Worker was not deployed.
- The manual staff-delete path (`workerAttachmentsRepository.deleteAttachment()`)
  is unchanged — it still hard-deletes the Firestore document. F5d-16
  flagged reconciling this with the new automatic-path behavior as a
  separate, not-yet-decided question; not addressed this sprint.

### Exact next approval gate

The Firestore attachment lifecycle question is now fully resolved and
implemented. What remains before this executor can ever run for real is
unchanged from F5d-15/F5d-16: wiring `runDeletionExecutor()` to an actual
invocation path (manual trigger, or eventually `scheduled()`) and Cron
activation — two separate, explicitly-gated approvals.

---

## F5d-18 Phase 4B.1 — Firestore 403 diagnosis (2026-08-09, read-only)

The isolated F5d-18 preview harness invoked `runDeletionExecutor()` once for
one explicitly approved synthetic attachment. Its R2 delete succeeded, but
the subsequent `markAttachmentDeleted()` PATCH returned Firestore `403
PERMISSION_DENIED`. The R2 object remains absent; the metadata document is
retained with `deletedAt: null`. No retry, manual metadata repair, IAM change,
or second destructive action was performed.

### Addressing and request-shape findings

- The candidate's Firestore document ID is the deterministic encoded value
  `service-jobs__qa-f5d18-20260809-389a0e97fb9a4cf5b2ffc6198b4b9b7a__documents__1d09ecf8-82de-4588-8ad2-5bcbb0bbf5a0-qa-delete-test.pdf`.
- `getAttachment(candidate.docId)` reads that document and
  `parseAttachmentDocument()` obtains `fresh.docId` from the final segment of
  the returned Firestore resource name. `executeSingleDeletion()` then passes
  that same `fresh.docId` to `markAttachmentDeleted()`.
- The exact target constructed by the current source is
  `https://firestore.googleapis.com/v1/projects/luxace-service/databases/(default)/documents/serviceJobAttachments/service-jobs__qa-f5d18-20260809-389a0e97fb9a4cf5b2ffc6198b4b9b7a__documents__1d09ecf8-82de-4588-8ad2-5bcbb0bbf5a0-qa-delete-test.pdf?updateMask.fieldPaths=deletedAt`.
  It points to the existing QA document — not the raw slash-containing R2
  path, and neither under- nor double-encodes its ID.
- The request is `PATCH` with an `updateMask` limited to `deletedAt` and a
  body containing only that string field. It has no `currentDocument`
  precondition, so Firestore documents the operation as an update-or-insert
  PATCH rather than an explicitly existence-guarded update.

### IAM findings

Read-only `gcloud` verification confirmed that
`firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com` remains
the sole member of `projects/luxace-service/roles/firestoreRetentionSweeper`.
The role still contains `datastore.entities.update` alongside its existing
get/list/database permissions. Firestore's IAM reference lists
`datastore.entities.update` as the required permission for `documents.patch`.
The captured 403 contains only generic `PERMISSION_DENIED`; it names no
additional denied permission or alternate resource. Therefore the exact cause
of the authorization denial is not established by the available evidence, and
there is no evidence that document addressing is responsible.

### Minimal future code consideration (not implemented)

Add `currentDocument.exists=true` to `markAttachmentDeleted()`'s PATCH URL.
This makes the intended existing-document-only lifecycle explicit and prevents
an accidental upsert if a future caller supplies a missing document. It is a
safety improvement, not a proven fix for this 403; no source change, deploy,
or retry is authorized by this diagnostic entry.

---

## F5d-18 Phase 4B.2 — existing-document precondition and self-heal (2026-08-09)

`markAttachmentDeleted()` now constructs its PATCH target with `URL` and
`URLSearchParams`, with exactly these query parameters:

- `updateMask.fieldPaths=deletedAt`
- `currentDocument.exists=true`

The request body and deterministic document-ID addressing were unchanged. The
new offline regression test captures the real client request and proves the
PATCH method, the exact deterministic attachment document target, the
single-field update mask, the existing-document precondition, the
deletedAt-only body, and fail-closed behavior on a simulated precondition
failure. `npm run typecheck` and the complete Worker test suite passed.

An isolated QA-only preview version,
`98352e2a-22d1-4462-8367-280b1dcfdea9`, was uploaded with the single fixed
F5d-18 candidate, the production `ATTACHMENTS_BUCKET` binding, and the
existing Firestore secret names. It has only a `fetch` handler and no Cron
configuration. Production traffic remained 100% on
`9a8b83f2-861d-4700-9b4a-05260c4ee661`.

The fixed preview endpoint was attempted once. The local PowerShell HTTP
client raised a null-reference exception before exposing the response body,
so the structured JSON result was not captured and the endpoint was not
retried. Independent reads prove the self-heal completed: the exact R2 key
remained absent (404), the exact existing Firestore attachment document was
retained, and its `deletedAt` became `2026-08-09T11:38:43.494Z`. All other
attachment fields matched the pre-invocation snapshot. A query by the fixed
QA job ID returned exactly that one document. The real deletion safety check
now rejects it because `deletedAt` is set, while the app-side internal
include-deleted metadata path still retains it for audit/history use.

No production traffic shift, Cron change, IAM change, Firestore rule change,
or second endpoint invocation occurred. The local QA harness/config files
used only to upload the preview were removed after verification; Cloudflare
retains the isolated preview version in version history.

---

## F5d-18 Phase 5 — QA cleanup and closure (2026-08-09)

Before cleanup, the retained Firestore record was re-read and matched the
exact approved synthetic document ID, QA job ID, R2 path,
`uploadedBy: qa-f5d18-synthetic`, and non-null `deletedAt`. One exact REST
DELETE was then issued for that single document as QA cleanup only. The local
PowerShell HTTP client again raised a null-reference exception while handling
the response, so the DELETE was not repeated. Independent read-only checks
then verified the exact document was 404, the exact QA job-ID query returned
zero documents, the prior `.exists=false` artifact was 404, and the exact QA
R2 key remained 404. No customer record or object was touched.

The Worker typecheck and all 86 offline checks across five test files passed;
main-app `tsc -b`, ESLint with zero warnings, and the production Vite build
also passed. Production traffic remained 100% on
`9a8b83f2-861d-4700-9b4a-05260c4ee661`. Cron remains NONE; this phase made
no Cloudflare trigger/configuration change. The approved synthetic metadata
hard-delete is cleanup only and does not alter DECISIONS.md #025.

---

## What this is for

The Worker's `scheduled()` handler already runs a real reconciliation sweep
(`retentionSweep.ts`) — but only ever against the Firestore Emulator, and
only when triggered locally via `wrangler dev --test-scheduled`. This Worker
has never been deployed, and there is no real Google Cloud credential
anywhere in this project. This document is the plan for the one piece
needed to eventually change that: a dedicated, narrowly-scoped Google
service account the deployed Worker would authenticate as.

Nothing here enables production execution. Deploying the Worker, enabling
the live Cron, and creating this service account for real are all still
separate, explicitly-gated steps — see "Exact remaining approval required"
in the F5d-6 completion report.

## Service account design

|                     |                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | `firestore-retention-sweeper`                                                                                                                                                                                                                                                   |
| Project             | `luxace-service` (matches `.firebaserc` and `wrangler.toml`'s `FIRESTORE_PROJECT_ID` — already the single real Firebase/GCP project this codebase targets)                                                                                                                      |
| Full resource email | `firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`                                                                                                                                                                                                            |
| Purpose             | Authenticates the Worker's `scheduled()` retention sweep to Firestore. Used for nothing else — not shared with Product Master's Firestore access (that's the Vite app's client-side Firebase SDK, a completely different auth path), not shared with any other Worker function. |
| Display name        | "Firestore Retention Sweeper"                                                                                                                                                                                                                                                   |

### Why a dedicated service account, not a shared one

This project has no other server-side Google credential anywhere — the main
app talks to Firestore via the client-side Firebase SDK (API-key-based, not
IAM), and Product Master's Firestore access runs entirely from the browser.
This would be the first Google Cloud IAM credential this project has ever
had. Scoping it to exactly one narrow purpose (this Worker, this sweep)
keeps the blast radius of a future leak as small as the task requires,
rather than creating a general-purpose "backend service account" that
accumulates permissions over time.

## IAM role design

### The permission model, verified (not guessed)

Per Google's own predefined-role documentation
(`docs.cloud.google.com/datastore/docs/access/iam`, checked 2026-08-08):

- **`roles/datastore.viewer`** grants `datastore.entities.get` and
  `datastore.entities.list` — read-only. No write access at all, so this
  alone cannot patch `retentionStatus`.
- **`roles/datastore.user`** grants `datastore.entities.*` — a wildcard
  covering get, list, **create, and delete**, not just update. The delete
  grant is exactly what this service account must not have.

Neither predefined role matches "read + update, no delete, no create."
Google Cloud supports **custom IAM roles** built from any valid permission
string, including individual `datastore.entities.*` permissions — used here
to close that gap.

### Proposed custom role: `firestoreRetentionSweeper`

Defined in [`gcp/firestore-retention-sweeper-role.yaml`](gcp/firestore-retention-sweeper-role.yaml):

| Permission                  | Why                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datastore.entities.get`    | Read a single attachment document.                                                                                                                                                                                                                                                                                                                         |
| `datastore.entities.list`   | `firestoreClient.ts`'s `listAttachments()` — lists the `serviceJobAttachments` collection.                                                                                                                                                                                                                                                                 |
| `datastore.entities.update` | `firestoreClient.ts`'s `updateRetentionStatus()` — the sweep's one write operation, always with `updateMask.fieldPaths=retentionStatus`.                                                                                                                                                                                                                   |
| `datastore.databases.get`   | Included defensively — present in _both_ predefined roles above, likely needed to resolve the `(default)` database via the REST API. Not empirically confirmed against a real project this sprint (no real credential exists to test with) — verify when the real connection is first tested, and drop it from the role if it turns out to be unnecessary. |

Deliberately **excluded**: `datastore.entities.create`, `datastore.entities.delete`,
anything under `datastore.indexes.*`/`datastore.databases.delete`/
`datastore.databases.update` (no index or database administration),
`resourcemanager.projects.*` (Console project visibility, irrelevant to
API calls), `datastore.namespaces.*`/`datastore.statistics.*`/
`datastore.schemas.*`/`appengine.applications.get` (present in the
predefined roles for legacy/Console reasons, not needed by this Worker's
two REST operations).

### The scoping limit this role cannot close — read this before approving

**Firestore/Datastore IAM permissions apply at the database level, not
per-collection.** There is no IAM mechanism — custom role or otherwise —
that can say "this service account may only touch `serviceJobAttachments`."
A service account holding `firestoreRetentionSweeper` can `get`/`list`/
`update` documents in **every** collection in the `luxace-service` default
Firestore database: `products`, `customers`, `serviceJobs`, and
`serviceJobAttachments` alike.

The actual boundary — "this Worker only ever touches
`serviceJobAttachments`, and only ever reads or patches `retentionStatus`"
— is enforced entirely by `worker/src/firestoreClient.ts`'s code (two
methods, one collection, one field, no delete method exists on the client
at all) and by keeping this credential exclusive to this Worker. It is
**not**, and cannot be, an IAM-enforced guarantee. This is a real
platform limitation, not an oversight in this design — flagging it
explicitly rather than implying a narrower scope than IAM can actually
provide.

### Do Firestore Security Rules help close that gap? No.

Per Google's own documentation (`docs.cloud.google.com/firestore/native/docs/security/iam`):
Firestore Security Rules are enforced for mobile/web client access
(Firebase Auth-based, via the client SDKs this app's frontend already
uses). **Server client libraries and direct REST/gRPC access authenticated
via a Google Cloud IAM service account bypass Security Rules entirely** and
are governed solely by IAM permissions. This project's `firestore.rules`
(currently `allow read, write: if true` on every migrated collection,
pre-auth posture — see `DECISIONS.md` and the rules file's own comment)
would have **zero effect** on this service account's access even if it were
tightened later. Do not rely on `firestore.rules` as a second layer of
defense for this credential — it isn't one. This is also why this sprint
makes no change to `firestore.rules`: there would be no security benefit,
only a false sense of one.

## Where the private key will live

- **Never**: `.env`, `.env.example`, any `VITE_*` variable, the React
  bundle, `wrangler.toml`, `.dev.vars` (even locally — see
  `worker/README.md`), or any committed file.
- **Only**: a Cloudflare Worker secret, set via `wrangler secret put
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Cloudflare stores secrets encrypted
  and makes them available to the Worker only as `env.*` bindings at
  runtime — never visible in `wrangler.toml`, the dashboard's source view,
  or `wrangler tail` output (Cloudflare redacts known secret bindings from
  logs).
- The one-time local file `gcloud iam service-accounts keys create`
  produces (a JSON key file) must be deleted from disk immediately after
  its two fields are copied into `wrangler secret put` — see the exact
  commands below.

## Exact commands (none run yet — see "F5d-8 — Proposed live changes" above)

All commands target project `luxace-service` and assume `gcloud` is
authenticated as a project owner/IAM admin. As of F5d-7, `gcloud` **is**
installed and authenticated as `sacool.spizy@gmail.com` in this
environment — the blocker is approval, not tooling.

### 1. Enable required APIs — DONE (2026-08-08)

```bash
gcloud services enable iam.googleapis.com --project=luxace-service
```

Executed and verified. See "Category 1 — executed" above for the result,
including the unrequested `iamcredentials.googleapis.com` side effect.

Turns on the Identity and Access Management API — required before
`gcloud iam roles create` or `gcloud iam service-accounts create` (steps 2
and 3) will work; confirmed disabled by F5d-7's audit. **Not** included:
`iamcredentials.googleapis.com`. That API backs a different flow entirely
— _impersonating_ a service account without holding its key (`signJwt`,
`generateAccessToken`, etc.). This Worker's design (`googleAuth.ts`) does
the opposite: it holds the private key directly and signs its own
RFC 7523 JWT-bearer assertion via Web Crypto, then POSTs straight to
`oauth2.googleapis.com/token`. It never calls the IAM Credentials API, so
enabling it would add an unused surface for no benefit — corrected here
from F5d-7's earlier "likely needed later" speculation, which turned out
to be wrong once the actual auth flow was re-checked against this
question.

Verify (read-only, safe to run any time after):

```bash
gcloud services list --project=luxace-service --enabled --filter="config.name=iam.googleapis.com"
```

### 2. Create the custom role

```bash
gcloud iam roles create firestoreRetentionSweeper \
  --project=luxace-service \
  --file=worker/gcp/firestore-retention-sweeper-role.yaml
```

Defines the role. Grants no one anything by itself — a role must be bound
(step 4) to have any effect.

Verify: `gcloud iam roles describe firestoreRetentionSweeper --project=luxace-service`

### 3. Create the service account

```bash
gcloud iam service-accounts create firestore-retention-sweeper \
  --project=luxace-service \
  --display-name="Firestore Retention Sweeper" \
  --description="Cloudflare Worker retention-reconciliation sweep. Read+update only, no delete, no R2 access. See worker/PRODUCTION_FIRESTORE_ACCESS.md."
```

Creates the identity only. No key, no permissions — cannot authenticate as
anything and holds no access even if it somehow could, until step 4.

Verify: `gcloud iam service-accounts describe firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`

### 4. Bind the custom role to the service account

```bash
gcloud projects add-iam-policy-binding luxace-service \
  --member="serviceAccount:firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com" \
  --role="projects/luxace-service/roles/firestoreRetentionSweeper"
```

The step that actually grants access — attaches step 2's role to step 3's
identity in the project's IAM policy. After this, the service account
_would_ be able to get/list/update Firestore entities project-wide (see
"scoping limit" above) _if_ it could authenticate — it still can't, since
no key exists yet and creating one is explicitly excluded from F5d-8.

Verify: `gcloud projects get-iam-policy luxace-service --flatten="bindings[].members" --filter="bindings.members:firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com"`

### 5. Create the key — STOP: do not run without separate, explicit approval

This is the step that creates the actual secret material. Per every prior
sprint's boundary (F5d-6, F5d-7, F5d-8), this command is documented, not
executed, and should not be run even after steps 1–4 are approved without
a distinct, explicit go-ahead.

```bash
gcloud iam service-accounts keys create ./firestore-retention-sweeper-key.json \
  --iam-account=firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com
```

### 6. Move the key into Cloudflare, then destroy the local copy

```bash
# Run from worker/. Prompts for the value interactively — paste the
# "client_email" field from the JSON key file.
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL

# Prompts for the value interactively — paste the "private_key" field
# (including the literal \n line breaks as they appear in the JSON).
wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

# FIRESTORE_PROJECT_ID is not a secret and is already in wrangler.toml's
# [vars] — no `secret put` needed for it.

# Immediately delete the local key file — it must not persist on disk once
# both secrets are set, and must never be committed.
rm ./firestore-retention-sweeper-key.json
```

`wrangler secret put`/`wrangler deploy`/`wrangler tail` are exactly the
three commands this sprint's boundary named as requiring separate
explicit approval — none were run.

## Key rotation and revocation

- **Planned rotation**: `gcloud iam service-accounts keys create` again
  (a service account can hold multiple active keys simultaneously) →
  `wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` with the new
  value (overwrites the old secret for future invocations) →
  `gcloud iam service-accounts keys delete <OLD_KEY_ID> --iam-account=firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`
  once satisfied the new key is live.
- **Emergency revocation** (suspected leak): the fastest stop is
  `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=...` —
  invalidates that key immediately, independent of Cloudflare. If broader
  disablement is warranted:
  `gcloud iam service-accounts disable firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`
  blocks all authentication for the account without deleting it (reversible
  via `... enable`).
- **Full teardown**: remove the IAM binding
  (`gcloud projects remove-iam-policy-binding ...`), delete the service
  account (`gcloud iam service-accounts delete ...`), delete the custom
  role (`gcloud iam roles delete firestoreRetentionSweeper --project=luxace-service`),
  and `wrangler secret delete` both Worker secrets.
- Listing a service account's key IDs for either operation:
  `gcloud iam service-accounts keys list --iam-account=firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com`.

## What this service account cannot do

- Cannot delete any Firestore document (no `datastore.entities.delete` in
  the custom role).
- Cannot create new Firestore documents (no `datastore.entities.create`) —
  consistent with the Worker's own code, which never creates
  `serviceJobAttachments` documents (only the app's upload flow does, via a
  different auth path entirely).
- Cannot manage IAM, indexes, backups, or database configuration (no
  `*.admin`/`*.owner`-level permissions anywhere in the custom role).
- Has **no R2 permissions of any kind** — Cloudflare and Google Cloud are
  entirely separate IAM systems; this credential authenticates only to
  Google APIs and is meaningless to Cloudflare's R2 API. The Worker's R2
  access remains the platform-granted binding it already has (see
  `worker/README.md`'s "Security posture" section) — completely unrelated
  to this service account.
- Cannot access any Google Cloud project other than `luxace-service`.
- **Can** (see "scoping limit" above) technically `get`/`list`/`update`
  documents in Firestore collections this Worker's code never touches —
  bounded by code review and credential exclusivity, not by IAM.

## What remains untested

- Whether `datastore.databases.get` is actually required for the REST
  calls this client makes, or is unnecessary defensive inclusion — cannot
  be determined without a real credential and a real request, which this
  sprint's boundary explicitly excludes.
- The real OAuth2 exchange and real Firestore REST calls under this
  specific role once it exists for real (F5d-5 already proved the JWT
  signing/OAuth2 _logic_ is correct in isolation, and proved the Firestore
  REST client's _behavior_ against the Emulator — neither exercised a real
  Google-issued token against a project actually enforcing this custom
  role's permission boundaries).
- Whether GCP accepts every permission in the custom role's `includedPermissions`
  list without modification — custom role creation validates permission
  names against the live API at apply-time; a typo or an unsupported
  permission would surface as a `gcloud` error at that point, not before.

## F5d-21 Service Job retention-anchor foundation

F5d-21 changed only the main application’s Service Job persistence path. In
Firestore mode, a first non-terminal-to-terminal Service Job transition now
writes `serviceJobs/{jobId}.closedAt` through Firestore server time and waits
for a committed server read before reporting success. Existing string-form
closure timestamps remain readable; an ambiguous historical terminal record
without a trustworthy value remains ineligible for any future retention
reconciliation until separately reconciled.

No Worker source, Worker deployment, Cloudflare configuration, Cron trigger,
R2 object, IAM role/binding, service-account key, or Worker secret changed in
F5d-21. The Worker still does not read `serviceJobs`, and automatic deletion
remains unwired.

## F5d-22 Attachment lifecycle foundation

F5d-22 changed only main-application lifecycle code. Before a Worker-backed
attachment upload, the app resolves the parent through the Firestore Service
Job repository; a trustworthy durable `closedAt` supplies the attachment's
`deleteAfter = closedAt + 365 days`. Open, absent, malformed, and historical
ambiguous anchors retain the fail-safe null/active state. A missing parent is
rejected before the Worker receives an upload request.

Manual app-side attachment deletion now retains the Firestore metadata and
writes `deletedAt` only after the Worker's idempotent R2 DELETE succeeds.
The Worker did not gain `serviceJobs` access, no executor code changed, and
no automatic path, Cron trigger, deployment, R2 object, Firestore document,
IAM binding, credential, or secret changed in F5d-22.

## F5d-23.2 Brand scope and staff identity decision lock (documentation only)

F5d-23.2 approves the durable authorization model that a later Worker
authorization implementation must use. It makes no live change: no Firestore
document or rule, Firebase Auth provider/user, staff profile, Worker
deployment, IAM binding, secret, R2 object, or Cron trigger was created or
modified.

- Canonical brand IDs are `bruno-thailand` and `join-lux-club`, with future
  Firestore brand documents `brands/bruno-thailand` (`code: "BRN"`,
  `name: "Bruno Thailand"`) and `brands/join-lux-club` (`code: "JLC"`,
  `name: "Join Lux Club"`). Tracking codes are not authorization IDs.
- Future durable Service Jobs require immutable `brandId: string`. Any absent
  or malformed value must be denied by Worker authorization, never inferred
  from a tracking number or defaulted in a mapper.
- The approved staff-only allowlist is `staffProfiles/{firebaseUid}` with
  `brandId: string` only. One brand per staff member is sufficient; no role
  field is approved. A browser client must never create, update, or delete a
  profile. Initial provisioning is manual/privileged through Firebase Auth
  and Firestore Console; email/password is the approved future sign-in
  direction, but is not enabled here.
- The Worker service account's Firestore IAM access remains separate from
  browser Firestore Security Rules. F5d-24 may add only source-level token
  verification and route authorization; it must not change IAM, Firestore
  rules, Auth configuration, or live data.

Read-only inventory found eight production `serviceJobs` without `brandId`.
The seven checked-in seed document IDs are approved for a later explicit
backfill to `bruno-thailand`. `BRN-2026-000001` is unresolved/unclassified,
is not approved for backfill, and must fail closed until separately confirmed.
Public/customer tracking remains separate from staff authorization and cannot
provide generic public Worker file access.

## F5d-24 Staff authorization foundation (source-only, offline-tested)

F5d-24 adds no live access or production mutation. No Worker deployment,
Cloudflare setting/secret, IAM role/binding, Firestore rule, Firebase Auth
provider/user, `brands` document, `staffProfiles` document, Service Job
backfill, R2 object, or Cron trigger changed.

Source now uses the existing `datastore.entities.get` permission for narrow,
direct document reads of `staffProfiles/{firebaseUid}` and
`serviceJobs/{jobId}`. It performs no collection scans for authorization.
Both documents must have the same canonical brand ID (`bruno-thailand` or
`join-lux-club`); absent, malformed, mismatched, or legacy missing-brand
records are forbidden. This requires no permission beyond the existing
four-permission custom role.

The Worker verifies Firebase ID tokens with Web Crypto RS256 signature
verification, Google signing-key caching/one unknown-`kid` refresh, and claim
checks for project audience/issuer, expiry, issue/authentication times, and
non-empty subject. Key-fetch and validation failures are fail-closed. Routes
return `401` for token failure and `403` for staff/job authorization failure
before R2 access. This is source behavior only until live prerequisites are
explicitly approved and provisioned.

All six Worker regression scripts pass offline (113 checks). They include
negative token/signing-key cases, direct-profile/job authorization cases, and
route guards proving unauthorized requests cannot reach fake R2 operations.

## F5d-26 application integration status (not deployed)

No production Firestore, Worker, IAM, service account, GCP key, Cloudflare
secret, R2 object, Worker version, or Cron trigger changed in F5d-26. The app
now has source-only Firebase session handling that supplies the existing
Worker file-route authorization with an ID token. A missing token fails
closed; one `401` refreshes once; a second `401` signs the local session out;
a `403` is surfaced without an alternate-scope retry. No bearer token is
logged.

This does not alter the Worker service account's server-side Firestore IAM
model or make browser Rules effective for it. Browser Rules were prepared and
locally emulator-tested only; they are not deployed. Production Worker version
remains `9a8b83f2-861d-4700-9b4a-05260c4ee661`, Cron is inactive, and
`deletionExecutor` remains unwired.

## F5d-27.1 public-tracking boundary (not implemented or deployed)

F5d-27.1 adds documentation decisions only. A future public tracking route
must be a separate narrow Worker/backend endpoint, not a public Firestore
query: it directly reads one Service Job by reference, hashes the submitted
random 256-bit token, compares it in constant time with the stored hash, and
returns only the approved public DTO. The raw token arrives in a POST body
after browser extraction from a URL fragment; it must not be logged or used
for staff file APIs.

This route must not expose attachments, R2 keys/URLs, generic Service Job
reads, staff authorization, or internal DTO fields. It requires source/emulator
implementation and rate-limit/abuse review before a live rollout. No Worker
code, service-account permission, secret, Firestore data, or production
configuration changed in F5d-27.1.

## F5d-28 ownership and public-tracking foundation (source/emulator only)

F5d-28 made no production access change. The existing service account role,
Cloudflare Worker version `9a8b83f2-861d-4700-9b4a-05260c4ee661`, R2 binding,
traffic allocation, and inactive Cron state remain unchanged. No token was
issued, no Firestore document/rule was deployed, and no IAM/secret/key was
created or changed.

The Worker source now uses the already-granted direct-document GET capability
to read exactly `serviceJobs/{trackingReference}` for the source-only public
tracking route. It does not add a Firestore collection query, attachment read,
R2 operation, or new Firestore write. A token match returns a safe DTO only;
all non-success outcomes are intentionally indistinguishable. The route has a
fail-closed rate-limit seam for a later live abuse-control decision.

The app and local Rules source now model customer membership with canonical
`brandIds`; local Rule tests prove same-brand membership reads, cross-brand and
legacy-missing membership denial, global product reads for valid staff, client
writes denied, and no public Firestore reads. Because collection-query Rules
must be provable from `array-contains`, the read predicate checks the active
staff brand's membership; canonical-list enforcement remains in the typed app
mapper and trusted provisioning process, while all browser customer writes are
denied. Nine local emulator Rules tests and 134 Worker checks passed.

## F5d-29 trusted token issuance boundary (source only)

No production Firestore operation occurred. Source adds an internal-only
writer for `serviceJobs/{trackingReference}.publicTrackingTokenHash`; it uses
PATCH, `updateMask.fieldPaths=publicTrackingTokenHash`, and
`currentDocument.exists=true`. It accepts either a hash string or `null` for
revocation and never creates a document. The existing custom role already has
`datastore.entities.update`; no permission, binding, key, secret, or IAM change
was needed or made.

The writer is consumed only by an unexposed issuance/rotation/revocation
module. There is no public or staff HTTP issuance endpoint, no scheduled
caller, and no production invocation path. Offline contracts prove the exact
PATCH shape plus one-time fragment share-link issuance, rotation invalidation,
and revocation. Worker checks now total 144. Production Worker version,
traffic, Cron, R2 state, and deletion-executor wiring remain unchanged.

## UX-L10N1 language boundary (source only)

UX-L10N1 changes no Worker or Firestore access behavior. Staff localization is
presentation-only Thai-first; persisted Service Job and attachment values,
Worker authorization, public token handling, and Firestore IAM remain
unchanged. Public Tracking owns a separate four-locale presentation layer
(`th`, `en`, `ja`, `zh-CN`) and persists only a locale code in browser storage;
the Worker DTO and token boundary are unchanged. No Worker deployment,
Firestore/R2 operation, IAM/secret change, or Cron change occurred.

## PUB-TRACK-1 human-enterable public code boundary (source only)

PUB-TRACK-1 adds no production Firestore operation. The browser-side manual
credential is normalized to `SRV-{YYYY}-{MMDD}-{XXXXXX}` and sent only in the
body of the narrow `POST /public/tracking` route. The Worker accepts one
bounded `{ code }` object, normalizes and validates it, reads the private
`publicTrackingCodes/{normalizedCode}` lookup document directly, then reads
one `serviceJobs/{serviceJobId}` document. It hashes the submitted code with
SHA-256 and constant-time compares it with `publicTrackingCodeHash` before
constructing the approved minimal public DTO. Failure is generic and
fail-closed. There is no collection scan, attachment/R2 access, staff
authorization, public Firestore read, or raw-code/hash response.

`publicTrackingCodeHash` is mapped on ServiceJob but excluded from normal
client update patches. `src/services/publicTrackingCodeIssuance.ts` is only a
trusted preparation seam: it generates a bounded collision-free code and
hash, but does not expose a browser/public route or persist anything. A future
privileged issuance transaction must atomically reserve the private lookup
document and Service Job hash, show the raw code once, and enforce production
rate limiting. The six-character suffix has `36^6 = 2,176,782,336` possible
values and is not equivalent to the legacy 256-bit fragment token. With no
limiter, distributed guessing is unlimited; a basic per-IP limiter slows
casual abuse but is bypassable. Production needs layered edge/IP/device
throttling, monitoring, and fail-closed behavior when the limiter is
unavailable.

The existing `/public/tracking/{trackingReference}` fragment-token route is
retained as a transitional compatibility path. No Firestore Rules, IAM role,
secret, Auth provider, Worker deployment, R2 operation, production data, or
Cron change occurred in PUB-TRACK-1. Any future Rules plan must keep the
private lookup collection inaccessible to browsers; Worker server-side IAM is
separate from those Rules. Production remains on
`9a8b83f2-861d-4700-9b4a-05260c4ee661` with 100% traffic, Cron inactive, and
`deletionExecutor` unwired. Offline Worker validation passes 147 checks.

## F5d-31 deployment-safety source change

F5d-31 removed the default `[triggers]`/`crons` declaration from
`worker/wrangler.toml`. This is a source-only deployment-safety correction:
ordinary Worker code deployment cannot register or activate Cron. The
`scheduled()` handler remains available only to the platform scheduler or
local scheduled testing, is not reachable through `fetch()`, and still calls
only `runRetentionSweep()`. `deletionExecutor` remains unwired. No Worker
deployment, Cloudflare configuration, Firestore/R2 operation, IAM/secret
change, or Cron activation occurred.

## F5d-32 privileged Service Job allocator (source specification only)

The source-only `POST /service-jobs` Worker route needs `datastore.entities.create` in addition to the existing get/list/update permissions. The checked-in custom role YAML now declares that permission and still declares no delete permission. It has **not** been applied to production. The route's Firestore operation is intentionally narrow: begin a transaction, read a private idempotency record/sequences/candidate documents, then atomically create the idempotency record and Service Job while updating the two sequence records. Browser Firestore Rules separately deny `serviceJobIntakeKeys`, `numberSequences`, and Service Job create; Worker IAM is not governed by browser Rules.

Production remains blocked pending explicit IAM application, Rules deployment, Worker deployment, staff/Auth provisioning, and controlled rollout approval. No production Firestore, IAM, R2, secrets, or Worker state changed.

### Current source IAM role state (F5d-35 reconciliation)

Earlier no-create wording above is historical F5d-6/F5d-29 context. The
current source-controlled role in `gcp/firestore-retention-sweeper-role.yaml`
contains exactly `datastore.databases.get`, `datastore.entities.get`,
`datastore.entities.list`, `datastore.entities.update`, and
`datastore.entities.create`. It does **not** contain
`datastore.entities.delete`. This is source specification only; the applied
production role and binding remain a future read-only preflight item.

## F5d-33 review / F5d-34 source-only remediation

F5d-33 independently re-verified F5d-32 against real Firestore/emulator behavior and found the allocator's Firestore access was not yet safe to deploy, despite being source-correct. `commitServiceJobCreation` sent `update.name` as a full HTTP fetch URL rather than the bare resource name (`projects/{project}/databases/(default)/documents/{collection}/{id}`) Firestore's `:commit` RPC requires — confirmed against the local emulator, which returned `400` ("lacks \"projects\" at index 0") before Rules or IAM were ever evaluated. Every Service Job creation would have failed this way against real Firestore too, IAM notwithstanding — the malformed request never reaches the point where IAM permissions matter.

F5d-34 fixed this in `worker/src/firestoreClient.ts` only: the resource name is now derived from the Firestore project/database path independently of `baseUrl` (which differs between the local emulator and real Firestore, and was never the right source for a resource name). No permission requirement changed — this was a request-shape defect, not an authorization gap; the custom role's `datastore.entities.create`/`update`/`get`/`list` (still no `delete`) remain exactly what the allocator needs. `worker/test/serviceJobAllocatorCommit.test.mts` is new: it drives the real `createFirestoreClient()` end to end (stubbing only `fetch`) and asserts every commit write names a bare resource path, closing the gap where every prior allocator test only exercised a fake `ServiceJobCreationDataAccess` and could not have caught a REST-serialization defect.

F5d-34 separately fixed a Firestore Rules defect (the `serviceJobs` update rule denied updates to any Service Job that predates F5d-32, since it dereferenced privileged fields legacy documents don't have — see PROJECT_STATE.md/AI_HANDOFF.md's F5d-34 entries for the full record) and a Worker CORS defect (missing `Authorization`/`Idempotency-Key` in `Access-Control-Allow-Headers`, which would have blocked the browser's own preflight for every authenticated route, files included, before any request reached the Worker). Neither changes IAM or production access; both are recorded here because they were found during this production-access-readiness review.

No production Firestore, IAM, R2, secrets, Auth, or Worker state changed by F5d-33 or F5d-34. `BRN-2026-000001` remains untouched. Cron remains inactive; `deletionExecutor` remains unwired.

## F5d-37 Gate 2 production provisioning

Gate 2 enabled Firebase Email/Password and created one approved staff Auth
identity, `sacool.spizy@gmail.com` (`qUbRfp5Iv3drX9IEZL3DyLBvcsj2`), two
canonical brand documents, and one staff profile. The exact records are
`brands/bruno-thailand` (`code: "BRN"`, `name: "Bruno Thailand"`),
`brands/join-lux-club` (`code: "JLC"`, `name: "Join Lux Club"`), and
`staffProfiles/qUbRfp5Iv3drX9IEZL3DyLBvcsj2` with only
`brandId: "bruno-thailand"`.

The first profile attempt accidentally created `staffProfiles/.exists=false`
because a PowerShell interpolation placed the precondition text in the
document path. It contained only the intended canonical `brandId`, was
immediately detected, and was removed under an explicitly approved
`updateTime` precondition. Verification proved the stray document absent and
the intended UID document absent before the safe URI-construction retry. The
incident is fully remediated with no residual production impact; retain this
record for audit.

The seven approved seed Service Jobs still have no `brandId`,
`BRN-2026-000001` remains at update time `2026-08-08T06:19:09.065089Z`, and
the seven customers still lack `brandIds`. No IAM, Rules, Worker, R2, secret,
Cron, or deletion-executor change occurred. In particular, the applied role
remains four permissions (database get and entity get/list/update), without
entity create or delete. Firebase Hosting remains uninitialized.
