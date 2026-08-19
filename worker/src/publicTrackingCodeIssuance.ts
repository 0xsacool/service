import {
  generateAvailablePublicTrackingCode,
  hashPublicTrackingCode,
  type PublicTrackingCodeExistenceStore,
} from '../../src/services/publicTrackingCode.ts';
import { TransactionConflictError, type AllocationTransaction } from './serviceJobCreation.ts';

// F5d-69G — staff-authenticated issuance/rotation of the existing SRV public
// tracking code for a Service Job that already exists. Deliberately reuses
// generateAvailablePublicTrackingCode()/hashPublicTrackingCode() from the
// shared, already-tested code module (src/services/publicTrackingCode.ts)
// rather than inventing a second random-code format — this module only adds
// the privileged Firestore commit around that existing primitive.
//
// The same operation serves both "issue" (job currently inactive) and
// "rotate" (job already active): it always writes a fresh code + hash,
// unconditionally overwriting whatever was there before. There is no
// separate rotate entrypoint — the caller (the Worker route) decides what
// confirmation copy to show; the underlying write is identical either way.
const MAX_ISSUANCE_TRANSACTION_RETRIES = 3;

export interface PublicTrackingCodeIssuanceDataAccess {
  beginPublicTrackingCodeIssuanceTransaction(): Promise<AllocationTransaction>;
  publicTrackingCodeExists(
    transaction: AllocationTransaction,
    code: string
  ): Promise<boolean>;
  // Preconditioned in the implementation on serviceJobs/{serviceJobId}
  // existing (currentDocument.exists: true) and publicTrackingCodes/{code}
  // NOT existing (currentDocument.exists: false) — both writes commit
  // atomically or neither does. A TransactionConflictError signals a
  // genuine Firestore-level commit conflict (e.g. a same-microsecond
  // collision with a concurrent issuance for a different job); the caller
  // retries with a freshly generated code, never reusing the same
  // transaction or candidate.
  commitPublicTrackingCodeIssuance(
    transaction: AllocationTransaction,
    input: { serviceJobId: string; code: string; codeHash: string }
  ): Promise<void>;
}

export interface IssuedPublicTrackingCode {
  serviceJobId: string;
  code: string;
  codeHash: string;
}

export async function issuePublicTrackingCodeForServiceJob(
  serviceJobId: string,
  dataAccess: PublicTrackingCodeIssuanceDataAccess,
  now: () => Date = () => new Date()
): Promise<IssuedPublicTrackingCode> {
  for (let attempt = 0; attempt < MAX_ISSUANCE_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await dataAccess.beginPublicTrackingCodeIssuanceTransaction();
    const store: PublicTrackingCodeExistenceStore = {
      exists: (code) => dataAccess.publicTrackingCodeExists(transaction, code),
    };
    const code = await generateAvailablePublicTrackingCode(now(), store);
    const codeHash = await hashPublicTrackingCode(code);
    try {
      await dataAccess.commitPublicTrackingCodeIssuance(transaction, {
        serviceJobId,
        code,
        codeHash,
      });
      return { serviceJobId, code, codeHash };
    } catch (error) {
      if (
        error instanceof TransactionConflictError &&
        attempt + 1 < MAX_ISSUANCE_TRANSACTION_RETRIES
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Public tracking code issuance transaction retries exhausted');
}
