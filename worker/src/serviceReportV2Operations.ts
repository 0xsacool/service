import type { BrandId } from '../../src/types/brand.ts';
import type { CanonicalAttachmentKey } from '../../src/types/attachment.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type {
  AttachmentRetentionHold,
  BrandApprovalPolicy,
  RequestFingerprint,
  ServiceReportActiveDraftSlot,
  ServiceReportApprovalEvent,
  ServiceReportV2,
  ServiceReportV2Content,
} from '../../src/types/serviceReportV2.ts';
import { isCanonicalBrandId } from '../../src/types/brand.ts';
import { isValidServiceReport } from '../../src/services/serviceReport.ts';
import {
  buildSuccessorContent,
  computeServiceReportFinalDigest,
  createServiceJobSnapshotV2,
  isCompleteServiceReportV2Content,
  parseServiceReportV2,
} from '../../src/services/serviceReportV2.ts';
import {
  attachmentDeletionClaimDocId,
  attachmentMetadataDocId,
  attachmentRetentionHoldDocId,
  legacyAttachmentMetadataDocId,
  verifyAttachmentDeletionClaimAddress,
  verifyAttachmentMetadataAddress,
} from '../../src/services/attachmentIdentity.ts';
import {
  parseCoreStaffProfile,
  parseRepairReportActorProfile,
  type RepairReportActorProfile,
} from '../../src/services/staffProfile.ts';
import {
  canonicalizeEvidenceKeys,
  evidenceKeySetsEqual,
} from '../../src/services/evidenceOmission.ts';
import { bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import { formatServiceReportNumber } from '../../src/services/serviceReport.ts';
import type {
  ApprovalDecisionRequest,
  CreateReportV2Request,
  SuccessorRequest,
  TrustedPrintRequest,
} from './serviceReportV2Contracts.ts';
import {
  ServiceReportV2Error,
  createReportRequestFingerprint,
  decisionRequestFingerprint,
  finalizeRequestFingerprint,
  idempotencyDocumentId,
  successorRequestFingerprint,
} from './serviceReportV2Contracts.ts';

const MAX_TRANSACTION_RETRIES = 5;
const MAX_COUNTER = 2_147_483_647;

export interface V2StoredDocument {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

export interface V2Transaction {
  id: string;
}

export type V2Write =
  | { kind: 'create'; collection: string; id: string; data: Record<string, unknown> }
  | {
      kind: 'update';
      collection: string;
      id: string;
      data: Record<string, unknown>;
      fieldPaths: string[];
    };

export class V2TransactionConflictError extends Error {}

export interface ServiceReportV2Store {
  beginTransaction(): Promise<V2Transaction>;
  get(
    collection: string,
    id: string,
    transaction?: V2Transaction
  ): Promise<V2StoredDocument | null>;
  batchGet(
    addresses: readonly { collection: string; id: string }[],
    transaction?: V2Transaction
  ): Promise<V2StoredDocument[]>;
  query(
    collection: string,
    field: string,
    operator: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown,
    transaction?: V2Transaction
  ): Promise<V2StoredDocument[]>;
  commit(transaction: V2Transaction, writes: readonly V2Write[]): Promise<void>;
}

export interface EvidenceObjectHead {
  key: CanonicalAttachmentKey;
  size: number;
}

export interface EvidenceObjectStore {
  head(key: CanonicalAttachmentKey): Promise<EvidenceObjectHead | null>;
}

export interface OperationActor {
  uid: string;
}

interface CompletedIdempotency {
  recordVersion: 1;
  keyHash: string;
  authenticatedUid: string;
  brandId: BrandId;
  operationKind:
    | 'create-report'
    | 'finalize-report'
    | 'approval-decision'
    | 'create-replacement';
  routeResourceType: 'service-job' | 'service-report' | 'predecessor-report';
  serviceJobId: string;
  reportId: string | null;
  predecessorReportId: string | null;
  requestFingerprint: RequestFingerprint;
  resultResourceType: 'service-report' | 'approval-event';
  resultResourceId: string;
  resultApprovalEventId: string | null;
  resultStatus: 'completed';
  resultRevision: number | null;
  resultDigest: string | null;
  createdAt: string;
  completedAt: string;
}

interface ResolvedEvidence {
  key: CanonicalAttachmentKey;
  metadataDocumentId: string;
  metadata: Record<string, unknown>;
}

function malformed(message = 'A stored resource is malformed'): never {
  throw new ServiceReportV2Error(422, 'malformed_resource_state', message, 'operator');
}

function notFound(): never {
  throw new ServiceReportV2Error(404, 'resource_not_found', 'The resource was not found', 'never');
}

function forbidden(): never {
  throw new ServiceReportV2Error(403, 'forbidden', 'The operation is not allowed', 'never');
}

function parseServiceJob(document: V2StoredDocument | null, expectedId: string): ServiceJob {
  if (!document || document.id !== expectedId) notFound();
  const candidate = { ...document.data, id: document.id } as ServiceJob;
  if (!isCanonicalBrandId(candidate.brandId) || typeof candidate.customerName !== 'string' ||
      typeof candidate.status !== 'string') malformed('The Service Job is malformed');
  return candidate;
}

function parseActor(
  document: V2StoredDocument | null,
  actor: OperationActor,
  expectedBrand?: BrandId
): RepairReportActorProfile {
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
  if (expectedBrand && profile.brandId !== expectedBrand) forbidden();
  return profile;
}

function parseSlot(document: V2StoredDocument | null, serviceJobId: string): ServiceReportActiveDraftSlot | null {
  if (!document) return null;
  const value = document.data;
  if (
    value.slotVersion !== 1 || value.serviceJobId !== serviceJobId ||
    !isCanonicalBrandId(value.brandId) ||
    (value.state !== 'active' && value.state !== 'released') ||
    !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 ||
    Number(value.generation) > MAX_COUNTER ||
    (value.activeReportId !== null && typeof value.activeReportId !== 'string') ||
    (value.lastReleasedReportId !== null && typeof value.lastReleasedReportId !== 'string') ||
    (value.lastReleasedGeneration !== null && !Number.isSafeInteger(value.lastReleasedGeneration)) ||
    typeof value.updatedAt !== 'string'
  ) malformed('The active draft slot is malformed');
  const slot = value as unknown as ServiceReportActiveDraftSlot;
  if (
    (slot.state === 'active' && !slot.activeReportId) ||
    (slot.state === 'released' &&
      (slot.activeReportId !== null || slot.lastReleasedGeneration !== slot.generation))
  ) malformed('The active draft slot invariants are invalid');
  return slot;
}

function nextSlot(
  current: ServiceReportActiveDraftSlot | null,
  serviceJobId: string,
  brandId: BrandId,
  reportId: string,
  now: string
): { slot: ServiceReportActiveDraftSlot; create: boolean } {
  if (current?.state === 'active') {
    throw new ServiceReportV2Error(409, 'active_draft_conflict', 'An active draft already exists', 'reload');
  }
  if (current && current.brandId !== brandId) malformed('The active draft slot brand is invalid');
  const generation = current ? current.generation + 1 : 1;
  if (generation > MAX_COUNTER) {
    throw new ServiceReportV2Error(409, 'counter_exhausted', 'The active draft counter is exhausted', 'operator');
  }
  return {
    create: current === null,
    slot: {
      slotVersion: 1,
      serviceJobId,
      brandId,
      state: 'active',
      activeReportId: reportId,
      generation,
      lastReleasedReportId: current?.lastReleasedReportId ?? null,
      lastReleasedGeneration: current?.lastReleasedGeneration ?? null,
      updatedAt: now,
    },
  };
}

function parseSequence(document: V2StoredDocument | null): number {
  if (!document) return 0;
  const current = document.data.currentValue;
  if (!Number.isSafeInteger(current) || Number(current) < 0 || Number(current) >= 999999) {
    throw new ServiceReportV2Error(409, 'counter_exhausted', 'The report number sequence is exhausted', 'operator');
  }
  return Number(current);
}

function parseIdempotency(document: V2StoredDocument | null): CompletedIdempotency | null {
  if (!document) return null;
  const value = document.data as unknown as CompletedIdempotency;
  if (
    value.recordVersion !== 1 || value.resultStatus !== 'completed' ||
    typeof value.authenticatedUid !== 'string' || typeof value.requestFingerprint !== 'string' ||
    typeof value.resultResourceId !== 'string'
  ) malformed('The idempotency record is malformed');
  return value;
}

async function replayReport(
  store: ServiceReportV2Store,
  existing: CompletedIdempotency,
  actor: OperationActor,
  fingerprint: RequestFingerprint,
  transaction: V2Transaction
): Promise<ServiceReportV2> {
  if (existing.authenticatedUid !== actor.uid || existing.requestFingerprint !== fingerprint) {
    throw new ServiceReportV2Error(409, 'idempotency_mismatch', 'The idempotency key was used for another request', 'never');
  }
  const document = await store.get('serviceReports', existing.resultResourceId, transaction);
  const report = document ? parseServiceReportV2(document.id, document.data) : null;
  if (!report) throw new ServiceReportV2Error(409, 'integrity_mismatch', 'The idempotent result is inconsistent', 'operator');
  return report;
}

function idempotencyRecord(input: {
  keyHash: string;
  actor: OperationActor;
  brandId: BrandId;
  operationKind: CompletedIdempotency['operationKind'];
  routeResourceType: CompletedIdempotency['routeResourceType'];
  serviceJobId: string;
  reportId: string | null;
  predecessorReportId: string | null;
  fingerprint: RequestFingerprint;
  resultResourceType: CompletedIdempotency['resultResourceType'];
  resultResourceId: string;
  resultApprovalEventId: string | null;
  resultRevision: number | null;
  resultDigest: string | null;
  now: string;
}): CompletedIdempotency {
  return {
    recordVersion: 1,
    keyHash: `sha256:key-v1:${input.keyHash}`,
    authenticatedUid: input.actor.uid,
    brandId: input.brandId,
    operationKind: input.operationKind,
    routeResourceType: input.routeResourceType,
    serviceJobId: input.serviceJobId,
    reportId: input.reportId,
    predecessorReportId: input.predecessorReportId,
    requestFingerprint: input.fingerprint,
    resultResourceType: input.resultResourceType,
    resultResourceId: input.resultResourceId,
    resultApprovalEventId: input.resultApprovalEventId,
    resultStatus: 'completed',
    resultRevision: input.resultRevision,
    resultDigest: input.resultDigest,
    createdAt: input.now,
    completedAt: input.now,
  };
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

function blockingDeletionState(value: unknown): boolean {
  return value === 'claimed' || value === 'deleting' || value === 'r2-deleted' || value === 'failed';
}

async function resolveEvidence(
  store: ServiceReportV2Store,
  transaction: V2Transaction | undefined,
  keys: readonly CanonicalAttachmentKey[],
  serviceJobId: string,
  objects?: EvidenceObjectStore
): Promise<ResolvedEvidence[]> {
  if (keys.length === 0) return [];
  const addresses: { collection: string; id: string }[] = [];
  const identityByKey = new Map<string, { v2: string; legacy: string; claim: string }>();
  for (const key of keys) {
    const identity = {
      v2: await attachmentMetadataDocId(key),
      legacy: legacyAttachmentMetadataDocId(key),
      claim: await attachmentDeletionClaimDocId(key),
    };
    identityByKey.set(key, identity);
    addresses.push(
      { collection: 'serviceJobAttachments', id: identity.v2 },
      { collection: 'serviceJobAttachments', id: identity.legacy },
      { collection: 'attachmentDeletionClaims', id: identity.claim }
    );
  }
  const uniqueAddresses = Array.from(
    new Map(addresses.map((address) => [`${address.collection}/${address.id}`, address])).values()
  );
  const documents = await store.batchGet(uniqueAddresses, transaction);
  const returned = new Map(documents.map((document) => [`${document.collection}/${document.id}`, document]));
  const resolved: ResolvedEvidence[] = [];
  for (const key of keys) {
    const identity = identityByKey.get(key)!;
    const v2 = returned.get(`serviceJobAttachments/${identity.v2}`);
    const legacy = returned.get(`serviceJobAttachments/${identity.legacy}`);
    const candidates: V2StoredDocument[] = [];
    if (v2) {
      if (!(await verifyAttachmentMetadataAddress(v2.id, v2.data.path))) {
        throw new ServiceReportV2Error(409, 'evidence_identity_mismatch', 'Evidence identity verification failed', 'operator');
      }
      if (v2.data.path === key) candidates.push(v2);
    }
    if (legacy) {
      if (legacy.data.path !== key) {
        throw new ServiceReportV2Error(409, 'evidence_identity_collision', 'Legacy evidence identity collided', 'operator');
      }
      candidates.push(legacy);
    }
    if (candidates.length === 0) {
      throw new ServiceReportV2Error(409, 'evidence_metadata_missing', 'Evidence metadata is missing', 'reload');
    }
    if (candidates.length !== 1) {
      throw new ServiceReportV2Error(409, 'duplicate_attachment_metadata', 'Duplicate evidence metadata exists', 'operator');
    }
    const selected = candidates[0]!;
    if (selected.data.jobId !== serviceJobId) forbidden();
    if (selected.data.deletedAt !== null && selected.data.deletedAt !== undefined) {
      throw new ServiceReportV2Error(409, 'evidence_deleted', 'Evidence has been deleted', 'reload');
    }
    const claim = returned.get(`attachmentDeletionClaims/${identity.claim}`);
    if (claim) {
      if (!(await verifyAttachmentDeletionClaimAddress(claim.id, claim.data.canonicalAttachmentKey))) {
        throw new ServiceReportV2Error(409, 'evidence_identity_mismatch', 'Deletion claim identity verification failed', 'operator');
      }
      if (blockingDeletionState(claim.data.state)) {
        throw new ServiceReportV2Error(409, 'evidence_deletion_in_progress', 'Evidence deletion is in progress', 'reload');
      }
    }
    if (objects) {
      const head = await objects.head(key);
      if (!head || head.key !== key) {
        throw new ServiceReportV2Error(409, 'evidence_object_missing', 'Evidence bytes are unavailable', 'reload');
      }
      if (!Number.isSafeInteger(selected.data.size) || Number(selected.data.size) !== head.size) {
        throw new ServiceReportV2Error(409, 'evidence_identity_mismatch', 'Evidence size verification failed', 'operator');
      }
    }
    resolved.push({ key, metadataDocumentId: selected.id, metadata: selected.data });
  }
  return resolved;
}

export async function resolveServiceReportEvidence(
  store: ServiceReportV2Store,
  transaction: V2Transaction | undefined,
  keys: readonly CanonicalAttachmentKey[],
  serviceJobId: string,
  objects?: EvidenceObjectStore
): Promise<void> {
  await resolveEvidence(store, transaction, keys, serviceJobId, objects);
}

interface PredecessorEvidencePartition {
  available: CanonicalAttachmentKey[];
  eligibleOmissions: CanonicalAttachmentKey[];
}

// Only these three codes mean "the evidence is genuinely gone". Every other
// failure — a temporary/ambiguous deletion state, a cross-brand owner, an
// identity or size mismatch — rethrows, so an integrity problem can never be
// laundered into an omission candidate the operator is allowed to confirm.
const OMITTABLE_EVIDENCE_CODES = new Set([
  'evidence_deleted',
  'evidence_object_missing',
  'evidence_metadata_missing',
]);

async function partitionPredecessorEvidence(
  store: ServiceReportV2Store,
  transaction: V2Transaction | undefined,
  predecessor: ServiceReportV2,
  serviceJobId: string,
  objects: EvidenceObjectStore
): Promise<PredecessorEvidencePartition> {
  const available: CanonicalAttachmentKey[] = [];
  const eligibleOmissions: CanonicalAttachmentKey[] = [];
  for (const key of predecessor.evidenceAttachmentIds) {
    try {
      await resolveEvidence(store, transaction, [key], serviceJobId, objects);
      available.push(key);
    } catch (error) {
      if (error instanceof ServiceReportV2Error && OMITTABLE_EVIDENCE_CODES.has(error.code)) {
        eligibleOmissions.push(key);
      } else {
        throw error;
      }
    }
  }
  return { available, eligibleOmissions: canonicalizeEvidenceKeys(eligibleOmissions) };
}

function requireConfirmedOmissionsMatch(
  eligibleOmissions: readonly CanonicalAttachmentKey[],
  confirmed: readonly CanonicalAttachmentKey[]
): void {
  if (evidenceKeySetsEqual(eligibleOmissions, confirmed)) return;
  throw new ServiceReportV2Error(
    409,
    'successor_evidence_confirmation_required',
    'The evidence omission confirmation does not match the current evidence state',
    'reload',
    { eligibleEvidenceAttachmentIds: [...eligibleOmissions] }
  );
}

export interface ServiceReportV2OperationResult<T> {
  data: T;
  replayed: boolean;
}

export async function createServiceReportV2(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  idempotencyKey: string;
  request: CreateReportV2Request;
  now?: string;
}): Promise<ServiceReportV2OperationResult<ServiceReportV2>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await createReportRequestFingerprint(input.serviceJobId, input.request);
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) {
      return { data: await replayReport(input.store, existing, input.actor, fingerprint, transaction), replayed: true };
    }
    const serviceJob = parseServiceJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    const profile = parseActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, serviceJob.brandId!);
    await resolveEvidence(input.store, transaction, input.request.content.evidenceAttachmentIds, input.serviceJobId);
    const currentSlot = parseSlot(await input.store.get('serviceReportActiveDrafts', input.serviceJobId, transaction), input.serviceJobId);
    const reportId = crypto.randomUUID();
    const allocated = nextSlot(currentSlot, input.serviceJobId, profile.brandId, reportId, now);
    const year = bangkokNumberingYear(new Date(now));
    const sequenceId = `${profile.brandId}__repair_report__${year}`;
    const currentSequence = parseSequence(await input.store.get('numberSequences', sequenceId, transaction));
    const sequence = currentSequence + 1;
    const report: ServiceReportV2 = {
      schemaVersion: 2,
      reportId,
      id: reportId,
      serviceJobId: input.serviceJobId,
      reportNo: formatServiceReportNumber(year, sequence),
      brandId: profile.brandId,
      status: 'draft',
      activeDraftGeneration: allocated.slot.generation,
      createdAt: now,
      createdByUid: profile.uid,
      createdByRoleSnapshot: profile.role,
      createdByDisplayNameSnapshot: profile.displayName,
      contentRevision: 0,
      updatedAt: now,
      predecessorReportId: null,
      ...input.request.content,
      snapshot: null,
      finalizedAt: null,
      finalizedByUid: null,
      finalizedByRoleSnapshot: null,
      finalizedByDisplayNameSnapshot: null,
      finalizedFromRevision: null,
      finalContentDigest: null,
      approvalState: 'not-submitted',
      currentApprovalEventId: null,
      approvalDecidedAt: null,
    };
    const idem = idempotencyRecord({
      keyHash, actor: input.actor, brandId: profile.brandId, operationKind: 'create-report',
      routeResourceType: 'service-job', serviceJobId: input.serviceJobId, reportId: null,
      predecessorReportId: null, fingerprint, resultResourceType: 'service-report',
      resultResourceId: reportId, resultApprovalEventId: null, resultRevision: 0,
      resultDigest: null, now,
    });
    await input.store.commit(transaction, [
      { kind: 'create', collection: 'serviceReports', id: reportId, data: withoutId(report) },
      allocated.create
        ? { kind: 'create', collection: 'serviceReportActiveDrafts', id: input.serviceJobId, data: allocated.slot as unknown as Record<string, unknown> }
        : { kind: 'update', collection: 'serviceReportActiveDrafts', id: input.serviceJobId, data: allocated.slot as unknown as Record<string, unknown>, fieldPaths: Object.keys(allocated.slot) },
      {
        kind: 'update', collection: 'numberSequences', id: sequenceId,
        data: { brandId: profile.brandId, documentType: 'repair_report', year, currentValue: sequence },
        fieldPaths: ['brandId', 'documentType', 'year', 'currentValue'],
      },
      { kind: 'create', collection: 'serviceReportIdempotency', id: keyHash, data: idem as unknown as Record<string, unknown> },
    ]);
    return { data: report, replayed: false };
  });
}

