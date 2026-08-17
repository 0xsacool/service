import {
  ActiveDraftLockInconsistentError,
  finalizeServiceReportTransaction,
  ServiceReportIncompleteError,
  ServiceReportNotFoundError,
  type ServiceReportFinalizationDataAccess,
} from '../src/serviceReportFinalization.ts';
import { TransactionConflictError, type AllocationTransaction } from '../src/serviceJobCreation.ts';
import type { ActiveDraftLock } from '../src/serviceReportCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('Running Service Report finalization regression test');

function makeServiceJob(id: string, brandId: 'bruno-thailand' | 'join-lux-club'): ServiceJob {
  return {
    id,
    serviceRequestNumber: 'SR-2026-000001',
    brandId,
    customerName: 'QA Customer',
    customerPhone: '0000000000',
    customerEmail: '',
    product: 'QA Product',
    productCategory: 'Other',
    serialNumber: 'SERIAL-1',
    issue: 'Reported issue',
    description: 'Description',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: false,
    photos: [],
    accessories: [],
    timeline: [],
    notes: [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
  };
}

function makeDraftReport(overrides: Partial<ServiceReport> = {}): ServiceReport {
  return {
    id: crypto.randomUUID(),
    serviceJobId: 'BRN-2026-000001',
    reportNo: 'FR-2026-000001',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: null,
    technician: 'QA Tech',
    customerReportedProblem: 'Fault reported',
    inspectionFindings: 'Fault reproduced',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
    ...overrides,
  };
}

class FakeStore implements ServiceReportFinalizationDataAccess {
  reports = new Map<string, ServiceReport>();
  locks = new Map<string, ActiveDraftLock>();
  jobs = new Map<string, ServiceJob>();
  conflicts = 0;
  commits = 0;

  async beginTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getServiceReport(_: AllocationTransaction, reportId: string) {
    return this.reports.get(reportId) ?? null;
  }
  async getActiveDraftLock(_: AllocationTransaction, serviceJobId: string) {
    return this.locks.get(serviceJobId) ?? null;
  }
  async getServiceJob(_: AllocationTransaction, id: string) {
    return this.jobs.get(id) ?? null;
  }
  async commitFinalization(
    _: AllocationTransaction,
    input: { serviceJobId: string; finalized: ServiceReport }
  ) {
    if (this.conflicts-- > 0) throw new TransactionConflictError();
    this.reports.set(input.finalized.id, input.finalized);
    this.locks.delete(input.serviceJobId);
    this.commits += 1;
  }
}

// --- happy path ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand'));
  const draft = makeDraftReport();
  store.reports.set(draft.id, draft);
  store.locks.set('BRN-2026-000001', { draftReportId: draft.id });

  const finalized = await finalizeServiceReportTransaction({
    serviceJobId: 'BRN-2026-000001',
    reportId: draft.id,
    dataAccess: store,
    now: () => new Date('2026-01-02T00:00:00.000Z'),
  });

  check(
    'finalize flips status to final and builds the snapshot',
    finalized.status === 'final' &&
      finalized.snapshot !== null &&
      finalized.snapshot.trackingReference === 'BRN-2026-000001' &&
      typeof finalized.finalizedAt === 'string'
  );
  check('the active-draft lock is deleted atomically with the status flip', !store.locks.has('BRN-2026-000001'));
  check('exactly one commit occurred', store.commits === 1);
}

// --- already-final idempotent replay ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000002', makeServiceJob('BRN-2026-000002', 'bruno-thailand'));
  const final = makeDraftReport({
    id: 'already-final-report',
    serviceJobId: 'BRN-2026-000002',
    status: 'final',
    finalizedAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      trackingReference: 'BRN-2026-000002',
      customerName: 'QA Customer',
      customerPhone: '0000000000',
      customerEmail: '',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'QA Product',
      modelOrSku: null,
      serialNumber: 'SERIAL-1',
      customerReportedProblem: 'Fault reported',
    },
  });
  store.reports.set(final.id, final);
  // No lock — a genuinely final report has none, matching real behavior.

  const result = await finalizeServiceReportTransaction({
    serviceJobId: 'BRN-2026-000002',
    reportId: final.id,
    dataAccess: store,
  });
  check(
    'finalizing an already-final report returns it unchanged without a second mutation',
    result.id === final.id && result.status === 'final' && store.commits === 0
  );
}

