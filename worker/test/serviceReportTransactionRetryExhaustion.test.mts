import {
  allocateServiceReportDraft,
  type ActiveDraftLock,
  type ServiceReportCreationDataAccess,
} from '../src/serviceReportCreation.ts';
import {
  finalizeServiceReportTransaction,
  type ServiceReportFinalizationDataAccess,
} from '../src/serviceReportFinalization.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from '../src/serviceJobCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';

// F5d-66 Phase 2C-R — mirrors allocatorTransactionRetryExhaustion.test.mts's
// A/B/C structure (single retry, last-possible-attempt success, genuine
// exhaustion) for both Service Report transactions the Worker performs.
// Unlike the Service Job allocator, neither operation wraps its Firestore
// calls in allocatorDiagnostics.ts's runAllocatorStage()/
// logAllocatorStageFailure() — that sanitized-logging layer was never built
// for Service Reports, so there is no equivalent diagnostic-log assertion
// here (not an omission introduced by this test; it reflects what the
// source actually does). What this file proves instead: retries stop at
// exactly MAX_TRANSACTION_RETRIES, every attempt begins a genuinely fresh
// transaction (never reuses a prior attempt's transaction id), no success
// is ever fabricated, and the original TransactionConflictError propagates
// unwrapped on exhaustion.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Service Report transaction retry-exhaustion regression test');

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

function makeCompleteDraftReport(overrides: Partial<ServiceReport> = {}): ServiceReport {
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

// ===========================================================================
// Create-draft exhaustion
// ===========================================================================

class DraftExhaustionStore implements ServiceReportCreationDataAccess {
  beginTransactionIds: string[] = [];
  commitTransactionIds: string[] = [];
  commitAttempts = 0;
  committed = false;
  jobs = new Map<string, ServiceJob>();
  readonly conflictsBeforeSuccess: number;

  constructor(conflictsBeforeSuccess: number) {
    this.conflictsBeforeSuccess = conflictsBeforeSuccess;
    this.jobs.set('BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand'));
  }
  async beginTransaction(): Promise<AllocationTransaction> {
    const id = `txn-draft-${this.beginTransactionIds.length + 1}`;
    this.beginTransactionIds.push(id);
    return { id };
  }
  async getDraftKey(): Promise<string | null> {
    return null;
  }
  async getServiceReport(): Promise<ServiceReport | null> {
    return null;
  }
  async getActiveDraftLock(): Promise<ActiveDraftLock | null> {
    return null;
  }
  async getSequence(): Promise<number | null> {
    return 0;
  }
  async getServiceJob(_: AllocationTransaction, id: string): Promise<ServiceJob | null> {
    return this.jobs.get(id) ?? null;
  }
  async commitDraftCreation(transaction: AllocationTransaction): Promise<void> {
    this.commitTransactionIds.push(transaction.id);
    this.commitAttempts += 1;
    if (this.commitAttempts <= this.conflictsBeforeSuccess) {
      throw new TransactionConflictError();
    }
    this.committed = true;
  }
}

function runDraftAllocation(store: DraftExhaustionStore, key: string) {
  return allocateServiceReportDraft({
    serviceJobId: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    key,
    input: {},
    dataAccess: store,
    now: () => new Date('2026-08-17T10:00:00.000Z'),
  });
}

// --- A: one conflict, then success ---
{
  const store = new DraftExhaustionStore(1);
  let report: ServiceReport | undefined;
  let threw = false;
  try {
    report = await runDraftAllocation(store, '11111111-1111-4111-8111-111111111111');
  } catch {
    threw = true;
  }
  check(
    'draft-create A: succeeds after exactly one retried conflict',
    !threw && report !== undefined && store.commitAttempts === 2 && store.committed
  );
  check(
    'draft-create A: two distinct transactions were begun, one per attempt',
    store.beginTransactionIds.length === 2 &&
      store.beginTransactionIds[0] !== store.beginTransactionIds[1]
  );
  check(
    'draft-create A: each commit attempt used the transaction begun for that same attempt, never a stale one',
    JSON.stringify(store.commitTransactionIds) === JSON.stringify(store.beginTransactionIds)
  );
}

