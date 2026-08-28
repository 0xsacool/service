import { isCanonicalBrandId, type BrandId } from '../../src/types/brand.ts';
import type { CanonicalAttachmentKey } from '../../src/types/attachment.ts';
import { computeRequestFingerprint, isLowercaseUuidV4 } from '../../src/services/serviceReportV2.ts';
import {
  attachmentDeletionClaimDocId,
  isCanonicalAttachmentKey,
  legacyAttachmentMetadataDocId,
  verifyAttachmentDeletionClaimAddress,
  verifyAttachmentMetadataAddress,
} from '../../src/services/attachmentIdentity.ts';
import {
  parseCoreStaffProfile,
  parseRepairReportActorProfile,
} from '../../src/services/staffProfile.ts';
import {
  ServiceReportV2Error,
  idempotencyDocumentId,
} from './serviceReportV2Contracts.ts';
import {
  V2TransactionConflictError,
  type EvidenceObjectStore,
  type OperationActor,
  type ServiceReportV2Store,
  type V2StoredDocument,
  type V2Transaction,
  type V2Write,
} from './serviceReportV2Operations.ts';

const MAX_RETRIES = 5;
const MAX_FENCE = 2_147_483_647;
const LEASE_MILLISECONDS = 5 * 60 * 1000;

interface DeletionOperation {
  operationVersion: 1;
  operationId: string;
  authenticatedUid: string;
  brandId: BrandId;
  serviceJobId: string;
  attachmentMetadataDocId: string;
  canonicalAttachmentKey: CanonicalAttachmentKey;
  requestFingerprint: `sha256:req-v1:${string}`;
  claimId: `dc1_${string}`;
  status: 'in-progress' | 'completed';
  createdAt: string;
  completedAt: string | null;
}

interface DeletionClaim {
  claimVersion: 1;
  claimId: `dc1_${string}`;
  canonicalAttachmentKey: CanonicalAttachmentKey;
  serviceJobId: string;
  brandId: BrandId;
  operationId: string;
  mode: 'manual' | 'retention';
  requestedByUid: string | null;
  workerAttemptId: string;
  fencingToken: number;
  state: 'claimed' | 'deleting' | 'r2-deleted' | 'completed' | 'released' | 'failed';
  r2ActionStartedAt: string | null;
  leaseExpiresAt: string | null;
  failureClass: string | null;
  createdAt: string;
  updatedAt: string;
}

async function transaction<T>(
  store: ServiceReportV2Store,
  operation: (value: V2Transaction) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await store.beginTransaction();
    try {
      return await operation(current);
    } catch (error) {
      if (error instanceof V2TransactionConflictError && attempt + 1 < MAX_RETRIES) continue;
      if (error instanceof V2TransactionConflictError) {
        throw new ServiceReportV2Error(503, 'transaction_retry_exhausted', 'The deletion transaction could not commit', 'same-idempotency-key');
      }
      throw error;
    }
  }
  throw new ServiceReportV2Error(503, 'transaction_retry_exhausted', 'The deletion transaction could not commit', 'same-idempotency-key');
}

function parseMetadata(document: V2StoredDocument | null, expectedDocumentId: string) {
  if (!document || document.id !== expectedDocumentId) {
    throw new ServiceReportV2Error(404, 'resource_not_found', 'The attachment was not found', 'never');
  }
  if (!isCanonicalAttachmentKey(document.data.path)) {
    throw new ServiceReportV2Error(409, 'evidence_identity_mismatch', 'The attachment identity is invalid', 'operator');
  }
  return { document, key: document.data.path };
}

async function verifyMetadataAddress(document: V2StoredDocument, key: CanonicalAttachmentKey) {
  const valid = document.id.startsWith('ak2_')
    ? await verifyAttachmentMetadataAddress(document.id, key)
    : document.id === legacyAttachmentMetadataDocId(key);
  if (!valid) {
    throw new ServiceReportV2Error(
      409,
      document.id.startsWith('ak2_') ? 'evidence_identity_mismatch' : 'evidence_identity_collision',
      'The attachment metadata address is invalid',
      'operator'
    );
  }
}

function currentActor(document: V2StoredDocument | null, actor: OperationActor, brandId: BrandId) {
  if (!document || document.id !== actor.uid) {
    throw new ServiceReportV2Error(403, 'insufficient_role', 'Admin role is required', 'never');
  }
  const core = parseCoreStaffProfile(
    actor.uid,
    document.id,
    document.data.brandId,
    document.data.canImportProducts
  );
  const profile = core
    ? parseRepairReportActorProfile(core, document.data.role, document.data.displayName)
    : null;
  if (!profile || profile.role !== 'admin') {
    throw new ServiceReportV2Error(403, 'insufficient_role', 'Admin role is required', 'never');
  }
  if (profile.brandId !== brandId) {
    throw new ServiceReportV2Error(403, 'forbidden', 'The attachment is outside this brand', 'never');
  }
  return profile;
}

