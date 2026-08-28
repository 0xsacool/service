import { isCanonicalBrandId, type BrandId } from '../../src/types/brand.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type { RequestFingerprint, ServiceReportActiveDraftSlot } from '../../src/types/serviceReportV2.ts';
import { isCanonicalAttachmentKey } from '../../src/services/attachmentIdentity.ts';
import {
  finalizeServiceReport,
  isValidServiceReport,
  updateServiceReportDraft,
} from '../../src/services/serviceReport.ts';
import { computeRequestFingerprint } from '../../src/services/serviceReportV2.ts';
import {
  parseCoreStaffProfile,
  parseRepairReportActorProfile,
} from '../../src/services/staffProfile.ts';
import type {
  FinalizeReportRequest,
  LegacyDraftSaveRequest,
} from './serviceReportV2Contracts.ts';
import {
  idempotencyDocumentId,
  ServiceReportV2Error,
} from './serviceReportV2Contracts.ts';
import {
  resolveServiceReportEvidence,
  V2TransactionConflictError,
  type EvidenceObjectStore,
  type OperationActor,
  type ServiceReportV2OperationResult,
  type ServiceReportV2Store,
  type V2StoredDocument,
  type V2Transaction,
} from './serviceReportV2Operations.ts';

const MAX_TRANSACTION_RETRIES = 5;

interface CompatibilityIdempotency {
  recordVersion: 1;
  authenticatedUid: string;
  operationKind: 'legacy-draft-save' | 'finalize-report';
  requestFingerprint: RequestFingerprint;
  resultResourceId: string;
  resultStatus: 'completed';
}

function malformed(message: string): never {
  throw new ServiceReportV2Error(422, 'malformed_resource_state', message, 'operator');
}

function parseJob(document: V2StoredDocument | null, serviceJobId: string): ServiceJob {
  if (!document || document.id !== serviceJobId) {
    throw new ServiceReportV2Error(404, 'resource_not_found', 'The resource was not found', 'never');
  }
  const job = { ...document.data, id: document.id } as ServiceJob;
  if (!isCanonicalBrandId(job.brandId)) malformed('The Service Job is malformed');
  return job;
}

function requireActor(
  document: V2StoredDocument | null,
  actor: OperationActor,
  brandId: BrandId
) {
  if (!document || document.id !== actor.uid) {
    throw new ServiceReportV2Error(403, 'insufficient_role', 'A Repair Report role is required', 'never');
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
  if (!profile) {
    throw new ServiceReportV2Error(403, 'insufficient_role', 'A Repair Report role is required', 'never');
  }
  if (profile.brandId !== brandId) {
    throw new ServiceReportV2Error(403, 'forbidden', 'The operation is not allowed', 'never');
  }
  return profile;
}

function parseV1Report(
  document: V2StoredDocument | null,
  serviceJobId: string
): ServiceReport {
  if (!document) {
    throw new ServiceReportV2Error(404, 'resource_not_found', 'The resource was not found', 'never');
  }
  if (document.data.schemaVersion !== undefined) {
    malformed('The compatibility route accepts only inventoried V1 reports');
  }
  const report = { ...document.data, id: document.id };
  if (!isValidServiceReport(report) || report.serviceJobId !== serviceJobId) {
    malformed('The V1 Service Report is malformed');
  }
  if (!report.evidenceAttachmentIds.every(isCanonicalAttachmentKey)) {
    malformed('The V1 evidence identity is malformed');
  }
  return report;
}

function parseIdempotency(document: V2StoredDocument | null): CompatibilityIdempotency | null {
  if (!document) return null;
  const value = document.data as unknown as CompatibilityIdempotency;
  if (
    value.recordVersion !== 1 ||
    value.resultStatus !== 'completed' ||
    typeof value.authenticatedUid !== 'string' ||
    typeof value.requestFingerprint !== 'string' ||
    typeof value.resultResourceId !== 'string'
  ) {
    malformed('The idempotency record is malformed');
  }
  return value;
}

async function replay(
  store: ServiceReportV2Store,
  transaction: V2Transaction,
  existing: CompatibilityIdempotency,
  actor: OperationActor,
  operationKind: CompatibilityIdempotency['operationKind'],
  fingerprint: RequestFingerprint,
  serviceJobId: string
): Promise<ServiceReport> {
  if (
    existing.authenticatedUid !== actor.uid ||
    existing.operationKind !== operationKind ||
    existing.requestFingerprint !== fingerprint
  ) {
    throw new ServiceReportV2Error(409, 'idempotency_mismatch', 'The idempotency key was used for another request', 'never');
  }
  return parseV1Report(
    await store.get('serviceReports', existing.resultResourceId, transaction),
    serviceJobId
  );
}

async function runTransaction<T>(
  store: ServiceReportV2Store,
  operation: (transaction: V2Transaction) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await store.beginTransaction();
    try {
      return await operation(transaction);
    } catch (error) {
      if (error instanceof V2TransactionConflictError && attempt + 1 < MAX_TRANSACTION_RETRIES) continue;
      if (error instanceof V2TransactionConflictError) {
        throw new ServiceReportV2Error(503, 'transaction_retry_exhausted', 'The transaction could not be committed', 'same-idempotency-key');
      }
      throw error;
    }
  }
  throw new ServiceReportV2Error(503, 'transaction_retry_exhausted', 'The transaction could not be committed', 'same-idempotency-key');
}

