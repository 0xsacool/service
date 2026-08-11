// Mirrors worker/src/paths.ts's ATTACHMENT_CATEGORIES exactly — the Worker
// is the authority on the storage path convention (service-jobs/{jobId}/
// {category}/...), this is the frontend's copy of the same four values.
export type AttachmentCategory = 'before' | 'after' | 'documents' | 'report';

// F5d-2: only the two states reachable without a deletion mechanism.
// 'active' also covers "not yet closed" (deleteAfter is null, so the
// question doesn't apply). 'expiring-soon' covers both "within the 30-day
// warning window" and "already past deleteAfter" — there is no distinct
// "expired"/"deleted" state yet because nothing in this app actually
// deletes a file (no Cron exists — see src/services/attachmentRetention.ts).
// Revisit this union once F5d-3 or later introduces real deletion.
export type RetentionStatus = 'active' | 'expiring-soon';

// F5d-4 — one entry per explicit staff "Extend Retention" action, appended
// (never overwritten/replaced) to Attachment.retentionExtensions. Distinct
// from the automatic reconciliation in attachmentRetentionBackfill.ts,
// which recomputes deleteAfter/retentionStatus from ServiceJob.closedAt but
// is never a staff decision and never produces one of these entries.
//
// extendedBy is a free-text identifier, not a validated user reference —
// this app has no authentication or role system (see
// attachmentRetentionExtension.ts's module comment). Do not treat this
// field as an authorization record; it's an audit trail, not an access
// control.
export interface RetentionExtension {
  extendedBy: string;
  extendedAt: string;
  previousDeleteAfter: string | null;
  newDeleteAfter: string;
  reason: string;
}

// Backend-agnostic — identical whether the record came from the Mock
// repository or the Worker-backed one (F5b). `id` is always the same value
// as `path` (the R2 object key), the same "id doubles as the natural
// identifier" pattern already used by ServiceJob (id === tracking number).
export interface Attachment {
  id: string;
  jobId: string;
  category: AttachmentCategory;
  name: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  // F5d-2 — derived from the parent ServiceJob's closedAt, never from
  // uploadedAt. null while the parent job is open (retention hasn't started
  // counting down yet). See src/services/attachmentRetention.ts for how
  // these are computed and src/services/attachmentRetentionBackfill.ts for
  // how existing records get reconciled after their parent job closes.
  deleteAfter: string | null;
  retentionStatus: RetentionStatus;
  // F5d-4 — append-only history of every explicit retention extension,
  // oldest first. Empty at creation. Mirrors the established pattern of
  // embedding an append-only array directly on the parent document
  // (ServiceJob.timeline, ServiceJob.notes) rather than a subcollection.
  retentionExtensions: RetentionExtension[];
  // F5d-17 (DECISIONS.md #025) — null: the R2 object has not been
  // physically deleted. A timestamp: the R2 object was deleted and this
  // Firestore document is deliberately being retained (never
  // hard-deleted) as a permanent audit record. Distinct from
  // retentionStatus on purpose — see worker/src/deletionSafety.ts's
  // module comment for why the two must never be conflated. Repository
  // read methods (getForJob/getById) exclude deletedAt !== null records
  // by default; see firestoreAttachmentsRepository.ts's
  // getForJobIncludingDeleted() for the internal audit-only escape hatch.
  deletedAt: string | null;
}
