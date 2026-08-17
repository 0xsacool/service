import {
  ActiveDraftExistsError,
  allocateServiceReportDraft,
  IdempotencyKeyJobMismatchError,
  isValidReportId,
  parseServiceReportDraftInput,
  parseServiceReportDraftRequest,
  ServiceJobMissingError,
  type ActiveDraftLock,
  type ServiceReportCreationDataAccess,
} from '../src/serviceReportCreation.ts';
import { TransactionConflictError, type AllocationTransaction } from '../src/serviceJobCreation.ts';
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

console.log('Running Service Report draft-creation regression test');

// --- parseServiceReportDraftInput / parseServiceReportDraftRequest ---

check(
  'an empty draft input is accepted',
  parseServiceReportDraftInput({}) !== null
);
check(
  'an unknown field is rejected (allowlist, not blacklist)',
  parseServiceReportDraftInput({ status: 'final' }) === null
);
check(
  'a valid partial patch is accepted',
  parseServiceReportDraftInput({ technician: 'QA Tech', resultStatus: 'repaired' }) !== null
);
check(
  'an invalid enum value is rejected',
  parseServiceReportDraftInput({ resultStatus: 'not-a-status' }) === null
);
check(
  'an oversized text field is rejected',
  parseServiceReportDraftInput({ technicianRemark: 'x'.repeat(5000) }) === null
);
check(
  'a malformed part row is rejected',
  parseServiceReportDraftInput({
    parts: [{ description: '', partNo: null, quantity: 0, remark: '' }],
  }) === null
);
check(
  'a valid part row is accepted',
  parseServiceReportDraftInput({
    parts: [{ description: 'Display', partNo: null, quantity: 1, remark: 'Genuine' }],
  }) !== null
);
check('null claimNo/factoryReference are accepted', (() => {
  const parsed = parseServiceReportDraftInput({ claimNo: null, factoryReference: null });
  return parsed !== null && parsed.claimNo === null && parsed.factoryReference === null;
})());

check(
  'a request body with no input key is accepted as empty input',
  (() => {
    const parsed = parseServiceReportDraftRequest({});
    return parsed !== null && Object.keys(parsed).length === 0;
  })()
);
check(
  'a request body with an input sub-object is accepted',
  parseServiceReportDraftRequest({ input: { technician: 'QA' } }) !== null
);
check(
  'a request body with an unexpected extra key is rejected',
  parseServiceReportDraftRequest({ input: {}, extra: true }) === null
);
check(
  'a non-object request body is rejected',
  parseServiceReportDraftRequest('not-an-object') === null
);

// --- isValidReportId ---

check(
  'a v4 UUID is a valid report id',
  isValidReportId('11111111-1111-4111-8111-111111111111')
);
check('a malformed string is not a valid report id', !isValidReportId('not-a-uuid'));

// --- allocateServiceReportDraft ---

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

class FakeStore implements ServiceReportCreationDataAccess {
  reports = new Map<string, ServiceReport>();
  draftKeys = new Map<string, string>();
  locks = new Map<string, ActiveDraftLock>();
  sequences = new Map<string, number>();
  jobs = new Map<string, ServiceJob>();
  conflicts = 0;
  writes = 0;

  async beginTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getDraftKey(_: AllocationTransaction, key: string) {
    return this.draftKeys.get(key) ?? null;
  }
  async getServiceReport(_: AllocationTransaction, reportId: string) {
    return this.reports.get(reportId) ?? null;
  }
  async getActiveDraftLock(_: AllocationTransaction, serviceJobId: string) {
    return this.locks.get(serviceJobId) ?? null;
  }
  async getSequence(
    _: AllocationTransaction,
    brandId: 'bruno-thailand' | 'join-lux-club',
    __: 'tracking_number' | 'service_request' | 'repair_report',
    year: number
  ) {
    return this.sequences.get(`${brandId}__${year}`) ?? null;
  }
  async getServiceJob(_: AllocationTransaction, id: string) {
    return this.jobs.get(id) ?? null;
  }
  async commitDraftCreation(
    _: AllocationTransaction,
    input: {
      key: string;
      report: ServiceReport;
      brandId: 'bruno-thailand' | 'join-lux-club';
      sequence: number;
      year: number;
    }
  ) {
    if (this.conflicts-- > 0) throw new TransactionConflictError();
    if (
      this.reports.has(input.report.id) ||
      this.draftKeys.has(input.key) ||
      this.locks.has(input.report.serviceJobId)
    )
      throw new TransactionConflictError();
    this.reports.set(input.report.id, input.report);
    this.draftKeys.set(input.key, input.report.id);
    this.locks.set(input.report.serviceJobId, { draftReportId: input.report.id });
    this.sequences.set(`${input.brandId}__${input.year}`, input.sequence);
    this.writes += 1;
  }
}

