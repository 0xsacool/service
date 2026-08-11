import { isValidAttachmentKey } from './paths.ts';
import type { AttachmentRetentionRecord } from './firestoreClient';

// F5d-13 — deletion safety foundation. Nothing in this file deletes
// anything: no R2 call, no Firestore write, no import of firestoreClient's
// mutating methods. Pure eligibility/validation/audit logic only, meant to
// be the shared contract a future, separately-approved deletion executor
// would be built on top of — see worker/PRODUCTION_FIRESTORE_ACCESS.md's
// "F5d-13" section for the full design rationale and the policy values
// this module deliberately does NOT define (max deletions per run,
// failure threshold, retry count, grace period — none are decided
// anywhere in this project; inventing them here was explicitly out of
// scope for this sprint).

export type DeletionOutcome =
  | 'deleted'
  | 'already-deleted'
  | 'skipped-not-eligible'
  | 'skipped-invalid-key'
  | 'r2-delete-failed'
  // F5d-17 (DECISIONS.md #025) — renamed from the F5d-13 placeholder
  // 'firestore-delete-failed': the approved design (Option C) never
  // deletes the Firestore document, only marks it via deletedAt, so a
  // post-R2-success Firestore failure is a failed *mark*, not a failed
  // delete.
  | 'firestore-mark-deleted-failed';

export interface DeletionEligibilityResult {
  eligible: boolean;
  reason: string;
}

// Fail-closed by construction: every branch that can't positively confirm
// eligibility returns `eligible: false` — there is no code path that
// defaults to `true` on missing or malformed data. `retentionStatus`
// ('active' | 'expiring-soon') is deliberately NOT the eligibility
// signal — 'expiring-soon' covers both "within the 30-day warning
// window" and "already overdue" (see attachmentRetention.ts's own
// comment), so checking status alone would make files eligible for
// deletion up to 30 days before they're actually supposed to be deleted.
// The only correct signal is a direct comparison against the stored
// `deleteAfter` timestamp itself.
export function isEligibleForDeletion(
  attachment: Pick<AttachmentRetentionRecord, 'deleteAfter' | 'deletedAt'>,
  now: Date
): DeletionEligibilityResult {
  // F5d-17 (DECISIONS.md #025) — an attachment already marked deletedAt
  // is fully processed: its R2 object is gone and its Firestore metadata
  // already reflects that. Never re-select it as a candidate — this is
  // what keeps a retained, deletedAt-stamped record from being picked up
  // by a future run as if it still needed deleting.
  if (attachment.deletedAt !== null) {
    return {
      eligible: false,
      reason: 'attachment already has deletedAt set — fail closed against reprocessing',
    };
  }
  if (attachment.deleteAfter === null) {
    return { eligible: false, reason: 'deleteAfter is null (open job) — fail closed' };
  }
  const deleteAfterMs = Date.parse(attachment.deleteAfter);
  if (Number.isNaN(deleteAfterMs)) {
    return {
      eligible: false,
      reason: 'deleteAfter is not a parseable date — fail closed',
    };
  }
  if (now.getTime() < deleteAfterMs) {
    return { eligible: false, reason: 'now is before deleteAfter — not yet due' };
  }
  return { eligible: true, reason: 'now is at or past deleteAfter' };
}

// Re-verification, immediately before any future deletion call, against a
// freshly re-read record — not the record used when the candidate list
// was originally built. `staleAttachment`/`freshAttachment` are typed
// identically on purpose: the caller must supply two independently
// obtained values, not the same object twice, so this can't be satisfied
// by accident with a single stale read. If anything relevant changed
// between selection and delete time (e.g. a staff "Extend Retention"
// action ran in between, per attachmentRetentionExtension.ts), this
// returns not-eligible — the original candidacy is never trusted on its
// own at delete time.
export function recheckEligibilityBeforeDelete(
  staleAttachment: Pick<AttachmentRetentionRecord, 'deleteAfter'>,
  freshAttachment: Pick<AttachmentRetentionRecord, 'deleteAfter' | 'deletedAt'>,
  now: Date
): DeletionEligibilityResult {
  if (staleAttachment.deleteAfter !== freshAttachment.deleteAfter) {
    return {
      eligible: false,
      reason:
        'deleteAfter changed since candidate selection (e.g. retention was extended) — re-verify required',
    };
  }
  return isEligibleForDeletion(freshAttachment, now);
}

// The sole source of truth for "does this key belong to the expected
// attachment namespace" is the same ATTACHMENT_KEY_PATTERN the Worker
// already enforces on every GET/DELETE (worker/src/paths.ts) — reused
// here, not reimplemented, so there is exactly one place this pattern is
// defined. A deletion target derived from Firestore's `path` field must
// pass this before it is ever used to address a real R2 object; an
// attacker-influenced or corrupted `path` value that doesn't match the
// convention is never trusted as a deletion target.
export function isDeletionCandidateKeyValid(path: string): boolean {
  return isValidAttachmentKey(path);
}

