import type { Attachment } from '../types';

export interface RetainedAttachmentMetadataStore {
  getById(id: string): Attachment | undefined;
  markDeleted(id: string, deletedAt: string): Promise<void>;
}

export async function deleteAttachmentWithRetainedMetadata(
  id: string,
  metadata: RetainedAttachmentMetadataStore,
  deleteObject: () => Promise<void>,
  now: Date = new Date()
): Promise<void> {
  if (!metadata.getById(id)) {
    throw new Error(`Cannot delete attachment "${id}": no such attachment exists`);
  }

  await deleteObject();
  await metadata.markDeleted(id, now.toISOString());
}
