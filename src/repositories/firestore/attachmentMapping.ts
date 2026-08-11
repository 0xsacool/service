import { Timestamp, type DocumentData } from 'firebase/firestore';
import type {
  Attachment,
  AttachmentCategory,
  RetentionExtension,
  RetentionStatus,
} from '../../types';

// Collection name, mirroring SERVICE_JOBS_COLLECTION/CUSTOMERS_COLLECTION's
// role in serviceJobMapping.ts/customerMapping.ts.
export const ATTACHMENTS_COLLECTION = 'serviceJobAttachments';

// Attachment.id === Attachment.path (the R2 object key, e.g.
// "service-jobs/{jobId}/{category}/{uuid}-{name}") everywhere else in this
// codebase, but Firestore document IDs cannot contain "/" — one is always
// interpreted as a path separator into a subcollection. R2 key characters
// are otherwise restricted to [a-zA-Z0-9._-] by the Worker's own
// ATTACHMENT_KEY_PATTERN (worker/src/paths.ts), so "/" -> "__" is a safe,
// lossless, deterministic transform: it can never collide with a
// legitimately-named file, and it means a document can always be addressed
// directly by its R2 key without a query. This keeps the document ID
// deterministic (per F5d-1's brief) rather than a random Firestore auto-ID.
export function attachmentDocId(path: string): string {
  return path.replace(/\//g, '__');
}

// `id` is deliberately not a field here, same convention as every other
// mapping file in this project — but unlike those, the *document ID* isn't
// the real value either (it's the "__"-encoded form above), so `path` is
// stored as a real field to hold the one true copy of the R2 key. This is
// not the "duplicate the R2 key" the F5d-1 brief warns against: the document
// ID and this field serve different roles (an addressing scheme vs. the
// authoritative value), and fromFirestoreData() below always reads the real
// key from this field, never by decoding the document ID.
export interface AttachmentFirestoreFields {
  jobId: string;
  category: AttachmentCategory;
  name: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  // F5d-2 — see src/services/attachmentRetention.ts for how these are
  // derived from the parent ServiceJob's closedAt. Passed through as-is,
  // same as ServiceJob.closedAt itself (serviceJobMapping.ts) — never
  // Firestore serverTimestamp(), always a real value this app computed.
  deleteAfter: string | null;
  retentionStatus: RetentionStatus;
  // F5d-4 — full write only on create(); every subsequent append goes
  // through extendRetention()'s arrayUnion() in firestoreAttachmentsRepository.ts,
  // never through toFirestoreFields()/setDoc again, so history can't be
  // clobbered by an unrelated field update.
  retentionExtensions: RetentionExtension[];
  // F5d-17 (DECISIONS.md #025) — full write only on create() (always
  // null there); every subsequent change goes through
  // firestoreAttachmentsRepository.ts's markDeleted(), a narrow
  // single-field updateDoc(), never through toFirestoreFields() again.
  deletedAt: string | null;
}

export function toFirestoreFields(entry: Attachment): AttachmentFirestoreFields {
  return {
    jobId: entry.jobId,
    category: entry.category,
    name: entry.name,
    path: entry.path,
    contentType: entry.contentType,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
    uploadedBy: entry.uploadedBy,
    deleteAfter: entry.deleteAfter,
    retentionStatus: entry.retentionStatus,
    retentionExtensions: entry.retentionExtensions,
    deletedAt: entry.deletedAt,
  };
}

// No `id` parameter, unlike every other fromFirestoreData() in this
// project — `data.path` is already the real R2 key, so it doubles as `id`
// directly rather than needing to decode the caller-supplied document ID.
//
// deleteAfter/retentionStatus fall back to the "open job" defaults for any
// doc written before F5d-2 (none exist as of this sprint, but every other
// mapping file in this project defends against exactly this same kind of
// pre-migration gap for its own newer fields — e.g. serviceJobMapping.ts's
// `data.closedAt ?? null` — so this follows the same standing convention).
export function fromFirestoreData(data: DocumentData): Attachment {
  return {
    id: data.path,
    jobId: data.jobId,
    category: data.category,
    name: data.name,
    path: data.path,
    contentType: data.contentType,
    size: data.size,
    uploadedAt: data.uploadedAt,
    uploadedBy: data.uploadedBy,
    deleteAfter: data.deleteAfter ?? null,
    retentionStatus: data.retentionStatus ?? 'active',
    retentionExtensions: data.retentionExtensions ?? [],
    deletedAt:
      data.deletedAt instanceof Timestamp
        ? data.deletedAt.toDate().toISOString()
        : (data.deletedAt ?? null),
  };
}