function serviceJobBrand(document: V2StoredDocument | null, serviceJobId: string): BrandId {
  if (!document || document.id !== serviceJobId) {
    throw new ServiceReportV2Error(404, 'resource_not_found', 'The Service Job was not found', 'never');
  }
  if (!isCanonicalBrandId(document.data.brandId)) {
    throw new ServiceReportV2Error(422, 'malformed_resource_state', 'The Service Job brand is malformed', 'operator');
  }
  return document.data.brandId;
}

function parseClaim(document: V2StoredDocument | null): DeletionClaim | null {
  if (!document) return null;
  const claim = document.data as unknown as DeletionClaim;
  if (
    claim.claimVersion !== 1 || claim.claimId !== document.id ||
    !Number.isSafeInteger(claim.fencingToken) || claim.fencingToken < 1 ||
    !['claimed', 'deleting', 'r2-deleted', 'completed', 'released', 'failed'].includes(claim.state)
  ) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion claim is malformed', 'operator');
  }
  return claim;
}

function parseOperation(document: V2StoredDocument | null): DeletionOperation | null {
  if (!document) return null;
  const operation = document.data as unknown as DeletionOperation;
  if (operation.operationVersion !== 1 || operation.operationId !== document.id ||
      (operation.status !== 'in-progress' && operation.status !== 'completed')) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion operation is malformed', 'operator');
  }
  return operation;
}

function effectiveExpiry(metadata: Record<string, unknown>): number | null {
  if (typeof metadata.deleteAfter !== 'string') return null;
  const ordinary = Date.parse(metadata.deleteAfter);
  if (!Number.isFinite(ordinary)) return null;
  const approval = typeof metadata.approvalRetainUntil === 'string'
    ? Date.parse(metadata.approvalRetainUntil)
    : Number.NEGATIVE_INFINITY;
  return Math.max(ordinary, Number.isFinite(approval) ? approval : Number.NEGATIVE_INFINITY);
}

async function assertDeletionEligible(
  store: ServiceReportV2Store,
  tx: V2Transaction,
  metadata: V2StoredDocument,
  key: CanonicalAttachmentKey,
  serviceJobId: string,
  now: string
) {
  if (metadata.data.jobId !== serviceJobId) {
    throw new ServiceReportV2Error(403, 'forbidden', 'The attachment is outside this Service Job', 'never');
  }
  if (metadata.data.deletedAt !== null && metadata.data.deletedAt !== undefined) {
    throw new ServiceReportV2Error(409, 'evidence_deleted', 'The attachment was already deleted', 'reload');
  }
  const expiry = effectiveExpiry(metadata.data);
  if (expiry === null || expiry > Date.parse(now)) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The attachment is still retained', 'operator');
  }
  const holds = await store.query('attachmentRetentionHolds', 'canonicalAttachmentKey', 'EQUAL', key, tx);
  if (holds.length > 0) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The attachment has an approval hold', 'operator');
  }
  const references = await store.query('serviceReports', 'evidenceAttachmentIds', 'ARRAY_CONTAINS', key, tx);
  if (references.length > 0) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The attachment is referenced by a Service Report', 'operator');
  }
}

function fullUpdate(collection: string, id: string, data: Record<string, unknown>): V2Write {
  return { kind: 'update', collection, id, data, fieldPaths: Object.keys(data) };
}

export interface DeletionCoordinatorResult {
  canonicalAttachmentKey: CanonicalAttachmentKey;
  claimId: `dc1_${string}`;
  status: 'in-progress' | 'completed';
}

export interface DeletionObjectStore extends EvidenceObjectStore {
  delete(key: CanonicalAttachmentKey): Promise<void>;
}