function withoutId(report: ServiceReportV2): Record<string, unknown> {
  const { id: _id, ...data } = report;
  return data as unknown as Record<string, unknown>;
}

function parseV2Report(document: V2StoredDocument | null, serviceJobId: string): ServiceReportV2 {
  if (!document) notFound();
  const report = parseServiceReportV2(document.id, document.data);
  if (!report || report.serviceJobId !== serviceJobId) malformed('The Service Report is malformed');
  return report;
}

export async function finalizeServiceReportV2(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  reportId: string;
  idempotencyKey: string;
  expectedContentRevision: number;
  now?: string;
}): Promise<ServiceReportV2OperationResult<ServiceReportV2>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const request = { contractVersion: 2 as const, expectedContentRevision: input.expectedContentRevision };
  const fingerprint = await finalizeRequestFingerprint(input.serviceJobId, input.reportId, request);
  const preliminary = parseV2Report(await input.store.get('serviceReports', input.reportId), input.serviceJobId);
  await resolveEvidence(input.store, undefined, preliminary.evidenceAttachmentIds, input.serviceJobId, input.objects);
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) return { data: await replayReport(input.store, existing, input.actor, fingerprint, transaction), replayed: true };
    const serviceJob = parseServiceJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    const profile = parseActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, serviceJob.brandId!);
    const report = parseV2Report(await input.store.get('serviceReports', input.reportId, transaction), input.serviceJobId);
    if (report.status === 'final') {
      throw new ServiceReportV2Error(409, 'report_already_final', 'The Service Report is already final', 'reload');
    }
    if (report.contentRevision !== input.expectedContentRevision) {
      throw new ServiceReportV2Error(412, 'stale_revision', 'The draft revision is stale', 'reload');
    }
    if (report.contentRevision < 1) {
      throw new ServiceReportV2Error(400, 'validation_failed', 'The initial draft must be saved before finalization', 'never');
    }
    if (!isCompleteServiceReportV2Content(report)) {
      throw new ServiceReportV2Error(400, 'validation_failed', 'The Service Report is incomplete', 'never');
    }
    const slot = parseSlot(await input.store.get('serviceReportActiveDrafts', input.serviceJobId, transaction), input.serviceJobId);
    if (!slot || slot.state !== 'active' || slot.activeReportId !== report.reportId || slot.generation !== report.activeDraftGeneration) {
      malformed('The active draft slot does not match the report');
    }
    await resolveEvidence(input.store, transaction, report.evidenceAttachmentIds, input.serviceJobId);
    const snapshot = createServiceJobSnapshotV2(serviceJob);
    if (!snapshot) malformed('The Service Job cannot produce a final snapshot');
    const draftFinal: Extract<ServiceReportV2, { status: 'final' }> = {
      ...report,
      status: 'final',
      snapshot,
      finalizedAt: now,
      finalizedByUid: profile.uid,
      finalizedByRoleSnapshot: profile.role,
      finalizedByDisplayNameSnapshot: profile.displayName,
      finalizedFromRevision: report.contentRevision,
      finalContentDigest: `sha256:v1:${'0'.repeat(64)}`,
      approvalState: 'pending',
      currentApprovalEventId: null,
      approvalDecidedAt: null,
      updatedAt: now,
    };
    const finalized = { ...draftFinal, finalContentDigest: await computeServiceReportFinalDigest(draftFinal) };
    const released: ServiceReportActiveDraftSlot = {
      ...slot,
      state: 'released',
      activeReportId: null,
      lastReleasedReportId: report.reportId,
      lastReleasedGeneration: slot.generation,
      updatedAt: now,
    };
    const idem = idempotencyRecord({
      keyHash, actor: input.actor, brandId: profile.brandId, operationKind: 'finalize-report',
      routeResourceType: 'service-report', serviceJobId: input.serviceJobId, reportId: input.reportId,
      predecessorReportId: null, fingerprint, resultResourceType: 'service-report',
      resultResourceId: input.reportId, resultApprovalEventId: null,
      resultRevision: finalized.contentRevision, resultDigest: finalized.finalContentDigest, now,
    });
    await input.store.commit(transaction, [
      {
        kind: 'update', collection: 'serviceReports', id: report.reportId,
        data: withoutId(finalized), fieldPaths: [
          'status', 'snapshot', 'finalizedAt', 'finalizedByUid', 'finalizedByRoleSnapshot',
          'finalizedByDisplayNameSnapshot', 'finalizedFromRevision', 'finalContentDigest',
          'approvalState', 'currentApprovalEventId', 'approvalDecidedAt', 'updatedAt',
        ],
      },
      { kind: 'update', collection: 'serviceReportActiveDrafts', id: input.serviceJobId, data: released as unknown as Record<string, unknown>, fieldPaths: Object.keys(released) },
      { kind: 'create', collection: 'serviceReportIdempotency', id: keyHash, data: idem as unknown as Record<string, unknown> },
    ]);
    return { data: finalized, replayed: false };
  });
}