// --- not found: missing report ---
{
  const store = new FakeStore();
  let notFound = false;
  try {
    await finalizeServiceReportTransaction({
      serviceJobId: 'BRN-2026-000003',
      reportId: 'missing-report',
      dataAccess: store,
    });
  } catch (error) {
    notFound = error instanceof ServiceReportNotFoundError;
  }
  check('finalizing a nonexistent report is rejected as not found', notFound);
}

// --- not found: report belongs to a different Service Job than the URL ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000004', makeServiceJob('BRN-2026-000004', 'bruno-thailand'));
  const draft = makeDraftReport({ id: 'mismatched-report', serviceJobId: 'BRN-2026-000099' });
  store.reports.set(draft.id, draft);
  let notFound = false;
  try {
    await finalizeServiceReportTransaction({
      serviceJobId: 'BRN-2026-000004',
      reportId: draft.id,
      dataAccess: store,
    });
  } catch (error) {
    notFound = error instanceof ServiceReportNotFoundError;
  }
  check(
    'a report belonging to a different Service Job than the URL claims is treated as not found',
    notFound
  );
}

// --- lock inconsistency: missing lock ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000005', makeServiceJob('BRN-2026-000005', 'bruno-thailand'));
  const draft = makeDraftReport({ id: 'no-lock-report', serviceJobId: 'BRN-2026-000005' });
  store.reports.set(draft.id, draft);
  // Deliberately no lock set.
  let inconsistent = false;
  try {
    await finalizeServiceReportTransaction({
      serviceJobId: 'BRN-2026-000005',
      reportId: draft.id,
      dataAccess: store,
    });
  } catch (error) {
    inconsistent = error instanceof ActiveDraftLockInconsistentError;
  }
  check('a draft with no active-draft lock is rejected, not silently repaired', inconsistent);
}

// --- lock inconsistency: lock points at a different report ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000006', makeServiceJob('BRN-2026-000006', 'bruno-thailand'));
  const draft = makeDraftReport({ id: 'real-draft', serviceJobId: 'BRN-2026-000006' });
  store.reports.set(draft.id, draft);
  store.locks.set('BRN-2026-000006', { draftReportId: 'a-different-report-id' });
  let inconsistent = false;
  try {
    await finalizeServiceReportTransaction({
      serviceJobId: 'BRN-2026-000006',
      reportId: draft.id,
      dataAccess: store,
    });
  } catch (error) {
    inconsistent = error instanceof ActiveDraftLockInconsistentError;
  }
  check('a lock pointing at a different report is rejected, never treated as a match', inconsistent);
}

// --- incomplete report fails closed ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000007', makeServiceJob('BRN-2026-000007', 'bruno-thailand'));
  const incomplete = makeDraftReport({
    id: 'incomplete-report',
    serviceJobId: 'BRN-2026-000007',
    customerReportedProblem: '',
    inspectionFindings: '',
    serviceActions: [],
    resultStatus: null,
  });
  store.reports.set(incomplete.id, incomplete);
  store.locks.set('BRN-2026-000007', { draftReportId: incomplete.id });
  let incompleteRejected: Error | null = null;
  try {
    await finalizeServiceReportTransaction({
      serviceJobId: 'BRN-2026-000007',
      reportId: incomplete.id,
      dataAccess: store,
    });
  } catch (error) {
    incompleteRejected = error instanceof Error ? error : null;
  }
  check(
    'an incomplete report is rejected via the reused completeness gate (#034), no commit occurs',
    incompleteRejected instanceof ServiceReportIncompleteError && store.commits === 0
  );
  check(
    'the lock and report remain untouched after a rejected finalize attempt',
    store.locks.has('BRN-2026-000007') && store.reports.get(incomplete.id)?.status === 'draft'
  );
}

// --- transaction conflict retry ---
{
  const store = new FakeStore();
  store.jobs.set('BRN-2026-000008', makeServiceJob('BRN-2026-000008', 'bruno-thailand'));
  const draft = makeDraftReport({ id: 'retry-report', serviceJobId: 'BRN-2026-000008' });
  store.reports.set(draft.id, draft);
  store.locks.set('BRN-2026-000008', { draftReportId: draft.id });
  store.conflicts = 1;

  const finalized = await finalizeServiceReportTransaction({
    serviceJobId: 'BRN-2026-000008',
    reportId: draft.id,
    dataAccess: store,
  });
  check(
    'a transaction conflict is retried and eventually succeeds',
    finalized.status === 'final' && store.commits === 1
  );
}

if (failures) process.exitCode = 1;