export async function coordinateManualAttachmentDeletion(input: {
  store: ServiceReportV2Store;
  objects: DeletionObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  attachmentMetadataDocId: string;
  idempotencyKey: string;
  now?: string;
}): Promise<DeletionCoordinatorResult> {
  if (!isLowercaseUuidV4(input.idempotencyKey)) {
    throw new ServiceReportV2Error(428, 'precondition_required', 'A lowercase UUIDv4 Idempotency-Key is required', 'never');
  }
  const now = input.now ?? new Date().toISOString();
  const operationId = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await computeRequestFingerprint({
    contractVersion: 2,
    operationKind: 'manual-deletion',
    serviceJobId: input.serviceJobId,
    attachmentMetadataDocId: input.attachmentMetadataDocId,
    mode: 'manual',
  });

  const acquired = await transaction(input.store, async (tx) => {
    const metadata = parseMetadata(
      await input.store.get('serviceJobAttachments', input.attachmentMetadataDocId, tx),
      input.attachmentMetadataDocId
    );
    await verifyMetadataAddress(metadata.document, metadata.key);
    const brandId = serviceJobBrand(
      await input.store.get('serviceJobs', input.serviceJobId, tx),
      input.serviceJobId
    );
    currentActor(await input.store.get('staffProfiles', input.actor.uid, tx), input.actor, brandId);
    const existingOperation = parseOperation(
      await input.store.get('attachmentDeletionOperations', operationId, tx)
    );
    const claimId = await attachmentDeletionClaimDocId(metadata.key);
    const existingClaimDocument = await input.store.get('attachmentDeletionClaims', claimId, tx);
    const existingClaim = parseClaim(existingClaimDocument);
    if (existingClaimDocument && !(await verifyAttachmentDeletionClaimAddress(existingClaimDocument.id, existingClaimDocument.data.canonicalAttachmentKey))) {
      throw new ServiceReportV2Error(409, 'evidence_identity_mismatch', 'The deletion claim identity is invalid', 'operator');
    }
    if (existingOperation) {
      if (existingOperation.authenticatedUid !== input.actor.uid ||
          existingOperation.requestFingerprint !== fingerprint ||
          existingOperation.canonicalAttachmentKey !== metadata.key ||
          existingOperation.claimId !== claimId) {
        throw new ServiceReportV2Error(409, 'idempotency_mismatch', 'The idempotency key was used for another request', 'never');
      }
      if (existingOperation.status === 'completed' && existingClaim?.state === 'completed') {
        return { key: metadata.key, claim: existingClaim, operation: existingOperation };
      }
      if (!existingClaim || existingClaim.operationId !== operationId) {
        throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion operation and claim disagree', 'operator');
      }
      return { key: metadata.key, claim: existingClaim, operation: existingOperation };
    }
    if (existingClaim && existingClaim.state !== 'released') {
      throw new ServiceReportV2Error(409, 'evidence_deletion_in_progress', 'Another deletion operation owns this attachment', 'reload');
    }
    await assertDeletionEligible(input.store, tx, metadata.document, metadata.key, input.serviceJobId, now);
    const fencingToken = existingClaim ? existingClaim.fencingToken + 1 : 1;
    if (fencingToken > MAX_FENCE) {
      throw new ServiceReportV2Error(409, 'counter_exhausted', 'The deletion fence is exhausted', 'operator');
    }
    const claim: DeletionClaim = {
      claimVersion: 1,
      claimId,
      canonicalAttachmentKey: metadata.key,
      serviceJobId: input.serviceJobId,
      brandId,
      operationId,
      mode: 'manual',
      requestedByUid: input.actor.uid,
      workerAttemptId: crypto.randomUUID(),
      fencingToken,
      state: 'claimed',
      r2ActionStartedAt: null,
      leaseExpiresAt: new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString(),
      failureClass: null,
      createdAt: existingClaim?.createdAt ?? now,
      updatedAt: now,
    };
    const operation: DeletionOperation = {
      operationVersion: 1,
      operationId,
      authenticatedUid: input.actor.uid,
      brandId,
      serviceJobId: input.serviceJobId,
      attachmentMetadataDocId: input.attachmentMetadataDocId,
      canonicalAttachmentKey: metadata.key,
      requestFingerprint: fingerprint,
      claimId,
      status: 'in-progress',
      createdAt: now,
      completedAt: null,
    };
    await input.store.commit(tx, [
      existingClaim
        ? fullUpdate('attachmentDeletionClaims', claimId, claim as unknown as Record<string, unknown>)
        : { kind: 'create', collection: 'attachmentDeletionClaims', id: claimId, data: claim as unknown as Record<string, unknown> },
      { kind: 'create', collection: 'attachmentDeletionOperations', id: operationId, data: operation as unknown as Record<string, unknown> },
    ]);
    return { key: metadata.key, claim, operation };
  });

  if (acquired.operation.status === 'completed' && acquired.claim.state === 'completed') {
    return { canonicalAttachmentKey: acquired.key, claimId: acquired.claim.claimId, status: 'completed' };
  }
  if (acquired.claim.state === 'deleting') {
    return { canonicalAttachmentKey: acquired.key, claimId: acquired.claim.claimId, status: 'in-progress' };
  }
  if (acquired.claim.state === 'failed') {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'Deletion outcome requires reconciliation', 'operator');
  }

  if (acquired.claim.state === 'r2-deleted') {
    await completeMetadata(input.store, acquired.operation, acquired.claim, now);
    return { canonicalAttachmentKey: acquired.key, claimId: acquired.claim.claimId, status: 'completed' };
  }

  const deleting = await transaction(input.store, async (tx) => {
    const claimDocument = await input.store.get('attachmentDeletionClaims', acquired.claim.claimId, tx);
    const claim = parseClaim(claimDocument);
    if (!claim || claim.operationId !== operationId || claim.workerAttemptId !== acquired.claim.workerAttemptId ||
        claim.fencingToken !== acquired.claim.fencingToken || claim.state !== 'claimed') {
      throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion fence changed', 'operator');
    }
    const metadata = parseMetadata(
      await input.store.get('serviceJobAttachments', input.attachmentMetadataDocId, tx),
      input.attachmentMetadataDocId
    );
    await assertDeletionEligible(input.store, tx, metadata.document, acquired.key, input.serviceJobId, now);
    const next: DeletionClaim = {
      ...claim,
      state: 'deleting',
      r2ActionStartedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    };
    await input.store.commit(tx, [
      fullUpdate('attachmentDeletionClaims', claim.claimId, next as unknown as Record<string, unknown>),
    ]);
    return next;
  });

  const fenceCheck = parseClaim(await input.store.get('attachmentDeletionClaims', deleting.claimId));
  if (!fenceCheck || fenceCheck.state !== 'deleting' || fenceCheck.fencingToken !== deleting.fencingToken ||
      fenceCheck.workerAttemptId !== deleting.workerAttemptId || fenceCheck.operationId !== operationId) {
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion fence changed before R2', 'operator');
  }

  try {
    await input.objects.delete(acquired.key);
  } catch {
    await markAmbiguousFailure(input.store, deleting, now);
    throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'R2 deletion outcome is ambiguous', 'operator');
  }

  const r2Deleted: DeletionClaim = { ...deleting, state: 'r2-deleted', updatedAt: now };
  await transaction(input.store, async (tx) => {
    const current = parseClaim(await input.store.get('attachmentDeletionClaims', deleting.claimId, tx));
    if (!current || current.state !== 'deleting' || current.fencingToken !== deleting.fencingToken ||
        current.workerAttemptId !== deleting.workerAttemptId) {
      throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'The deletion fence changed after R2', 'operator');
    }
    await input.store.commit(tx, [
      fullUpdate('attachmentDeletionClaims', deleting.claimId, r2Deleted as unknown as Record<string, unknown>),
    ]);
  });
  await completeMetadata(input.store, acquired.operation, r2Deleted, now);
  return { canonicalAttachmentKey: acquired.key, claimId: acquired.claim.claimId, status: 'completed' };
}