function parsePolicy(document: V2StoredDocument | null, brandId: BrandId): BrandApprovalPolicy {
  if (!document || document.id !== brandId) malformed('The approval policy is missing');
  const value = document.data;
  if (value.schemaVersion !== 1 || value.brandId !== brandId || typeof value.allowSelfApproval !== 'boolean' ||
      !Number.isSafeInteger(value.policyVersion) || Number(value.policyVersion) < 1 ||
      typeof value.updatedAt !== 'string' || typeof value.updatedByUid !== 'string') {
    malformed('The approval policy is malformed');
  }
  return value as unknown as BrandApprovalPolicy;
}

// Returns the value to write, or null when the stored deadline already covers
// the candidate and the field must be left untouched. A malformed stored value
// is not trusted as a floor — it cannot be compared, so the candidate wins and
// repairs it, rather than an unparseable string pinning retention forever.
function laterRetainUntil(existing: unknown, candidate: string): string | null {
  if (typeof existing !== 'string') return candidate;
  const existingMs = Date.parse(existing);
  if (!Number.isFinite(existingMs)) return candidate;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return null;
  return existingMs >= candidateMs ? null : candidate;
}

function plusThreeCalendarYears(value: string): string {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + 3);
  return date.toISOString();
}

export async function decideServiceReportV2(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  reportId: string;
  idempotencyKey: string;
  request: ApprovalDecisionRequest;
  now?: string;
}): Promise<ServiceReportV2OperationResult<{ report: ServiceReportV2; event: ServiceReportApprovalEvent }>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await decisionRequestFingerprint(input.serviceJobId, input.reportId, input.request);
  const preliminary = parseV2Report(await input.store.get('serviceReports', input.reportId), input.serviceJobId);
  if (input.request.decision === 'approved') {
    await resolveEvidence(input.store, undefined, preliminary.evidenceAttachmentIds, input.serviceJobId, input.objects);
  }
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) {
      if (existing.authenticatedUid !== input.actor.uid || existing.requestFingerprint !== fingerprint) {
        throw new ServiceReportV2Error(409, 'idempotency_mismatch', 'The idempotency key was used for another request', 'never');
      }
      const report = parseV2Report(await input.store.get('serviceReports', input.reportId, transaction), input.serviceJobId);
      const eventDocument = await input.store.get('serviceReportApprovals', input.reportId, transaction);
      if (!eventDocument) malformed('The approval event is missing');
      return { data: { report, event: eventDocument.data as unknown as ServiceReportApprovalEvent }, replayed: true };
    }
    const serviceJob = parseServiceJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    const profile = parseActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, serviceJob.brandId!);
    if (profile.role !== 'approver' && profile.role !== 'admin') {
      throw new ServiceReportV2Error(403, 'insufficient_role', 'Approver or admin role is required', 'never');
    }
    const report = parseV2Report(await input.store.get('serviceReports', input.reportId, transaction), input.serviceJobId);
    if (report.status !== 'final') malformed('Only a final report can be decided');
    if (report.approvalState !== 'pending') {
      throw new ServiceReportV2Error(409, 'approval_already_terminal', 'The report already has a terminal decision', 'reload');
    }
    const recomputed = await computeServiceReportFinalDigest(report);
    if (input.request.expectedFinalDigest !== report.finalContentDigest || recomputed !== report.finalContentDigest) {
      throw new ServiceReportV2Error(412, 'stale_digest', 'The final digest is stale', 'reload');
    }
    const policy = parsePolicy(await input.store.get('brandApprovalPolicies', profile.brandId, transaction), profile.brandId);
    const selfApprovalUsed = profile.uid === report.finalizedByUid;
    if (selfApprovalUsed && !policy.allowSelfApproval) forbidden();
    const evidence = input.request.decision === 'approved'
      ? await resolveEvidence(input.store, transaction, report.evidenceAttachmentIds, input.serviceJobId)
      : [];
    const retainUntil = input.request.decision === 'approved' ? plusThreeCalendarYears(now) : null;
    const event: ServiceReportApprovalEvent = {
      eventVersion: 1,
      eventId: report.reportId,
      reportId: report.reportId,
      serviceJobId: report.serviceJobId,
      brandId: report.brandId,
      reportNo: report.reportNo,
      activeDraftGeneration: report.activeDraftGeneration,
      decision: input.request.decision,
      rejectionReason: input.request.rejectionReason,
      submissionDigest: report.finalContentDigest,
      finalizedFromRevision: report.finalizedFromRevision,
      finalizedByUid: report.finalizedByUid,
      approverUid: profile.uid,
      approverRoleSnapshot: profile.role,
      approverDisplayNameSnapshot: profile.displayName,
      decidedAt: now,
      policyVersion: policy.policyVersion,
      allowSelfApproval: policy.allowSelfApproval,
      selfApprovalUsed,
      requestFingerprint: fingerprint,
      approvedEvidenceRetainUntil: retainUntil,
    };
    const terminal: ServiceReportV2 = {
      ...report,
      approvalState: input.request.decision,
      currentApprovalEventId: report.reportId,
      approvalDecidedAt: now,
      updatedAt: now,
    };
    const writes: V2Write[] = [
      { kind: 'create', collection: 'serviceReportApprovals', id: report.reportId, data: event as unknown as Record<string, unknown> },
      {
        kind: 'update', collection: 'serviceReports', id: report.reportId,
        data: withoutId(terminal),
        fieldPaths: ['approvalState', 'currentApprovalEventId', 'approvalDecidedAt', 'updatedAt'],
      },
    ];
    if (retainUntil) {
      for (const item of evidence) {
        const holdId = await attachmentRetentionHoldDocId(event.eventId, item.key);
        // The hold records THIS approval's own deadline and is immutable
        // history; approvalRetainUntil on the attachment is a projection over
        // every hold, so it may only ever move forward.
        const hold: AttachmentRetentionHold = {
          holdVersion: 1, holdId, approvalEventId: event.eventId, reportId: report.reportId,
          canonicalAttachmentKey: item.key, serviceJobId: report.serviceJobId, brandId: report.brandId,
          approvedAt: now, retainUntil, createdByUid: profile.uid,
        };
        writes.push({
          kind: 'create', collection: 'attachmentRetentionHolds', id: holdId,
          data: hold as unknown as Record<string, unknown>,
        });
        const projected = laterRetainUntil(item.metadata.approvalRetainUntil, retainUntil);
        if (projected !== null) {
          writes.push({
            kind: 'update', collection: 'serviceJobAttachments', id: item.metadataDocumentId,
            data: { approvalRetainUntil: projected }, fieldPaths: ['approvalRetainUntil'],
          });
        }
      }
    }
    const idem = idempotencyRecord({
      keyHash, actor: input.actor, brandId: profile.brandId, operationKind: 'approval-decision',
      routeResourceType: 'service-report', serviceJobId: input.serviceJobId, reportId: input.reportId,
      predecessorReportId: null, fingerprint, resultResourceType: 'approval-event',
      resultResourceId: report.reportId, resultApprovalEventId: report.reportId,
      resultRevision: report.contentRevision, resultDigest: report.finalContentDigest, now,
    });
    writes.push({ kind: 'create', collection: 'serviceReportIdempotency', id: keyHash, data: idem as unknown as Record<string, unknown> });
    await input.store.commit(transaction, writes);
    return { data: { report: terminal, event }, replayed: false };
  });
}