const store = new FakeStore();
store.jobs.set('BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand'));

const first = await allocateServiceReportDraft({
  serviceJobId: 'BRN-2026-000001',
  brandId: 'bruno-thailand',
  key: '11111111-1111-4111-8111-111111111111',
  input: {},
  dataAccess: store,
  now: () => new Date('2025-12-31T17:00:00.000Z'), // 2026-01-01 Bangkok
});
check(
  'the first draft allocates FR-{Bangkok year}-000001 and defaults from the Service Job',
  first.reportNo === 'FR-2026-000001' &&
    first.serviceJobId === 'BRN-2026-000001' &&
    first.status === 'draft' &&
    first.snapshot === null &&
    first.customerReportedProblem === 'Reported issue'
);
check('the active-draft lock is created atomically with the draft', store.locks.has('BRN-2026-000001'));

const replay = await allocateServiceReportDraft({
  serviceJobId: 'BRN-2026-000001',
  brandId: 'bruno-thailand',
  key: '11111111-1111-4111-8111-111111111111',
  input: {},
  dataAccess: store,
});
check(
  'idempotent replay returns the canonical draft without advancing the sequence or writing again',
  replay.id === first.id && store.writes === 1
);

let activeDraftRejected = false;
try {
  await allocateServiceReportDraft({
    serviceJobId: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    key: '22222222-2222-4222-8222-222222222222',
    input: {},
    dataAccess: store,
  });
} catch (error) {
  activeDraftRejected = error instanceof ActiveDraftExistsError;
}
check(
  'a second create-draft attempt for the same Service Job is rejected (one active draft, #033)',
  activeDraftRejected && store.writes === 1
);

let missingJobRejected = false;
try {
  await allocateServiceReportDraft({
    serviceJobId: 'JLC-2026-000001',
    brandId: 'join-lux-club',
    key: '33333333-3333-4333-8333-333333333333',
    input: {},
    dataAccess: store,
  });
} catch (error) {
  missingJobRejected = error instanceof ServiceJobMissingError;
}
check('allocation against a nonexistent Service Job is rejected', missingJobRejected);

store.jobs.set('JLC-2026-000002', makeServiceJob('JLC-2026-000002', 'join-lux-club'));
store.conflicts = 1;
const afterConflict = await allocateServiceReportDraft({
  serviceJobId: 'JLC-2026-000002',
  brandId: 'join-lux-club',
  key: '44444444-4444-4444-8444-444444444444',
  input: { technician: 'Second Job Tech' },
  dataAccess: store,
});
check(
  'a transaction conflict is retried without a partial write, and a different Service Job gets its own independent sequence',
  afterConflict.reportNo === 'FR-2026-000001' &&
    afterConflict.serviceJobId === 'JLC-2026-000002' &&
    store.writes === 2
);

// F5d-66 Phase 2B-R2 — a replay key is bound to the Service Job it was
// originally issued for, never merely globally unique by key. `first`'s
// key ('11111111-...') is already mapped to its draft under
// BRN-2026-000001; attempting to "replay" it against an unrelated
// Service Job must be rejected before any write, not silently return
// BRN-2026-000001's draft content under BRN-2026-000099's identity.
store.jobs.set('BRN-2026-000099', makeServiceJob('BRN-2026-000099', 'bruno-thailand'));
const writesBeforeMismatch = store.writes;
let jobMismatchRejected = false;
try {
  await allocateServiceReportDraft({
    serviceJobId: 'BRN-2026-000099',
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111', // first's key, belongs to BRN-2026-000001
    input: {},
    dataAccess: store,
  });
} catch (error) {
  jobMismatchRejected = error instanceof IdempotencyKeyJobMismatchError;
}
check(
  'a key already bound to one Service Job cannot be replayed to allocate/return a draft for a different Service Job',
  jobMismatchRejected && store.writes === writesBeforeMismatch
);
check(
  'the original job\'s draft is completely unaffected by the rejected cross-job replay attempt',
  store.reports.get(first.id)?.serviceJobId === 'BRN-2026-000001'
);