async function markAmbiguousFailure(
  store: ServiceReportV2Store,
  claim: DeletionClaim,
  now: string
) {
  try {
    await transaction(store, async (tx) => {
      const current = parseClaim(await store.get('attachmentDeletionClaims', claim.claimId, tx));
      if (!current || current.operationId !== claim.operationId || current.fencingToken !== claim.fencingToken) return;
      const failed: DeletionClaim = {
        ...current,
        state: 'failed',
        failureClass: 'r2-delete-ambiguous',
        updatedAt: now,
      };
      await store.commit(tx, [fullUpdate('attachmentDeletionClaims', claim.claimId, failed as unknown as Record<string, unknown>)]);
    });
  } catch {
    console.error('[attachment-deletion-v2] unable to record ambiguous R2 outcome');
  }
}

async function completeMetadata(
  store: ServiceReportV2Store,
  operation: DeletionOperation,
  claim: DeletionClaim,
  now: string
) {
  await transaction(store, async (tx) => {
    const current = parseClaim(await store.get('attachmentDeletionClaims', claim.claimId, tx));
    const metadata = parseMetadata(
      await store.get('serviceJobAttachments', operation.attachmentMetadataDocId, tx),
      operation.attachmentMetadataDocId
    );
    if (!current || current.state !== 'r2-deleted' || current.fencingToken !== claim.fencingToken ||
        metadata.key !== claim.canonicalAttachmentKey) {
      throw new ServiceReportV2Error(409, 'deletion_reconciliation_required', 'Deletion completion state is inconsistent', 'operator');
    }
    const completedClaim: DeletionClaim = {
      ...current,
      state: 'completed',
      failureClass: null,
      updatedAt: now,
    };
    const completedOperation: DeletionOperation = {
      ...operation,
      status: 'completed',
      completedAt: now,
    };
    await store.commit(tx, [
      {
        kind: 'update', collection: 'serviceJobAttachments', id: operation.attachmentMetadataDocId,
        data: { deletedAt: now }, fieldPaths: ['deletedAt'],
      },
      fullUpdate('attachmentDeletionClaims', claim.claimId, completedClaim as unknown as Record<string, unknown>),
      fullUpdate('attachmentDeletionOperations', operation.operationId, completedOperation as unknown as Record<string, unknown>),
    ]);
  });
}
