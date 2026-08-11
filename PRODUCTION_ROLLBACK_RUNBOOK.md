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

## Deferred test improvement

The Rules emulator suite covers legacy updates and hash immutability. A future
test-only improvement should explicitly attempt to add `createdAt` to a legacy
document and assert rejection. It is not a rollout change and is not part of
this phase.
