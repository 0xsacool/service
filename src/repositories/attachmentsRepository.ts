import type { Attachment, AttachmentCategory } from '../types';
import type { AttachmentsRepository } from './types';
import { serviceJobsRepository } from './serviceJobsRepository';
import { resolveParentAttachmentRetention } from '../services/attachmentRetention';

interface StoredAttachment {
  attachment: Attachment;
  blob: Blob;
}

// Session-only, same pattern as every other Mock repository — lost on
// refresh, not a bug. Keyed by id (== path), same as the Worker-backed
// implementation, so both hold the actual file bytes/reference under one
// consistent key.
const attachmentsById = new Map<string, StoredAttachment>();

export function getMockAttachmentsForJobIncludingDeleted(jobId: string): Attachment[] {
  return Array.from(attachmentsById.values())
    .map((entry) => entry.attachment)
    .filter((attachment) => attachment.jobId === jobId);
}

// Mirrors worker/src/paths.ts's generateAttachmentPath()/sanitizeFileName()
// exactly, so a Mock-created attachment's `path` looks identical in shape
// to a real one — deliberately not shared code (src/ and worker/ are
// separate deployable projects with no code-sharing boundary, per F5a).
function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.trim().replace(/[^a-zA-Z0-9.\-_]+/g, '_');
  return sanitized || 'file';
}

function generatePath(
  jobId: string,
  category: AttachmentCategory,
  fileName: string
): string {
  const uniqueName = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
  return `service-jobs/${jobId}/${category}/${uniqueName}`;
}

export const attachmentsRepository: AttachmentsRepository = {
  getForJob(jobId) {
    return getMockAttachmentsForJobIncludingDeleted(jobId).filter(
      (attachment) => attachment.deletedAt === null
    );
  },

  async upload(input) {
    const retention = resolveParentAttachmentRetention(
      serviceJobsRepository.getById(input.jobId),
      new Date()
    );
    const path = generatePath(input.jobId, input.category, input.fileName);
    const attachment: Attachment = {
      id: path,
      jobId: input.jobId,
      category: input.category,
      name: input.fileName,
      path,
      contentType: input.contentType,
      size: input.file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: input.uploadedBy,
      deleteAfter: retention.deleteAfter,
      retentionStatus: retention.retentionStatus,
      retentionExtensions: [],
      // F5d-17: always null at creation; Mock deletion mirrors the retained
      // metadata lifecycle by setting this later.
      deletedAt: null,
    };
    attachmentsById.set(path, { attachment, blob: input.file });
    return attachment;
  },

  // A real, working object URL — not a placeholder string — so Mock mode
  // behaves identically to the Worker-backed implementation from a consumer's
  // point of view. Per the AttachmentsRepository contract (types.ts) this is a
  // FRESH caller-owned URL on every call: nothing here retains or revokes it,
  // and the stored Blob, not this URL, is what survives between calls.
  async getDownloadUrl(id) {
    const entry = attachmentsById.get(id);
    if (!entry || entry.attachment.deletedAt !== null) {
      throw new Error(
        `Cannot get download URL for attachment "${id}": no such attachment exists`
      );
    }
    return URL.createObjectURL(entry.blob);
  },

  async deleteAttachment(id) {
    const entry = attachmentsById.get(id);
    if (!entry || entry.attachment.deletedAt !== null) {
      throw new Error(`Cannot delete attachment "${id}": no such attachment exists`);
    }
    attachmentsById.set(id, {
      ...entry,
      attachment: { ...entry.attachment, deletedAt: new Date().toISOString() },
    });
  },
};
