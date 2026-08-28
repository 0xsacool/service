import type {
  EvidenceObjectStore,
  ServiceReportV2Store,
  V2StoredDocument,
  V2Transaction,
  V2Write,
} from '../src/serviceReportV2Operations.ts';
import {
  attachmentMetadataDocId,
  attachmentDeletionClaimDocId,
} from '../../src/services/attachmentIdentity.ts';

export const BRAND = 'bruno-thailand';
export const SERVICE_JOB_ID = 'BRN-2026-000001';
export const APPROVER_UID = 'approver-uid-0001';

export function evidenceKey(name: string, jobId = SERVICE_JOB_ID): string {
  return `service-jobs/${jobId}/report/00000000-0000-4000-8000-00000000000${name}-evidence.jpg`;
}

export class MemoryV2Store implements ServiceReportV2Store {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly committedWrites: V2Write[][] = [];
  private transactionSeq = 0;

  // Runs once, immediately before the Nth commit lands, so a test can mutate
  // authoritative state in the window the transaction is meant to guard.
  onBeforeCommit: ((attempt: number) => void) | null = null;
  private commitAttempts = 0;

  static address(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  set(collection: string, id: string, data: Record<string, unknown>): void {
    this.docs.set(MemoryV2Store.address(collection, id), data);
  }

  read(collection: string, id: string): Record<string, unknown> | undefined {
    return this.docs.get(MemoryV2Store.address(collection, id));
  }

  async beginTransaction(): Promise<V2Transaction> {
    this.transactionSeq += 1;
    return { id: `tx-${this.transactionSeq}` };
  }

  async get(collection: string, id: string): Promise<V2StoredDocument | null> {
    const data = this.docs.get(MemoryV2Store.address(collection, id));
    return data ? { collection, id, data } : null;
  }

  async batchGet(
    addresses: readonly { collection: string; id: string }[]
  ): Promise<V2StoredDocument[]> {
    const results: V2StoredDocument[] = [];
    for (const address of addresses) {
      const document = await this.get(address.collection, address.id);
      if (document) results.push(document);
    }
    return results;
  }

  async query(
    collection: string,
    field: string,
    operator: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown
  ): Promise<V2StoredDocument[]> {
    const results: V2StoredDocument[] = [];
    for (const [address, data] of this.docs) {
      if (!address.startsWith(`${collection}/`)) continue;
      const actual = data[field];
      const matches = operator === 'EQUAL'
        ? actual === value
        : Array.isArray(actual) && actual.includes(value);
      if (matches) results.push({ collection, id: address.slice(collection.length + 1), data });
    }
    return results;
  }

  async commit(_transaction: V2Transaction, writes: readonly V2Write[]): Promise<void> {
    this.commitAttempts += 1;
    this.onBeforeCommit?.(this.commitAttempts);
    for (const write of writes) {
      if (write.kind === 'create') {
        this.set(write.collection, write.id, write.data);
      } else {
        const existing = this.read(write.collection, write.id) ?? {};
        const patch: Record<string, unknown> = {};
        for (const path of write.fieldPaths) patch[path] = write.data[path];
        this.set(write.collection, write.id, { ...existing, ...patch });
      }
    }
    this.committedWrites.push([...writes]);
  }
}

export class MemoryObjectStore implements EvidenceObjectStore {
  readonly objects = new Map<string, number>();
  readonly deleted: string[] = [];
  readonly copied: string[] = [];

  put(key: string, size: number): void {
    this.objects.set(key, size);
  }

  remove(key: string): void {
    this.objects.delete(key);
  }

