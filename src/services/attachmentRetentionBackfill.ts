import { repositories } from '../repositories/repositoryProvider';
import { createFirestoreAttachmentMetadataStore } from '../repositories/firestoreAttachmentsRepository';
import { computeAttachmentRetention } from './attachmentRetention';

export interface AttachmentRetentionBackfillResult {
  jobsScanned: number;
  closedJobsScanned: number;
  attachmentsScanned: number;
  attachmentsUpdated: number;
}

// Despite the name (kept from F5d-2, where this started as a one-time
// backfill for docs written before deleteAfter/retentionStatus existed),
// this is a full reconciliation, not just a migration: it recomputes
// against the `now` it's given on every call, so it also correctly catches
// an attachment that was genuinely 'active' on a previous run but has since
// drifted into the 30-day 'expiring-soon' window purely because time
// passed — exactly what F5d-3 needed a "scheduled reconciliation path" to
// do, with no logic changes required to get there.
//
// Reconciles serviceJobAttachments metadata against each attachment's
// parent ServiceJob.closedAt using the same computeAttachmentRetention()
// that upload() would use if it had closedAt available — this is the one
// place that actually does, since it reads ServiceJob data directly.
//
// This is also the function a Worker Cron Trigger would eventually call on
// a schedule (see worker/src/index.ts's scheduled() handler) — but as of
// F5d-3, that handler is a local-only, undeployed no-op placeholder: the
// Worker has no Firestore credential of any kind (no service account, no
// REST auth flow — that's a new trust boundary nobody has decided on yet),
// so wiring the two together is deliberately left for a later sprint. Until
// then, this function is invoked manually (browser console) or by test
// code, same as F5d-2.
//
// Firestore-only, deliberately: never imports anything Worker/R2-related,
// so it structurally cannot touch a file's bytes, only a metadata doc's
// deleteAfter/retentionStatus fields — it can never delete an attachment
// doc either, only patch these two fields (see updateRetention() in
// firestoreAttachmentsRepository.ts). Never touches a ServiceJob document
// either — Firestore ServiceJob records stay permanent regardless of what
// this does (F5c.1's decided rule).
//
// Idempotent by construction: computeAttachmentRetention is pure and
// deterministic for a given (closedAt, now), and this only calls
// updateRetention() when the computed values actually differ from what's
// already stored — a second run against unchanged data with the same `now`
// (or any `now` that doesn't cross the 30-day boundary) performs zero
// writes. Open jobs are skipped entirely: their attachments already carry
// the correct null/'active' default from creation time, so there's nothing
// to reconcile.
export async function backfillAttachmentRetention(
  now: Date = new Date()
): Promise<AttachmentRetentionBackfillResult> {
  const jobs = repositories.serviceJobs.getAll();
  const actionableJobs = jobs
    .map((job) => ({ job, retention: computeAttachmentRetention(job.closedAt, now) }))
    .filter(({ retention }) => retention.deleteAfter !== null);
  const store = await createFirestoreAttachmentMetadataStore();

  let attachmentsScanned = 0;
  let attachmentsUpdated = 0;

  for (const { job, retention: expected } of actionableJobs) {
    const attachments = store.getForJob(job.id);
    for (const attachment of attachments) {
      attachmentsScanned += 1;
      const alreadyCorrect =
        attachment.deleteAfter === expected.deleteAfter &&
        attachment.retentionStatus === expected.retentionStatus;
      if (!alreadyCorrect) {
        await store.updateRetention(attachment.id, expected);
        attachmentsUpdated += 1;
      }
    }
  }

  return {
    jobsScanned: jobs.length,
    closedJobsScanned: actionableJobs.length,
    attachmentsScanned,
    attachmentsUpdated,
  };
}
