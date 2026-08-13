import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { Attachment, RetentionExtension, RetentionStatus } from '../types';
import type { AttachmentRetention } from '../services/attachmentRetention';
import {
  attachmentDocId,
  ATTACHMENTS_COLLECTION,
  fromFirestoreData,
  toFirestoreFields,
} from './firestore/attachmentMapping';
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
  const subscribedJobIds = new Set<string>();

  const subscribeToJob = (jobId: string): void => {
    if (subscribedJobIds.has(jobId)) return;
    subscribedJobIds.add(jobId);
    void onSnapshot(
      query(collection(firestore, ATTACHMENTS_COLLECTION), where('jobId', '==', jobId)),
      (snapshot) => {
        for (const [id, attachment] of attachmentsById) {
          if (attachment.jobId === jobId) attachmentsById.delete(id);
        }
        snapshot.forEach((docSnap) => {
          const attachment = fromFirestoreData(docSnap.data());
          attachmentsById.set(attachment.id, attachment);
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
        await setDoc(
          doc(firestore, ATTACHMENTS_COLLECTION, attachmentDocId(attachment.path)),
          toFirestoreFields(attachment)
        );
      } catch (error) {
        logWriteFailure('create', attachment.id, error);
        throw error;
      }
    },
    async updateRetention(id, retention) {
      try {
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, attachmentDocId(id)), {
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
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, attachmentDocId(id)), {
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
        await updateDoc(doc(firestore, ATTACHMENTS_COLLECTION, attachmentDocId(id)), {
          deletedAt: serverTimestamp(),
        });
      } catch (error) {
        logWriteFailure('markDeleted', id, error);
        throw error;
      }
    },
  };
}