function idempotencyRecord(input: {
  keyHash: string;
  actor: OperationActor;
  brandId: BrandId;
  operationKind: CompatibilityIdempotency['operationKind'];
  serviceJobId: string;
  reportId: string;
  fingerprint: RequestFingerprint;
  now: string;
}): Record<string, unknown> {
  return {
    recordVersion: 1,
    keyHash: `sha256:key-v1:${input.keyHash}`,
    authenticatedUid: input.actor.uid,
    brandId: input.brandId,
    operationKind: input.operationKind,
    routeResourceType: 'service-report',
    serviceJobId: input.serviceJobId,
    reportId: input.reportId,
    predecessorReportId: null,
    requestFingerprint: input.fingerprint,
    resultResourceType: 'service-report',
    resultResourceId: input.reportId,
    resultApprovalEventId: null,
    resultStatus: 'completed',
    resultRevision: null,
    resultDigest: null,
    createdAt: input.now,
    completedAt: input.now,
  };
}

function legacySaveFingerprint(
  serviceJobId: string,
  reportId: string,
  request: LegacyDraftSaveRequest
): Promise<RequestFingerprint> {
  return computeRequestFingerprint({
    contractVersion: 1,
    operationKind: 'legacy-draft-save',
    serviceJobId,
    reportId,
    expectedUpdatedAt: request.expectedUpdatedAt,
    patch: request.patch,
  });
}

function legacyFinalizeFingerprint(
  serviceJobId: string,
  reportId: string,
  request: Extract<FinalizeReportRequest, { contractVersion: 1 }>
): Promise<RequestFingerprint> {
  return computeRequestFingerprint({
    contractVersion: 1,
    operationKind: 'finalize-report',
    serviceJobId,
    reportId,
    expectedUpdatedAt: request.expectedUpdatedAt,
  });
}

export async function saveLegacyServiceReportDraft(input: {
  store: ServiceReportV2Store;
  actor: OperationActor;
  serviceJobId: string;
  reportId: string;
  idempotencyKey: string;
  request: LegacyDraftSaveRequest;
  now?: string;
}): Promise<ServiceReportV2OperationResult<ServiceReport>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await legacySaveFingerprint(input.serviceJobId, input.reportId, input.request);
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) {
      return {
        data: await replay(input.store, transaction, existing, input.actor, 'legacy-draft-save', fingerprint, input.serviceJobId),
        replayed: true,
      };
    }
    const job = parseJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    requireActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, job.brandId!);
    const report = parseV1Report(await input.store.get('serviceReports', input.reportId, transaction), input.serviceJobId);
    if (report.status !== 'draft') {
      throw new ServiceReportV2Error(409, 'report_already_final', 'The Service Report is already final', 'reload');
    }
    if (report.updatedAt !== input.request.expectedUpdatedAt) {
      throw new ServiceReportV2Error(412, 'stale_revision', 'The draft timestamp is stale', 'reload');
    }
    const updated = updateServiceReportDraft(report, input.request.patch, new Date(now));
    const fields = { ...input.request.patch, updatedAt: updated.updatedAt };
    await input.store.commit(transaction, [
      {
        kind: 'update',
        collection: 'serviceReports',
        id: report.id,
        data: fields,
        fieldPaths: Object.keys(fields),
      },
      {
        kind: 'create',
        collection: 'serviceReportIdempotency',
        id: keyHash,
        data: idempotencyRecord({
          keyHash,
          actor: input.actor,
          brandId: job.brandId!,
          operationKind: 'legacy-draft-save',
          serviceJobId: input.serviceJobId,
          reportId: report.id,
          fingerprint,
          now,
        }),
      },
    ]);
    return { data: updated, replayed: false };
  });
}