  async head(key: string) {
    const size = this.objects.get(key);
    return size === undefined ? null : { key: key as never, size };
  }
}

export async function putEvidence(
  store: MemoryV2Store,
  objects: MemoryObjectStore,
  key: string,
  options: { jobId?: string; size?: number; approvalRetainUntil?: string | null } = {}
): Promise<void> {
  const id = await attachmentMetadataDocId(key as never);
  const size = options.size ?? 1024;
  store.set('serviceJobAttachments', id, {
    jobId: options.jobId ?? SERVICE_JOB_ID,
    category: 'report',
    name: 'evidence.jpg',
    path: key,
    contentType: 'image/jpeg',
    size,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    uploadedBy: 'tech-uid',
    deleteAfter: '2026-12-31T00:00:00.000Z',
    retentionStatus: 'active',
    retentionExtensions: 0,
    deletedAt: null,
    metadataKeyVersion: 2,
    approvalRetainUntil: options.approvalRetainUntil ?? null,
  });
  objects.put(key, size);
}

export async function readEvidenceMetadata(store: MemoryV2Store, key: string) {
  return store.read('serviceJobAttachments', await attachmentMetadataDocId(key as never));
}

export async function setDeletionClaimState(
  store: MemoryV2Store,
  key: string,
  state: string
): Promise<void> {
  const id = await attachmentDeletionClaimDocId(key as never);
  store.set('attachmentDeletionClaims', id, {
    canonicalAttachmentKey: key,
    state,
  });
}

// Builds a final report through the real digest function rather than a
// hand-written constant, so the seeded fixture can never drift from what
// parseServiceReportV2/computeServiceReportFinalDigest actually accept.
export async function seedFinalReport(
  store: MemoryV2Store,
  options: {
    reportId: string;
    approvalState: 'pending' | 'approved' | 'rejected';
    evidenceAttachmentIds: string[];
    finalizedByUid?: string;
    now?: string;
    // Identity must be supplied up front, never patched afterwards: the final
    // digest is computed over these fields, so mutating them post-seed would
    // produce a report that fails its own digest verification.
    serviceJobId?: string;
    reportNo?: string;
    // Phase 6R-A.2: a brand-divergent report must be seeded BEFORE the digest
    // is computed, so 'projected report brand disagrees with the authoritative
    // Service Job' stays an isolated case instead of also failing the digest.
    brandId?: string;
  }
): Promise<Record<string, unknown>> {
  const now = options.now ?? '2026-02-01T00:00:00.000Z';
  const serviceJobId = options.serviceJobId ?? SERVICE_JOB_ID;
  const terminal = options.approvalState !== 'pending';
  const report: Record<string, unknown> = {
    schemaVersion: 2,
    reportId: options.reportId,
    serviceJobId,
    reportNo: options.reportNo ?? 'FR-2026-000001',
    brandId: options.brandId ?? BRAND,
    status: 'final',
    activeDraftGeneration: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdByUid: 'tech-uid',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'QA Technician',
    contentRevision: 1,
    updatedAt: now,
    predecessorReportId: null,
    technician: 'QA Technician',
    customerReportedProblem: 'Reported issue',
    inspectionFindings: 'Findings',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: 'Remark',
    resultStatus: 'repaired',
    resultDetail: 'Detail',
    evidenceAttachmentIds: options.evidenceAttachmentIds,
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
    snapshot: {
      trackingReference: serviceJobId,
      customerName: 'QA Customer',
      customerPhone: '0000000000',
      customerEmail: '',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'QA Product',
      modelOrSku: null,
      serialNumber: 'SERIAL-1',
      customerReportedProblem: 'Reported issue',
    },
    finalizedAt: now,
    finalizedByUid: options.finalizedByUid ?? 'tech-uid',
    finalizedByRoleSnapshot: 'technician',
    finalizedByDisplayNameSnapshot: 'QA Technician',
    finalizedFromRevision: 1,
    finalContentDigest: `sha256:v1:${'0'.repeat(64)}`,
    approvalState: options.approvalState,
    currentApprovalEventId: terminal ? options.reportId : null,
    approvalDecidedAt: terminal ? now : null,
  };
  const { computeServiceReportFinalDigest } = await import('../../src/services/serviceReportV2.ts');
  report.finalContentDigest = await computeServiceReportFinalDigest({
    ...report,
    id: options.reportId,
  } as never);
  store.set('serviceReports', options.reportId, report);
  if (options.approvalState === 'rejected') {
    store.set('serviceReportApprovals', options.reportId, {
      decision: 'rejected',
      submissionDigest: report.finalContentDigest,
      eventId: options.reportId,
    });
  }
  return report;
}

export function seedServiceJob(store: MemoryV2Store, brandId: string = BRAND): void {
  store.set('serviceJobs', SERVICE_JOB_ID, {
    brandId,
    customerName: 'QA Customer',
    status: 'Received',
  });
}

export function seedStaffProfile(
  store: MemoryV2Store,
  uid: string,
  overrides: Record<string, unknown> = {}
): void {
  store.set('staffProfiles', uid, {
    brandId: BRAND,
    role: 'approver',
    displayName: 'QA Approver',
    ...overrides,
  });
}
