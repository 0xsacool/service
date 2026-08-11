import type { RetentionStatus, ServiceJob } from '../types';
import { isTrustworthyServiceJobClosedAt } from './serviceJobClosure';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// F5c.1's decided retention rule: files are retained 1 year after a Service
// Job actually closes, with a 30-day warning window before deletion.
export const RETENTION_PERIOD_DAYS = 365;
export const EXPIRING_SOON_WINDOW_DAYS = 30;

export interface AttachmentRetention {
  deleteAfter: string | null;
  retentionStatus: RetentionStatus;
}

// Same shape, but deleteAfter is guaranteed non-null — only
// computeExtendedRetention returns this, since it always anchors to a real
// `now`, never a possibly-null closedAt.
export interface ExtendedAttachmentRetention {
  deleteAfter: string;
  retentionStatus: RetentionStatus;
}

export function resolveParentAttachmentRetention(
  parent: Pick<ServiceJob, 'id' | 'closedAt'> | undefined,
  now: Date = new Date()
): AttachmentRetention {
  if (!parent) {
    throw new Error('Cannot create attachment: parent Service Job does not exist');
  }

  return computeAttachmentRetention(parent.closedAt, now);
}

// F5d-5 — extracted out of computeAttachmentRetention() so the "is this
// already-known deleteAfter within the warning window" half of the math has
// exactly one home, reusable by anything that already has a deleteAfter and
// only needs to re-derive retentionStatus from it (worker/'s retention
// sweep — see worker/src/attachmentRetention.ts's comment — never derives
// deleteAfter itself, only this). Pure, behavior-preserving extraction: the
// F5d-2/F5d-3 boundary tests (exact 30-day inclusive threshold, overdue
// still resolves to 'expiring-soon') were re-run unchanged against this
// version and produced identical results.
export function deriveRetentionStatus(
  deleteAfter: string | null,
  now: Date
): RetentionStatus {
  if (!deleteAfter) {
    return 'active';
  }
  const warningStartMs =
    new Date(deleteAfter).getTime() - EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY;
  return now.getTime() >= warningStartMs ? 'expiring-soon' : 'active';
}

// The single source of truth for "what should this attachment's retention
// fields be right now," given only its parent ServiceJob's closedAt — pure
// and deterministic (no I/O), so both the upload-time default and the
// backfill reconciliation (attachmentRetentionBackfill.ts) can share it and
// can never compute two different answers for the same input. `now`
// defaults to the real clock but is overridable so this stays exactly
// testable, boundary included.
//
// retentionStatus is 'expiring-soon' starting exactly 30 days before
// deleteAfter (inclusive) through and past deleteAfter itself — there's no
// separate "expired" state (see RetentionStatus's own comment) since
// nothing yet actually deletes a file once its time is up.
export function computeAttachmentRetention(
  closedAt: string | null,
  now: Date = new Date()
): AttachmentRetention {
  if (!isTrustworthyServiceJobClosedAt(closedAt)) {
    return { deleteAfter: null, retentionStatus: 'active' };
  }

  const deleteAfter = new Date(
    new Date(closedAt).getTime() + RETENTION_PERIOD_DAYS * MS_PER_DAY
  ).toISOString();

  return { deleteAfter, retentionStatus: deriveRetentionStatus(deleteAfter, now) };
}

// F5d-4 — "Extend Retention"'s duration. No document in this project (the
// F5c.1 proposal, BUSINESS_RULES.md, DECISIONS.md) defines a distinct
// extension period; RETENTION_PERIOD_DAYS is the only retention duration
// ever decided. Rather than invent a new number, an extension is defined
// here as "grant another full standard retention period, starting now" —
// reusing RETENTION_PERIOD_DAYS verbatim via computeAttachmentRetention,
// just anchored to the extension moment instead of ServiceJob.closedAt.
// (`computeAttachmentRetention(now.toISOString(), now)` would compute the
// identical answer, but passing `now` off as if it were a closedAt reads
// wrong to a future maintainer — this wrapper keeps the real anchor
// explicit.) Always resolves to 'active': RETENTION_PERIOD_DAYS (365) is
// always far outside EXPIRING_SOON_WINDOW_DAYS (30) of itself, so this
// isn't a separate hardcoded guarantee, it falls out of the same shared
// math every other retention state uses.
export function computeExtendedRetention(
  now: Date = new Date()
): ExtendedAttachmentRetention {
  const { deleteAfter, retentionStatus } = computeAttachmentRetention(
    now.toISOString(),
    now
  );
  // deleteAfter is only ever null when computeAttachmentRetention's closedAt
  // argument is null — impossible here, now.toISOString() is always a real
  // value. Narrows the type rather than asserting it away with `as string`.
  if (deleteAfter === null) {
    throw new Error('computeExtendedRetention: unreachable — anchor is never null');
  }
  return { deleteAfter, retentionStatus };
}