export async function createServiceReportSuccessorV2(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  predecessorReportId: string;
  idempotencyKey: string;
  request: SuccessorRequest;
  now?: string;
}): Promise<ServiceReportV2OperationResult<ServiceReportV2>> {
  const now = input.now ?? new Date().toISOString();
  const keyHash = await idempotencyDocumentId(input.idempotencyKey);
  const fingerprint = await successorRequestFingerprint(input.serviceJobId, input.predecessorReportId, input.request);
  const predecessor = parseV2Report(await input.store.get('serviceReports', input.predecessorReportId), input.serviceJobId);
  if (predecessor.status !== 'final' || predecessor.approvalState !== 'rejected') malformed('The predecessor is not rejected');
  const confirmed = input.request.confirmedOmittedEvidenceAttachmentIds;
  const preliminaryPartition = await partitionPredecessorEvidence(input.store, undefined, predecessor, input.serviceJobId, input.objects);
  requireConfirmedOmissionsMatch(preliminaryPartition.eligibleOmissions, confirmed);
  return runTransaction(input.store, async (transaction) => {
    const existing = parseIdempotency(await input.store.get('serviceReportIdempotency', keyHash, transaction));
    if (existing) return { data: await replayReport(input.store, existing, input.actor, fingerprint, transaction), replayed: true };
    const serviceJob = parseServiceJob(await input.store.get('serviceJobs', input.serviceJobId, transaction), input.serviceJobId);
    const profile = parseActor(await input.store.get('staffProfiles', input.actor.uid, transaction), input.actor, serviceJob.brandId!);
    const current = parseV2Report(await input.store.get('serviceReports', input.predecessorReportId, transaction), input.serviceJobId);
    if (current.status !== 'final' || current.approvalState !== 'rejected' || current.finalContentDigest !== input.request.expectedPredecessorDigest) {
      throw new ServiceReportV2Error(412, 'stale_digest', 'The predecessor digest is stale', 'reload');
    }
    const event = await input.store.get('serviceReportApprovals', current.reportId, transaction);
    if (!event || event.data.decision !== 'rejected' || event.data.submissionDigest !== current.finalContentDigest) malformed('The rejection event is invalid');
    if (await input.store.get('serviceReportSuccessorClaims', current.reportId, transaction)) {
      throw new ServiceReportV2Error(409, 'predecessor_has_successor', 'The predecessor already has a successor', 'reload');
    }
    // Re-derive the eligible omission set against authoritative in-transaction
    // state: the pre-check above ran outside the transaction, so evidence may
    // have changed since. A drifted set must be re-confirmed by the operator,
    // never silently adapted into a different successor than they approved.
    const partition = await partitionPredecessorEvidence(input.store, transaction, current, input.serviceJobId, input.objects);
    requireConfirmedOmissionsMatch(partition.eligibleOmissions, confirmed);
    const slot = parseSlot(await input.store.get('serviceReportActiveDrafts', input.serviceJobId, transaction), input.serviceJobId);
    const reportId = crypto.randomUUID();
    const allocated = nextSlot(slot, input.serviceJobId, profile.brandId, reportId, now);
    const year = bangkokNumberingYear(new Date(now));
    const sequenceId = `${profile.brandId}__repair_report__${year}`;
    const sequence = parseSequence(await input.store.get('numberSequences', sequenceId, transaction)) + 1;
    const content: ServiceReportV2Content = {
      ...buildSuccessorContent(current),
      evidenceAttachmentIds: partition.available,
    };
    const successor: ServiceReportV2 = {
      schemaVersion: 2, reportId, id: reportId, serviceJobId: current.serviceJobId,
      reportNo: formatServiceReportNumber(year, sequence), brandId: current.brandId,
      status: 'draft', activeDraftGeneration: allocated.slot.generation, createdAt: now,
      createdByUid: profile.uid, createdByRoleSnapshot: profile.role,
      createdByDisplayNameSnapshot: profile.displayName, contentRevision: 0, updatedAt: now,
      predecessorReportId: current.reportId, ...content, snapshot: null, finalizedAt: null,
      finalizedByUid: null, finalizedByRoleSnapshot: null,
      finalizedByDisplayNameSnapshot: null, finalizedFromRevision: null,
      finalContentDigest: null, approvalState: 'not-submitted', currentApprovalEventId: null,
      approvalDecidedAt: null,
    };
    const claim = {
      claimVersion: 1, predecessorReportId: current.reportId, successorReportId: reportId,
      serviceJobId: current.serviceJobId, brandId: current.brandId, createdAt: now,
      createdByUid: profile.uid,
    };
    const idem = idempotencyRecord({
      keyHash, actor: input.actor, brandId: profile.brandId, operationKind: 'create-replacement',
      routeResourceType: 'predecessor-report', serviceJobId: input.serviceJobId, reportId: null,
      predecessorReportId: current.reportId, fingerprint, resultResourceType: 'service-report',
      resultResourceId: reportId, resultApprovalEventId: null, resultRevision: 0,
      resultDigest: null, now,
    });
    await input.store.commit(transaction, [
      { kind: 'create', collection: 'serviceReports', id: reportId, data: withoutId(successor) },
      allocated.create
        ? { kind: 'create', collection: 'serviceReportActiveDrafts', id: input.serviceJobId, data: allocated.slot as unknown as Record<string, unknown> }
        : { kind: 'update', collection: 'serviceReportActiveDrafts', id: input.serviceJobId, data: allocated.slot as unknown as Record<string, unknown>, fieldPaths: Object.keys(allocated.slot) },
      { kind: 'create', collection: 'serviceReportSuccessorClaims', id: current.reportId, data: claim },
      {
        kind: 'update', collection: 'numberSequences', id: sequenceId,
        data: { brandId: profile.brandId, documentType: 'repair_report', year, currentValue: sequence },
        fieldPaths: ['brandId', 'documentType', 'year', 'currentValue'],
      },
      { kind: 'create', collection: 'serviceReportIdempotency', id: keyHash, data: idem as unknown as Record<string, unknown> },
    ]);
    return { data: successor, replayed: false };
  });
}