// --- B: conflicts up to the last allowed attempt, then succeeds ---
{
  check(
    'sanity: MAX_TRANSACTION_RETRIES leaves room for multiple conflicts before exhaustion',
    MAX_TRANSACTION_RETRIES > 2
  );
  const store = new DraftExhaustionStore(MAX_TRANSACTION_RETRIES - 1);
  let report: ServiceReport | undefined;
  let threw = false;
  try {
    report = await runDraftAllocation(store, '22222222-2222-4222-8222-222222222222');
  } catch {
    threw = true;
  }
  check(
    'draft-create B: succeeds on the final allowed attempt after repeated conflicts',
    !threw &&
      report !== undefined &&
      store.commitAttempts === MAX_TRANSACTION_RETRIES &&
      store.committed
  );
  check(
    'draft-create B: exactly MAX_TRANSACTION_RETRIES distinct transactions were begun, no more',
    store.beginTransactionIds.length === MAX_TRANSACTION_RETRIES &&
      new Set(store.beginTransactionIds).size === MAX_TRANSACTION_RETRIES
  );
}

// --- C: every attempt conflicts (genuine exhaustion) ---
{
  const store = new DraftExhaustionStore(MAX_TRANSACTION_RETRIES); // never succeeds
  let threw = false;
  let caughtError: unknown;
  try {
    await runDraftAllocation(store, '33333333-3333-4333-8333-333333333333');
  } catch (error) {
    threw = true;
    caughtError = error;
  }
  check('draft-create C: allocation rejects once every retry is exhausted', threw);
  check(
    'draft-create C: the rejection is the ORIGINAL TransactionConflictError, never wrapped/replaced',
    caughtError instanceof TransactionConflictError
  );
  check(
    'draft-create C: exactly MAX_TRANSACTION_RETRIES commit attempts occurred, no more',
    store.commitAttempts === MAX_TRANSACTION_RETRIES
  );
  check(
    'draft-create C: no extra transaction was begun beyond the retry limit (no (N+1)th attempt)',
    store.beginTransactionIds.length === MAX_TRANSACTION_RETRIES
  );
  check(
    'draft-create C: every attempt used a genuinely distinct transaction, never reused',
    new Set(store.beginTransactionIds).size === MAX_TRANSACTION_RETRIES
  );
  check(
    'draft-create C: zero partial writes — commitDraftCreation never recorded a successful commit',
    !store.committed
  );
}

// ===========================================================================
// Finalize exhaustion
// ===========================================================================

class FinalizeExhaustionStore implements ServiceReportFinalizationDataAccess {
  beginTransactionIds: string[] = [];
  commitTransactionIds: string[] = [];
  commitAttempts = 0;
  committed = false;
  readonly conflictsBeforeSuccess: number;
  readonly report: ServiceReport;
  readonly lock: ActiveDraftLock;
  readonly job: ServiceJob;

  constructor(conflictsBeforeSuccess: number) {
    this.conflictsBeforeSuccess = conflictsBeforeSuccess;
    this.report = makeCompleteDraftReport();
    this.lock = { draftReportId: this.report.id };
    this.job = makeServiceJob('BRN-2026-000001', 'bruno-thailand');
  }
  async beginTransaction(): Promise<AllocationTransaction> {
    const id = `txn-finalize-${this.beginTransactionIds.length + 1}`;
    this.beginTransactionIds.push(id);
    return { id };
  }
  async getServiceReport(): Promise<ServiceReport | null> {
    // Never actually mutated by a failed commit attempt — status stays
    // 'draft' across retries, matching the real Firestore transaction
    // model where a rejected :commit changes nothing.
    return this.report;
  }
  async getActiveDraftLock(): Promise<ActiveDraftLock | null> {
    return this.lock;
  }
  async getServiceJob(): Promise<ServiceJob | null> {
    return this.job;
  }
  async commitFinalization(transaction: AllocationTransaction): Promise<void> {
    this.commitTransactionIds.push(transaction.id);
    this.commitAttempts += 1;
    if (this.commitAttempts <= this.conflictsBeforeSuccess) {
      throw new TransactionConflictError();
    }
    this.committed = true;
  }
}

