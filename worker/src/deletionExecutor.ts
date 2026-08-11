import type { FirestoreClient } from './firestoreClient';
import {
  recheckEligibilityBeforeDelete,
  isDeletionCandidateKeyValid,
  shouldHaltRun,
  type DeletionCandidate,
} from './deletionSafety.ts';

// F5d-15 — the real R2 deletion executor, built behind F5d-13's safety
// foundation. COMPLETE and production-capable, but deliberately UNWIRED:
// nothing in this file is imported by index.ts, nothing calls it from
// scheduled(), no HTTP route reaches it. See
// worker/PRODUCTION_FIRESTORE_ACCESS.md's "F5d-15" section for the full
// record of that sprint.
//
// THE FIRESTORE POST-DELETE LIFECYCLE — resolved by F5d-16/F5d-17
// (DECISIONS.md #025): once an R2 object is confirmed gone (deleted this
// run, or found already absent), this executor marks the Firestore
// metadata document's `deletedAt` field — it never deletes the document.
// Option A (hard-delete the metadata) was explicitly evaluated and
// rejected in F5d-16 in favor of retaining a permanent, queryable audit
// record. See markFirestoreDeleted() below for the exact write and its
// failure handling.

// A minimal, structurally-compatible slice of R2Bucket — the real
// env.ATTACHMENTS_BUCKET (a full R2Bucket) satisfies this interface, but
// tests can supply a plain in-memory fake without any Cloudflare runtime
// involved. head() is used first, deliberately, so the executor can tell
// "object already gone" (a null return, not an error) apart from a real
// R2 failure (a thrown exception) before ever calling delete().
export interface DeletionExecutorR2Bucket {
  head(key: string): Promise<{ key: string } | null>;
  delete(key: string): Promise<void>;
}

export interface DeletionExecutorDeps {
  firestoreClient: Pick<FirestoreClient, 'getAttachment' | 'markAttachmentDeleted'>;
  bucket: DeletionExecutorR2Bucket;
  now: Date;
}

export type DeletionExecutorResultState =
  | 'deleted'
  // F5d-17 — the R2 object was genuinely deleted this run, but the
  // follow-up Firestore write recording that (deletedAt) failed. The R2
  // deletion is not rolled back (R2 has no such capability, and rolling
  // back a destructive action on a write failure would be worse than
  // leaving a stale-but-visible record) — see markFirestoreDeleted()'s
  // comment for the self-healing path a later run takes.
  | 'deleted-metadata-write-failed'
  | 'already-deleted'
  | 'skipped'
  | 'failed'
  | 'halted';

export interface DeletionExecutorResult {
  attachmentId: string;
  objectKey: string;
  result: DeletionExecutorResultState;
  reason: string;
  timestamp: string;
  errorClassification?: string;
}

export interface DeletionExecutorRunResult {
  results: DeletionExecutorResult[];
  attemptedCount: number;
  deletedCount: number;
  failedCount: number;
  halted: boolean;
  haltedReason: string | null;
}

function buildResult(
  candidate: Pick<DeletionCandidate, 'docId' | 'path'>,
  state: DeletionExecutorResultState,
  reason: string,
  now: Date,
  errorClassification?: string
): DeletionExecutorResult {
  return {
    attachmentId: candidate.docId,
    objectKey: candidate.path,
    result: state,
    reason,
    timestamp: now.toISOString(),
    ...(errorClassification ? { errorClassification } : {}),
  };
}

// Structural validity of the candidate itself, independent of Firestore —
// catches a malformed/corrupted candidate before any network call is
// made. `docId` must be non-empty and must not contain a raw "/" (real
// Firestore doc IDs for this collection always have "/" replaced by "__"
// — see attachmentMapping.ts's attachmentDocId() in the main app; a raw
// "/" here means something upstream is already wrong).
function isStructurallyValidCandidate(candidate: DeletionCandidate): boolean {
  if (!candidate.docId || candidate.docId.includes('/')) {
    return false;
  }
  if (!candidate.path) {
    return false;
  }
  return true;
}

