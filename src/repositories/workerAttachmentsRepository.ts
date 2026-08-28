import type { Attachment } from '../types';
import {
  fetchWithWorkerToken,
  unavailableWorkerTokenProvider,
  type WorkerTokenProvider,
} from '../auth/workerTokenProvider';
import type {
  AttachmentsRepository,
  ServiceJobsRepository,
  UploadAttachmentInput,
} from './types';
import { createFirestoreAttachmentMetadataStore } from './firestoreAttachmentsRepository';
import { resolveParentAttachmentRetention } from '../services/attachmentRetention';
import { deleteAttachmentWithRetainedMetadata } from '../services/attachmentDeletion';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';

interface UploadResponse {
  path: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

// Talks only to the F5a Worker's HTTP API (see worker/src/index.ts) — never
// to R2 directly, and no R2 credential of any kind exists in this module or
// anywhere else in the frontend. Transport details (the Worker's base URL,
// its header/path conventions) stay entirely inside this file; every other
// caller sees only the backend-agnostic AttachmentsRepository interface.
//
// F5d-1: getForJob()'s F5b limitation (an in-memory, session-only index
// that didn't reflect prior sessions/other tabs/other users — see the F5b
// completion report's Known Limitations) is resolved here by delegating all
// metadata reads/writes to firestoreAttachmentsRepository.ts's durable,
// onSnapshot-backed store, exactly the follow-up that module's own comment
// anticipated. This factory is now async because building that store means
// awaiting Firestore's first server-confirmed snapshot before this
// repository is fully usable — mirrors every other Firestore-backed
// repository's shape (DECISIONS.md #018). Byte transport (the fetch calls
// below) is unchanged from F5a/F5b.
export async function createWorkerAttachmentsRepository(
  serviceJobs: ServiceJobsRepository,
  tokenProvider: WorkerTokenProvider = unavailableWorkerTokenProvider
): Promise<AttachmentsRepository> {
  const baseUrl = getFilesWorkerBaseUrl();
  const metadata = await createFirestoreAttachmentMetadataStore();

  return {
    getForJob(jobId) {
      return metadata.getForJob(jobId);
    },

    async upload(input: UploadAttachmentInput) {
      const retention = resolveParentAttachmentRetention(
        serviceJobs.getById(input.jobId),
        new Date()
      );
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${baseUrl}/files/service-jobs/${encodeURIComponent(input.jobId)}/${input.category}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': input.contentType,
            'X-File-Name': input.fileName,
          },
          body: input.file,
        }
      );

      if (!response.ok) {
        throw new Error(`Attachment upload failed: ${await readErrorMessage(response)}`);
      }

      const body = (await response.json()) as UploadResponse;
      const attachment: Attachment = {
        id: body.path,
        jobId: input.jobId,
        category: input.category,
        name: input.fileName,
        path: body.path,
        contentType: body.contentType,
        size: body.size,
        uploadedAt: body.uploadedAt,
        uploadedBy: input.uploadedBy,
        deleteAfter: retention.deleteAfter,
        retentionStatus: retention.retentionStatus,
        retentionExtensions: [],
        // F5d-17 (DECISIONS.md #025) — always null at creation. A successful
        // manual or executor deletion records the later lifecycle outcome.
        deletedAt: null,
        metadataKeyVersion: 2,
        approvalRetainUntil: null,
      };
      // Only reached once the bytes are already durably in R2 — see
      // firestoreAttachmentsRepository.ts's create() comment for why this
      // metadata write is genuinely awaited rather than fire-and-forget.
      await metadata.create(attachment);
      return attachment;
    },

    // id is always the R2 key (see upload() above), but the key itself never
    // leaves this module as a URL: the bytes are fetched over the same
    // Worker-token-authenticated transport as every other call here, and only
    // the resulting Blob becomes a URL. Per the AttachmentsRepository contract
    // (types.ts) that URL is a FRESH caller-owned object URL — nothing here
    // retains or revokes it. The existence check is purely to match the Mock
    // implementation's behavior for an unknown id, not something the Worker
    // itself requires.
    async getDownloadUrl(id) {
      if (!metadata.getById(id)) {
        throw new Error(
          `Cannot get download URL for attachment "${id}": no such attachment exists`
        );
      }
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${baseUrl}/files/${id}`,
        {
          method: 'GET',
        }
      );
      if (!response.ok) {
        throw new Error(
          `Attachment download failed: ${await readErrorMessage(response)}`
        );
      }
      return URL.createObjectURL(await response.blob());
    },

    async deleteAttachment(id) {
      await deleteAttachmentWithRetainedMetadata(id, metadata, async () => {
        const response = await fetchWithWorkerToken(
          tokenProvider,
          `${baseUrl}/files/${id}`,
          {
            method: 'DELETE',
          }
        );
        if (!response.ok) {
          throw new Error(
            `Attachment delete failed: ${await readErrorMessage(response)}`
          );
        }
      });
    },
  };
}