function runFinalize(store: FinalizeExhaustionStore) {
  return finalizeServiceReportTransaction({
    serviceJobId: 'BRN-2026-000001',
    reportId: store.report.id,
    dataAccess: store,
    now: () => new Date('2026-08-17T11:00:00.000Z'),
  });
}

// --- A: one conflict, then success ---
{
  const store = new FinalizeExhaustionStore(1);
  let finalized: ServiceReport | undefined;
  let threw = false;
  try {
    finalized = await runFinalize(store);
  } catch {
    threw = true;
  }
  check(
    'finalize A: succeeds after exactly one retried conflict',
    !threw &&
      finalized !== undefined &&
      finalized.status === 'final' &&
      store.commitAttempts === 2 &&
      store.committed
  );
  check(
    'finalize A: two distinct transactions were begun, one per attempt',
    store.beginTransactionIds.length === 2 &&
      store.beginTransactionIds[0] !== store.beginTransactionIds[1]
  );
  check(
    'finalize A: each commit attempt used the transaction begun for that same attempt',
    JSON.stringify(store.commitTransactionIds) === JSON.stringify(store.beginTransactionIds)
  );
}

// --- B: conflicts up to the last allowed attempt, then succeeds ---
{
  const store = new FinalizeExhaustionStore(MAX_TRANSACTION_RETRIES - 1);
  let finalized: ServiceReport | undefined;
  let threw = false;
  try {
    finalized = await runFinalize(store);
  } catch {
    threw = true;
  }
  check(
    'finalize B: succeeds on the final allowed attempt after repeated conflicts',
    !threw &&
      finalized !== undefined &&
      finalized.status === 'final' &&
      store.commitAttempts === MAX_TRANSACTION_RETRIES &&
      store.committed
  );
  check(
    'finalize B: exactly MAX_TRANSACTION_RETRIES distinct transactions were begun, no more',
    store.beginTransactionIds.length === MAX_TRANSACTION_RETRIES &&
      new Set(store.beginTransactionIds).size === MAX_TRANSACTION_RETRIES
  );
}

// --- C: every attempt conflicts (genuine exhaustion) ---
{
  const store = new FinalizeExhaustionStore(MAX_TRANSACTION_RETRIES); // never succeeds
  let threw = false;
  let caughtError: unknown;
  try {
    await runFinalize(store);
  } catch (error) {
    threw = true;
    caughtError = error;
  }
  check('finalize C: finalize rejects once every retry is exhausted', threw);
  check(
    'finalize C: the rejection is the ORIGINAL TransactionConflictError, never wrapped/replaced',
    caughtError instanceof TransactionConflictError
  );
  check(
    'finalize C: exactly MAX_TRANSACTION_RETRIES commit attempts occurred, no more',
    store.commitAttempts === MAX_TRANSACTION_RETRIES
  );
  check(
    'finalize C: no extra transaction was begun beyond the retry limit',
    store.beginTransactionIds.length === MAX_TRANSACTION_RETRIES
  );
  check(
    'finalize C: every attempt used a genuinely distinct transaction, never reused',
    new Set(store.beginTransactionIds).size === MAX_TRANSACTION_RETRIES
  );
  check(
    'finalize C: zero partial writes — commitFinalization never recorded a successful commit, and the report/lock were never actually mutated',
    !store.committed && store.report.status === 'draft'
  );
}

if (failures) process.exitCode = 1;