// F5d-17 — after the R2 object is confirmed gone (just deleted, or found
// already absent), mark the Firestore metadata document's deletedAt.
// Never throws — a write failure here must not be treated as an R2
// failure or bubble up past the caller; it's reported via the returned
// result's state/reason instead. Because recheckEligibilityBeforeDelete()
// already required fresh.deletedAt === null to reach this point (see
// isEligibleForDeletion()'s fail-closed check in deletionSafety.ts), this
// is always a genuine first mark attempt, never a redundant one.
async function markFirestoreDeleted(
  docId: string,
  deps: DeletionExecutorDeps
): Promise<{ succeeded: true } | { succeeded: false; message: string }> {
  try {
    await deps.firestoreClient.markAttachmentDeleted(docId, deps.now.toISOString());
    return { succeeded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { succeeded: false, message };
  }
}

// Executes exactly one candidate: fresh re-read -> re-check eligibility ->
// re-validate the key -> confirm the R2 object is gone -> mark the
// Firestore metadata document. Never throws for an expected/handled
// condition; only a Firestore read failure is allowed to propagate (the
// caller's batch loop treats that as this candidate's failure, not a
// silent success).
async function executeSingleDeletion(
  candidate: DeletionCandidate,
  deps: DeletionExecutorDeps
): Promise<DeletionExecutorResult> {
  const { firestoreClient, bucket, now } = deps;

  // Fail-closed: malformed candidate ID/key structure.
  if (!isStructurallyValidCandidate(candidate)) {
    return buildResult(
      candidate,
      'skipped',
      'attachment ID or object key is malformed — fail closed',
      now
    );
  }

  // Step 2 (R2 DELETION ORDER): re-read current Firestore metadata.
  let fresh;
  try {
    fresh = await firestoreClient.getAttachment(candidate.docId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(
      candidate,
      'failed',
      'fresh metadata re-read failed',
      now,
      message
    );
  }

  // Fail-closed: attachment metadata is missing entirely.
  if (fresh === null) {
    return buildResult(
      candidate,
      'skipped',
      'attachment metadata no longer exists — fail closed',
      now
    );
  }

  // Step 3: recalculate/confirm eligibility from the authoritative,
  // freshly-read record — never from the stale candidate alone. Reuses
  // deletionSafety.ts's recheckEligibilityBeforeDelete() rather than
  // reimplementing the eligibility math here.
  const recheck = recheckEligibilityBeforeDelete(candidate, fresh, now);
  if (!recheck.eligible) {
    return buildResult(candidate, 'skipped', `re-check failed: ${recheck.reason}`, now);
  }

  // Step 4: validate the (freshly-read) object key again — never trust
  // the candidate's key alone by this point, since it came from a
  // potentially-stale selection pass.
  if (!isDeletionCandidateKeyValid(fresh.path)) {
    return buildResult(
      candidate,
      'skipped',
      'object key failed re-validation against the attachment namespace',
      now
    );
  }

  // Step 5: delete the R2 object. head() first, deliberately — R2's
  // delete() resolves successfully whether or not the key existed, so it
  // alone can't distinguish "genuinely deleted" from "was already gone."
  // A thrown exception from either call is a real R2 failure, never
  // silently treated as already-deleted.
  let objectWasAlreadyAbsent: boolean;
  try {
    const existing = await bucket.head(fresh.path);
    objectWasAlreadyAbsent = existing === null;
    if (!objectWasAlreadyAbsent) {
      await bucket.delete(fresh.path);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(candidate, 'failed', 'R2 delete operation failed', now, message);
  }

  // Step 6 (F5d-17, DECISIONS.md #025): the R2 object is now confirmed
  // gone — mark the Firestore metadata document's deletedAt. Attempted in
  // both branches (a real delete this run, or an already-absent object
  // found on a re-run — most likely a prior run's own markFirestoreDeleted
  // that failed, self-healing here) so the metadata always converges on
  // reflecting R2's true state, however many runs it takes.
  const mark = await markFirestoreDeleted(fresh.docId, deps);

  if (objectWasAlreadyAbsent) {
    return buildResult(
      candidate,
      'already-deleted',
      mark.succeeded
        ? 'R2 object was already absent — idempotent no-op; Firestore metadata now marked deleted'
        : `R2 object was already absent — idempotent no-op; Firestore mark-deleted write failed and will be retried by a later run: ${mark.message}`,
      now,
      mark.succeeded ? undefined : mark.message
    );
  }

  if (!mark.succeeded) {
    return buildResult(
      candidate,
      'deleted-metadata-write-failed',
      `R2 object deleted, but the Firestore deletedAt write failed — the metadata document is left stale (deletedAt still null) and will be self-healed by a later run once head() confirms the object already gone: ${mark.message}`,
      now,
      mark.message
    );
  }

  return buildResult(
    candidate,
    'deleted',
    'R2 object deleted and Firestore metadata marked deletedAt — the document itself was retained, never hard-deleted (DECISIONS.md #025)',
    now
  );
}

// Batch entry point. Applies both approved safety limits explicitly —
// callers cannot omit them (see deletionSafety.ts's own required-
// parameter reasoning, reused verbatim here) and cannot substitute
// different numbers without also changing this call site, which is
// itself gated by DECISIONS.md #024.
export async function runDeletionExecutor(
  candidates: DeletionCandidate[],
  deps: DeletionExecutorDeps,
  maxDeletionsPerRun: number,
  failureThreshold: number
): Promise<DeletionExecutorRunResult> {
  // Fail-closed on invalid policy parameters — a misconfigured run must
  // never proceed silently with an implicit fallback.
  if (!Number.isInteger(maxDeletionsPerRun) || maxDeletionsPerRun < 0) {
    throw new Error(
      `runDeletionExecutor: maxDeletionsPerRun must be a non-negative integer, got ${maxDeletionsPerRun}`
    );
  }
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new Error(
      `runDeletionExecutor: failureThreshold must be a positive integer, got ${failureThreshold}`
    );
  }

  const results: DeletionExecutorResult[] = [];
  let deletedCount = 0;
  let failedCount = 0;
  let halted = false;
  let haltedReason: string | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) {
      continue;
    }

    // Max-deletions-per-run: only genuinely destructive R2 deletions
    // count against this cap — an already-absent object requires no
    // destructive action, so it doesn't consume the budget meant to
    // bound how much real deletion a single run performs.
    if (deletedCount >= maxDeletionsPerRun) {
      for (const remaining of candidates.slice(i)) {
        results.push(
          buildResult(
            remaining,
            'skipped',
            `maximum deletions per run (${maxDeletionsPerRun}) reached — not processed`,
            deps.now
          )
        );
      }
      break;
    }

    // Circuit breaker: halt before attempting another candidate once the
    // failure threshold has been reached.
    if (shouldHaltRun(failedCount, failureThreshold)) {
      halted = true;
      haltedReason = `failure threshold (${failureThreshold}) reached after ${failedCount} failure(s)`;
      for (const remaining of candidates.slice(i)) {
        results.push(buildResult(remaining, 'halted', haltedReason, deps.now));
      }
      break;
    }

    const result = await executeSingleDeletion(candidate, deps);
    results.push(result);
    // 'deleted-metadata-write-failed' counts toward deletedCount (the R2
    // object — the actual destructive action the cap bounds — really is
    // gone) but deliberately NOT toward failedCount/the circuit breaker:
    // the R2 delete itself succeeded, so this isn't the kind of
    // destructive-action risk the breaker exists to bound, and it's
    // self-healing (see markFirestoreDeleted()'s comment) rather than a
    // condition where halting further R2 deletions helps. Flagged here as
    // an explicit, overridable implementation judgment call, same as the
    // F5d-15 precedent for what counts toward the 50-per-run cap.
    if (
      result.result === 'deleted' ||
      result.result === 'deleted-metadata-write-failed'
    ) {
      deletedCount += 1;
    } else if (result.result === 'failed') {
      failedCount += 1;
    }
  }

  return {
    results,
    attemptedCount: results.filter(
      (r) =>
        r.result === 'deleted' ||
        r.result === 'deleted-metadata-write-failed' ||
        r.result === 'failed' ||
        r.result === 'already-deleted'
    ).length,
    deletedCount,
    failedCount,
    halted,
    haltedReason,
  };
}