// Selects candidates from a listed snapshot, applying eligibility and key
// validation, then truncates to `maxDeletionsPerRun` — a REQUIRED
// parameter with no default anywhere in this module or elsewhere in this
// project. This is deliberate: F5d-13 was explicitly instructed not to
// invent this number. Any future caller must supply a real, approved
// value; there is no fallback that would let a run proceed with an
// implicit, unreviewed cap.
export interface DeletionCandidate {
  docId: string;
  path: string;
  deleteAfter: string;
}

export function selectDeletionCandidates(
  attachments: AttachmentRetentionRecord[],
  now: Date,
  maxDeletionsPerRun: number
): {
  candidates: DeletionCandidate[];
  skipped: Array<{ docId: string; reason: string }>;
} {
  if (!Number.isInteger(maxDeletionsPerRun) || maxDeletionsPerRun < 0) {
    throw new Error(
      `selectDeletionCandidates: maxDeletionsPerRun must be a non-negative integer, got ${maxDeletionsPerRun}`
    );
  }

  const candidates: DeletionCandidate[] = [];
  const skipped: Array<{ docId: string; reason: string }> = [];

  for (const attachment of attachments) {
    const eligibility = isEligibleForDeletion(attachment, now);
    if (!eligibility.eligible) {
      skipped.push({ docId: attachment.docId, reason: eligibility.reason });
      continue;
    }
    if (!isDeletionCandidateKeyValid(attachment.path)) {
      skipped.push({
        docId: attachment.docId,
        reason: 'path failed key-namespace validation',
      });
      continue;
    }
    // deleteAfter is guaranteed non-null here — isEligibleForDeletion()
    // only returns eligible:true when it parsed successfully above.
    candidates.push({
      docId: attachment.docId,
      path: attachment.path,
      deleteAfter: attachment.deleteAfter as string,
    });
  }

  return { candidates: candidates.slice(0, maxDeletionsPerRun), skipped };
}

// Per-run circuit breaker. `failureThreshold` is REQUIRED with no
// default, same reasoning as maxDeletionsPerRun above — this project has
// never decided a number for it.
export function shouldHaltRun(failuresSoFar: number, failureThreshold: number): boolean {
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new Error(
      `shouldHaltRun: failureThreshold must be a positive integer, got ${failureThreshold}`
    );
  }
  return failuresSoFar >= failureThreshold;
}

// Auditability. Never includes a secret, a token, a private key, or file
// bytes/content — only identifiers, a human-readable reason, a
// timestamp, and the outcome. `outcome: 'already-deleted'` is the
// concrete expression of the idempotency requirement: a future executor
// that finds the R2 object already gone on a repeated/retried run must
// record that as a successful, non-destructive outcome — never as a
// failure, and never by attempting a second destructive action.
export interface DeletionAuditEntry {
  attachmentId: string;
  objectKey: string;
  reason: string;
  timestamp: string;
  outcome: DeletionOutcome;
}

export function buildDeletionAuditEntry(
  attachmentId: string,
  objectKey: string,
  reason: string,
  outcome: DeletionOutcome,
  now: Date
): DeletionAuditEntry {
  return { attachmentId, objectKey, reason, timestamp: now.toISOString(), outcome };
}

// Documents the required execution order for the real deletion executor
// (worker/src/deletionExecutor.ts) — R2 delete MUST succeed (or be
// confirmed already-gone) before the Firestore metadata document is
// touched. Updated by F5d-17 (DECISIONS.md #025): the Firestore side of
// step2 is a narrow field *mark* (deletedAt), never a document delete —
// Option A (hard-delete the Firestore doc) was explicitly considered and
// rejected in favor of retaining the metadata permanently as an audit
// record. This still mirrors
// src/repositories/workerAttachmentsRepository.ts's deleteAttachment()
// (manual staff delete) for the R2-before-Firestore ordering, but
// deliberately diverges on what happens to the Firestore document itself
// — that manual path still hard-deletes; this automated path never does.
// `outcome: 'r2-delete-failed'` MUST short-circuit before any Firestore
// write is attempted; `outcome: 'firestore-mark-deleted-failed'` can only
// be reached after R2 deletion has already succeeded (or was confirmed
// already-gone). This type exists to make that contract explicit — it
// defines the shape, not the behavior; no function in this file calls R2
// or Firestore's write methods.
export interface DeletionExecutionContract {
  readonly step1: 'delete R2 object first';
  readonly step2: 'mark the Firestore metadata document (deletedAt) only after step1 succeeds — never delete the document itself';
  readonly onR2Failure: 'return r2-delete-failed; do not touch Firestore; do not treat as success';
  readonly onFirestoreFailure: 'return firestore-mark-deleted-failed; R2 object is already gone, so this leaves a stale-but-visible Firestore record (deletedAt still null) rather than a silent orphan — self-healed by a later run once eligibility/recheck naturally re-selects it (deletedAt is null, deleteAfter unchanged), since head() will then find the object already absent';
}
