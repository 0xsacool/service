import type { Attachment, RetentionExtension } from '../types';
import { createFirestoreAttachmentMetadataStore } from '../repositories/firestoreAttachmentsRepository';
import { computeExtendedRetention } from './attachmentRetention';

// F5d-4 — the explicit "Extend Retention" staff action (as opposed to
// attachmentRetentionBackfill.ts's automatic reconciliation, which never
// records an extension). Firestore-only, same as the backfill: never
// imports anything Worker/R2-related, so it structurally cannot touch a
// file's bytes — only deleteAfter/retentionStatus/retentionExtensions on
// the metadata doc. Never touches a ServiceJob document or its closedAt.
//
// No UI calls this yet — there is no attachment list/gallery anywhere in
// this app for an "Extend Retention" button to live on (see F5d-1/F5d-2/
// F5d-3's Known Limitations). This is the callable capability itself,
// exercised via browser console/test code until that UI exists.
//
// AUTHORIZATION: this app has no authentication or role system anywhere.
// `extendedBy` is a free-text field, not a verified identity — anyone who
// can reach this function (console, or a future UI wired to it) can extend
// any attachment's retention today. This MUST be gated behind real
// auth/roles before it is ever exposed through a UI or reachable in
// production. Not enforced here by design — inventing an auth check would
// be fake security, not real security.
export interface ExtendAttachmentRetentionInput {
  extendedBy: string;
  reason: string;
}

export async function extendAttachmentRetention(
  id: string,
  input: ExtendAttachmentRetentionInput,
  now: Date = new Date()
): Promise<Attachment> {
  const store = await createFirestoreAttachmentMetadataStore();
  const current = store.getById(id);
  if (!current) {
    throw new Error(
      `Cannot extend retention for attachment "${id}": no such attachment exists`
    );
  }

  // Reuses the same 365-day RETENTION_PERIOD_DAYS as every other retention
  // calculation (see computeExtendedRetention's own comment for why this
  // isn't a new, invented duration) — always resolves retentionStatus to
  // 'active', satisfying the requirement that an extension moves the
  // attachment out of 'expiring-soon' rather than just delaying it.
  const { deleteAfter, retentionStatus } = computeExtendedRetention(now);

  const extension: RetentionExtension = {
    extendedBy: input.extendedBy,
    extendedAt: now.toISOString(),
    previousDeleteAfter: current.deleteAfter,
    newDeleteAfter: deleteAfter,
    reason: input.reason,
  };

  await store.extendRetention(id, extension, retentionStatus);

  const updated = store.getById(id);
  if (!updated) {
    throw new Error(`Attachment "${id}" disappeared while extending its retention`);
  }
  return updated;
}
