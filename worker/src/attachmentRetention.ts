// F5d-5 — deliberate, minimal duplication of
// src/services/attachmentRetention.ts's deriveRetentionStatus()/
// EXPIRING_SOON_WINDOW_DAYS/RetentionStatus. worker/ and src/ are separate
// deployable projects with no code-sharing boundary between them (same
// precedent as worker/src/paths.ts's ATTACHMENT_CATEGORIES duplicating
// src/types/attachment.ts's AttachmentCategory, established in F5a/F5b) —
// reaching a relative import across that boundary would make the Worker's
// esbuild bundle implicitly depend on the main app's file layout, and any
// unrelated future change to src/services/attachmentRetention.ts (e.g. a
// new import that isn't Workers-compatible) could silently break the
// Worker's build.
//
// Only the narrow "given an already-known deleteAfter and now, what's the
// status" half is duplicated here — never RETENTION_PERIOD_DAYS or the
// closedAt -> deleteAfter derivation, because worker/'s retention sweep
// never computes deleteAfter itself (see retentionSweep.ts). Keep this file
// in sync by hand if the 30-day window or its math ever changes; there is
// no automated check that the two copies match.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const EXPIRING_SOON_WINDOW_DAYS = 30;

export type RetentionStatus = 'active' | 'expiring-soon';

export function deriveRetentionStatus(deleteAfter: string | null, now: Date): RetentionStatus {
  if (!deleteAfter) {
    return 'active';
  }
  const warningStartMs = new Date(deleteAfter).getTime() - EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY;
  return now.getTime() >= warningStartMs ? 'expiring-soon' : 'active';
}
