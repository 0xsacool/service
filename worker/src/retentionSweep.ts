import type { Env } from './env.ts';
import { createFirestoreClient } from './firestoreClient.ts';
import { deriveRetentionStatus } from './attachmentRetention.ts';

export interface RetentionSweepResult {
  attachmentsScanned: number;
  attachmentsUpdated: number;
  errors: number;
  // true only when listing itself failed — the sweep made zero writes.
  // false (even with errors > 0) means listing succeeded and the sweep
  // attempted every relevant record, some of which may have failed
  // individually (see the per-record catch below).
  aborted: boolean;
}

export interface RetentionDryRunEntry {
  docId: string;
  storedRetentionStatus: string;
  calculatedRetentionStatus: string;
  wouldUpdate: boolean;
}

export interface RetentionDryRunResult {
  attachmentsTotal: number;
  attachmentsOpenJob: number;
  attachmentsWithDeleteAfter: number;
  storedStatusDistribution: Record<string, number>;
  calculatedStatusDistribution: Record<string, number>;
  wouldUpdateCount: number;
  entries: RetentionDryRunEntry[];
  aborted: boolean;
}

// F5d-5 — reconciliation only. Recomputes retentionStatus from each
// attachment's *already-stored* deleteAfter; never derives or writes
// deleteAfter itself (that stays app-side, in
// src/services/attachmentRetentionBackfill.ts, which reads ServiceJob.closedAt
// — this sweep never reads the serviceJobs collection at all). There is no
// R2 import anywhere in this file or anything it calls, and no method on
// FirestoreClient can delete a document — this sweep cannot delete
// anything, by construction, not just by convention.
//
// Open-job attachments (deleteAfter === null) are skipped entirely — they
// already carry the correct 'active' default from creation and have
// nothing to reconcile, same rule attachmentRetentionBackfill.ts follows.
//
// Failure handling: a failure listing attachments aborts the whole sweep
// with zero writes attempted (nothing to safely partially-apply). A
// failure updating one specific attachment is caught and counted, but does
// not stop the sweep from continuing to the next attachment — one bad
// record should never block reconciliation of everything else.
export async function runRetentionSweep(
  env: Env,
  now: Date = new Date()
): Promise<RetentionSweepResult> {
  const client = createFirestoreClient(env);

  let attachments;
  try {
    attachments = await client.listAttachments();
  } catch (err) {
    console.error(
      '[retention-sweep] Failed to list attachments — aborting, no changes made:',
      err
    );
    return { attachmentsScanned: 0, attachmentsUpdated: 0, errors: 1, aborted: true };
  }

  const relevant = attachments.filter((attachment) => attachment.deleteAfter !== null);

  let attachmentsUpdated = 0;
  let errors = 0;

  for (const attachment of relevant) {
    const expectedStatus = deriveRetentionStatus(attachment.deleteAfter, now);
    if (expectedStatus === attachment.retentionStatus) {
      continue;
    }
    try {
      await client.updateRetentionStatus(attachment.docId, expectedStatus);
      attachmentsUpdated += 1;
    } catch (err) {
      console.error(`[retention-sweep] Failed to update "${attachment.docId}":`, err);
      errors += 1;
    }
  }

  return {
    attachmentsScanned: relevant.length,
    attachmentsUpdated,
    errors,
    aborted: false,
  };
}

// F5d-11 — dry-run mode. Shares the exact same read path and the exact
// same calculation (client.listAttachments(), deriveRetentionStatus()) as
// runRetentionSweep() above, so this proves what the real sweep *would*
// do, not a reimplementation of it. The only difference: this function
// never calls client.updateRetentionStatus() — there is no call to that
// method anywhere in this function's body, so it is structurally
// incapable of writing, not just configured not to. It also never reads
// or writes deleteAfter (only compares against the value already stored
// on each attachment, same as the real sweep), never creates a document,
// and has no R2 import — same safety properties as runRetentionSweep(),
// verified in worker/PRODUCTION_FIRESTORE_ACCESS.md's F5d-11 section.
export async function runRetentionSweepDryRun(
  env: Env,
  now: Date = new Date()
): Promise<RetentionDryRunResult> {
  const client = createFirestoreClient(env);

  let attachments;
  try {
    attachments = await client.listAttachments();
  } catch (err) {
    console.error('[retention-dry-run] Failed to list attachments — aborting:', err);
    return {
      attachmentsTotal: 0,
      attachmentsOpenJob: 0,
      attachmentsWithDeleteAfter: 0,
      storedStatusDistribution: {},
      calculatedStatusDistribution: {},
      wouldUpdateCount: 0,
      entries: [],
      aborted: true,
    };
  }

  const storedStatusDistribution: Record<string, number> = {};
  const calculatedStatusDistribution: Record<string, number> = {};
  const entries: RetentionDryRunEntry[] = [];
  let attachmentsOpenJob = 0;
  let attachmentsWithDeleteAfter = 0;
  let wouldUpdateCount = 0;

  for (const attachment of attachments) {
    if (attachment.deleteAfter === null) {
      attachmentsOpenJob += 1;
    } else {
      attachmentsWithDeleteAfter += 1;
    }

    const calculatedRetentionStatus = deriveRetentionStatus(attachment.deleteAfter, now);
    const wouldUpdate =
      attachment.deleteAfter !== null &&
      calculatedRetentionStatus !== attachment.retentionStatus;
    if (wouldUpdate) {
      wouldUpdateCount += 1;
    }

    storedStatusDistribution[attachment.retentionStatus] =
      (storedStatusDistribution[attachment.retentionStatus] ?? 0) + 1;
    calculatedStatusDistribution[calculatedRetentionStatus] =
      (calculatedStatusDistribution[calculatedRetentionStatus] ?? 0) + 1;

    entries.push({
      docId: attachment.docId,
      storedRetentionStatus: attachment.retentionStatus,
      calculatedRetentionStatus,
      wouldUpdate,
    });
  }

  return {
    attachmentsTotal: attachments.length,
    attachmentsOpenJob,
    attachmentsWithDeleteAfter,
    storedStatusDistribution,
    calculatedStatusDistribution,
    wouldUpdateCount,
    entries,
    aborted: false,
  };
}
