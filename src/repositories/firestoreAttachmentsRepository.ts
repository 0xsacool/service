import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { Attachment, RetentionExtension, RetentionStatus } from '../types';
import type { AttachmentRetention } from '../services/attachmentRetention';
import {
  ATTACHMENTS_COLLECTION,
  fromFirestoreData,
  toFirestoreFields,
} from './firestore/attachmentMapping';
import {
  assertCanonicalAttachmentKey,
  attachmentMetadataDocId,
  isCanonicalAttachmentKey,
  legacyAttachmentMetadataDocId,
  verifyAttachmentMetadataAddress,
} from '../services/attachmentIdentity';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';

export interface AttachmentMetadataStore {
  getForJob(jobId: string): Attachment[];
  getById(id: string): Attachment | undefined;
  getForJobIncludingDeleted(jobId: string): Attachment[];
  create(attachment: Attachment): Promise<void>;
  updateRetention(id: string, retention: AttachmentRetention): Promise<void>;
  extendRetention(
    id: string,
    extension: RetentionExtension,
    retentionStatus: RetentionStatus
  ): Promise<void>;
  markDeleted(id: string, deletedAt: string): Promise<void>;
}

function logWriteFailure(operation: string, id: string, error: unknown): void {
  console.error(`[firestoreAttachmentsRepository] ${operation}("${id}") failed:`, error);
}

export async function createFirestoreAttachmentMetadataStore(): Promise<AttachmentMetadataStore> {
  const firestore = getFirestoreDb();
  const attachmentsById = new Map<string, Attachment>();
  const documentIdsByKey = new Map<string, string>();
  const subscribedJobIds = new Set<string>();

  const subscribeToJob = (jobId: string): void => {
    if (subscribedJobIds.has(jobId)) return;
    subscribedJobIds.add(jobId);
    void onSnapshot(
      query(collection(firestore, ATTACHMENTS_COLLECTION), where('jobId', '==', jobId)),
      (snapshot) => {
        void (async () => {
          const next = new Map<string, { attachment: Attachment; documentId: string }>();
          for (const docSnap of snapshot.docs) {
            const attachment = fromFirestoreData(docSnap.data());
            if (!isCanonicalAttachmentKey(attachment.path)) {
              throw new Error('evidence_identity_mismatch');
            }
            const validAddress = docSnap.id.startsWith('ak2_')
              ? await verifyAttachmentMetadataAddress(docSnap.id, attachment.path)
              : docSnap.id === legacyAttachmentMetadataDocId(attachment.path);
            if (!validAddress) {
              throw new Error(
                docSnap.id.startsWith('ak2_')
                  ? 'evidence_identity_mismatch'
                  : 'evidence_identity_collision'
              );
            }
            if (next.has(attachment.path)) {
              throw new Error('duplicate_attachment_metadata');
            }
            next.set(attachment.path, { attachment, documentId: docSnap.id });
          }
          for (const [id, attachment] of attachmentsById) {
            if (attachment.jobId === jobId) {
              attachmentsById.delete(id);
              documentIdsByKey.delete(id);
            }
          }
          for (const [key, resolved] of next) {
            attachmentsById.set(key, resolved.attachment);
            documentIdsByKey.set(key, resolved.documentId);
          }
        })().catch((error: unknown) => {
          console.error('[firestoreAttachmentsRepository] identity resolution failed:', error);
          recordFirestoreInitFailure({
            repository: 'attachments',
            stage: 'listener',
            code: 'unknown',
          });
        });
      },
      (error) => {
        console.error(
          '[firestoreAttachmentsRepository] snapshot listener failed:',
          error
        );
        recordFirestoreInitFailure(
          describeFirestoreInitError(error, 'attachments', 'listener')
        );
      }
    );
  };

  return {
    getForJob(jobId) {
      subscribeToJob(jobId);
      return Array.from(attachmentsById.values()).filter(
        (attachment) => attachment.jobId === jobId && attachment.deletedAt === null
      );
    },
    getById(id) {
      const attachment = attachmentsById.get(id);
      return attachment && attachment.deletedAt === null ? attachment : undefined;
    },
    getForJobIncludingDeleted(jobId) {
      subscribeToJob(jobId);
      return Array.from(attachmentsById.values()).filter(
        (attachment) => attachment.jobId === jobId
      );
    },
    async create(attachment) {
      try {
        const key = assertCanonicalAttachmentKey(attachment.path);
        const documentId = await attachmentMetadataDocId(key);
        const canonicalAttachment: Attachment = {
          ...attachment,
          id: key,
          path: key,
          metadataKeyVersion: 2,
          approvalRetainUntil: attachment.approvalRetainUntil ?? null,
        };
        await runTransaction(firestore, async (transaction) => {
          const reference = doc(firestore, ATTACHMENTS_COLLECTION, documentId);
          const existing = await transaction.get(reference);
          if (existing.exists()) {
            const existingPath = existing.data().path;
            throw new Error(
              existingPath === key
                ? 'duplicate_attachment_metadata'
                : 'evidence_identity_mismatch'
            );
          }
          transaction.set(reference, toFirestoreFields(canonicalAttachment));
        });
        attachmentsById.set(key, canonicalAttachment);
        documentIdsByKey.set(key, documentId);
      } catch (error) {
        logWriteFailure('create', attachment.id, error);
        throw error;
      }
    },
    async updateRetention(id, retention) {
      try {
        const documentId = documentIdsByKey.get(id) ?? await attachmentMetadataDocId(assertCanonicalAttachmentKey(id));
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, documentId), {
          deleteAfter: retention.deleteAfter,
          retentionStatus: retention.retentionStatus,
        });
      } catch (error) {
        logWriteFailure('updateRetention', id, error);
        throw error;
      }
    },
    async extendRetention(id, extension, retentionStatus) {
      try {
        const documentId = documentIdsByKey.get(id) ?? await attachmentMetadataDocId(assertCanonicalAttachmentKey(id));
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, documentId), {
          deleteAfter: extension.newDeleteAfter,
          retentionStatus,
          retentionExtensions: arrayUnion(extension),
        });
      } catch (error) {
        logWriteFailure('extendRetention', id, error);
        throw error;
      }
    },
    async markDeleted(id, deletedAt) {
      void deletedAt;
      try {
        const documentId = documentIdsByKey.get(id) ?? await attachmentMetadataDocId(assertCanonicalAttachmentKey(id));
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, documentId), {
          deletedAt: serverTimestamp(),
        });
      } catch (error) {
        logWriteFailure('markDeleted', id, error);
        throw error;
      }
    },
  };
}