export type TrustedPrintState =
  | 'legacy-v1'
  | 'v2-draft'
  | 'v2-pending'
  | 'v2-approved'
  | 'v2-rejected'
  | 'integrity-incident';

export interface TrustedPrintResult {
  printState: TrustedPrintState;
  report: ServiceReport | ServiceReportV2;
  event: ServiceReportApprovalEvent | null;
  evidence: { canonicalAttachmentKey: CanonicalAttachmentKey; status: 'available' | 'missing' }[];
  verifiedAt: string;
}

export async function prepareTrustedPrint(input: {
  store: ServiceReportV2Store;
  objects: EvidenceObjectStore;
  actor: OperationActor;
  serviceJobId: string;
  reportId: string;
  request: TrustedPrintRequest;
  now?: string;
}): Promise<TrustedPrintResult> {
  const serviceJob = parseServiceJob(await input.store.get('serviceJobs', input.serviceJobId), input.serviceJobId);
  parseActor(await input.store.get('staffProfiles', input.actor.uid), input.actor, serviceJob.brandId!);
  const document = await input.store.get('serviceReports', input.reportId);
  if (!document) notFound();
  if (input.request.contractVersion === 1) {
    const candidate = { ...document.data, id: document.id };
    if (!isValidServiceReport(candidate) || candidate.serviceJobId !== input.serviceJobId) malformed();
    return { printState: 'legacy-v1', report: candidate, event: null, evidence: [], verifiedAt: input.now ?? new Date().toISOString() };
  }
  const report = parseV2Report(document, input.serviceJobId);
  const verifiedAt = input.now ?? new Date().toISOString();
  if (report.status === 'draft') return { printState: 'v2-draft', report, event: null, evidence: [], verifiedAt };
  const recomputed = await computeServiceReportFinalDigest(report);
  if (recomputed !== report.finalContentDigest) {
    throw new ServiceReportV2Error(409, 'integrity_mismatch', 'The report digest does not verify', 'operator');
  }
  if (report.approvalState === 'pending') return { printState: 'v2-pending', report, event: null, evidence: [], verifiedAt };
  const eventDocument = await input.store.get('serviceReportApprovals', report.reportId);
  if (!eventDocument || eventDocument.data.submissionDigest !== report.finalContentDigest ||
      eventDocument.data.decision !== report.approvalState) malformed('The approval event is invalid');
  const event = eventDocument.data as unknown as ServiceReportApprovalEvent;
  if (report.approvalState === 'rejected') return { printState: 'v2-rejected', report, event, evidence: [], verifiedAt };
  const evidence: TrustedPrintResult['evidence'] = [];
  let incident = false;
  for (const key of report.evidenceAttachmentIds) {
    try {
      await resolveEvidence(input.store, undefined, [key], input.serviceJobId, input.objects);
      const holdId = await attachmentRetentionHoldDocId(event.eventId, key);
      const hold = await input.store.get('attachmentRetentionHolds', holdId);
      if (!hold || hold.data.canonicalAttachmentKey !== key || hold.data.approvalEventId !== event.eventId) throw new Error('hold');
      evidence.push({ canonicalAttachmentKey: key, status: 'available' });
    } catch {
      incident = true;
      evidence.push({ canonicalAttachmentKey: key, status: 'missing' });
    }
  }
  if (incident && input.request.mode === 'normal') {
    throw new ServiceReportV2Error(409, 'evidence_integrity_incident', 'Approved evidence is unavailable', 'operator');
  }
  return { printState: incident ? 'integrity-incident' : 'v2-approved', report, event, evidence, verifiedAt };
}