function releaseSlot(
  document: V2StoredDocument | null,
  serviceJobId: string,
  brandId: BrandId,
  reportId: string,
  now: string
): ServiceReportActiveDraftSlot {
  if (!document) malformed('The active draft slot is missing');
  const data = document.data;
  if (data.draftReportId === reportId && Object.keys(data).length === 1) {
    return {
      slotVersion: 1,
      serviceJobId,
      brandId,
      state: 'released',
      activeReportId: null,
      generation: 1,
      lastReleasedReportId: reportId,
      lastReleasedGeneration: 1,
      updatedAt: now,
    };
  }
  if (
    data.slotVersion !== 1 || data.serviceJobId !== serviceJobId || data.brandId !== brandId ||
    data.state !== 'active' || data.activeReportId !== reportId ||
    !Number.isSafeInteger(data.generation) || Number(data.generation) < 1
  ) {
    malformed('The active draft slot does not match the V1 report');
  }
  return {
    ...(data as unknown as ServiceReportActiveDraftSlot),
    state: 'released',
    activeReportId: null,
    lastReleasedReportId: reportId,
    lastReleasedGeneration: Number(data.generation),
    updatedAt: now,
  };
}

export async function finalizeLegacyServiceReport(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  reportId: string;
  idempotencyKey: string;
  request: Extract<FinalizeReportRequest, { contractVersion: 1 }>;
  now?: string;
}): Promise<ServiceReportV2OperationResult<ServiceReport>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await legacyFinalizeFingerprint(input.serviceJobId, input.reportId, input.request);
  const preliminary = parseV1Report(await input.store.get('serviceReports', input.reportId), input.serviceJobId);
  await resolveServiceReportEvidence(
    input.store,
    undefined,
    preliminary.evidenceAttachmentIds,
    input.serviceJobId,
    input.objects
  );
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) {
      return {
        data: await replay(input.store, transaction, existing, input.actor, 'finalize-report', fingerprint, input.serviceJobId),
        replayed: true,
      };
    }
    const job = parseJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    requireActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, job.brandId!);
    const report = parseV1Report(await input.store.get('serviceReports', input.reportId, transaction), input.serviceJobId);
    if (report.status === 'final') {
      throw new ServiceReportV2Error(409, 'report_already_final', 'The Service Report is already final', 'reload');
    }
    if (report.updatedAt !== input.request.expectedUpdatedAt) {
      throw new ServiceReportV2Error(412, 'stale_revision', 'The draft timestamp is stale', 'reload');
    }
    await resolveServiceReportEvidence(
      input.store,
      transaction,
      report.evidenceAttachmentIds,
      input.serviceJobId
    );
    let finalized: ServiceReport;
    try {
      finalized = finalizeServiceReport(report, job, new Date(now));
    } catch {
      throw new ServiceReportV2Error(400, 'validation_failed', 'The Service Report is incomplete', 'never');
    }
    const slot = releaseSlot(
      await input.store.get('serviceReportActiveDrafts', input.serviceJobId, transaction),
      input.serviceJobId,
      job.brandId!,
      report.id,
      now
    );
    const finalFields = {
      status: finalized.status,
      finalizedAt: finalized.finalizedAt,
      snapshot: finalized.snapshot,
      updatedAt: finalized.updatedAt,
    };
    await input.store.commit(transaction, [
      {
        kind: 'update', collection: 'serviceReports', id: report.id,
        data: finalFields, fieldPaths: Object.keys(finalFields),
      },
      {
        kind: 'update', collection: 'serviceReportActiveDrafts', id: input.serviceJobId,
        data: slot as unknown as Record<string, unknown>, fieldPaths: Object.keys(slot),
      },
      {
        kind: 'create', collection: 'serviceReportIdempotency', id: keyHash,
        data: idempotencyRecord({
          keyHash,
          actor: input.actor,
          brandId: job.brandId!,
          operationKind: 'finalize-report',
          serviceJobId: input.serviceJobId,
          reportId: report.id,
          fingerprint,
          now,
        }),
      },
    ]);
    return { data: finalized, replayed: false };
  });
}