// F5d-66 Phase 2C-R — dangling idempotency record. The closest realistic
// malformed/missing-canonical state this data-access abstraction can
// represent: getDraftKey() resolves to a reportId, but getServiceReport()
// for that id returns null. At this abstraction layer, "malformed
// document" and "missing document" are indistinguishable — both surface
// as null (parseServiceReportDocument() already collapses a
// present-but-invalid Firestore document to null before this code ever
// sees it — see the real-firestoreClient variant of this scenario in
// serviceReportAllocatorCommit.test.mts). In production this is only
// reachable through genuine data corruption or manual tampering (the
// Worker's own atomic :commit always writes the key and the report
// together), but the code must still fail closed rather than allocate a
// fresh report under an already-claimed key, or worse, fall through and
// return an unrelated report.
{
  const danglingStore = new FakeStore();
  danglingStore.jobs.set('BRN-2026-000060', makeServiceJob('BRN-2026-000060', 'bruno-thailand'));
  // An unrelated, perfectly real draft already exists — proves a dangling
  // lookup can never accidentally fall through and return someone else's
  // report instead of failing closed.
  const unrelatedJob = makeServiceJob('BRN-2026-000061', 'bruno-thailand');
  danglingStore.jobs.set('BRN-2026-000061', unrelatedJob);
  const unrelated = await allocateServiceReportDraft({
    serviceJobId: 'BRN-2026-000061',
    brandId: 'bruno-thailand',
    key: '88888888-8888-4888-8888-888888888888',
    input: {},
    dataAccess: danglingStore,
  });
  danglingStore.draftKeys.set('99999999-9999-4999-8999-999999999999', 'dangling-report-id');
  const reportsBefore = danglingStore.reports.size;
  const locksBefore = danglingStore.locks.size;
  const sequencesBefore = new Map(danglingStore.sequences);
  const draftKeysBefore = danglingStore.draftKeys.size;
  const writesBeforeDangling = danglingStore.writes;

  let danglingRejected = false;
  let danglingMessage = '';
  let danglingReturnedReport: ServiceReport | undefined;
  try {
    danglingReturnedReport = await allocateServiceReportDraft({
      serviceJobId: 'BRN-2026-000060',
      brandId: 'bruno-thailand',
      key: '99999999-9999-4999-8999-999999999999',
      input: {},
      dataAccess: danglingStore,
    });
  } catch (error) {
    danglingRejected = true;
    danglingMessage = error instanceof Error ? error.message : '';
  }
  check(
    'a dangling idempotency key (resolves to no canonical Service Report) fails closed, not allocates fresh',
    danglingRejected &&
      danglingReturnedReport === undefined &&
      /no canonical Service Report/i.test(danglingMessage)
  );
  check(
    'the dangling-key rejection never returns the unrelated real draft that already exists',
    danglingReturnedReport === undefined
  );
  check(
    'no report, lock, sequence, or idempotency-key mutation occurs on a dangling-key rejection',
    danglingStore.reports.size === reportsBefore &&
      danglingStore.locks.size === locksBefore &&
      danglingStore.draftKeys.size === draftKeysBefore &&
      danglingStore.writes === writesBeforeDangling &&
      [...danglingStore.sequences.entries()].every(
        ([key, value]) => sequencesBefore.get(key) === value
      )
  );
  check(
    'the unrelated draft (for a different Service Job) remains completely unaffected',
    danglingStore.reports.get(unrelated.id)?.serviceJobId === 'BRN-2026-000061'
  );
}

if (failures) process.exitCode = 1;
