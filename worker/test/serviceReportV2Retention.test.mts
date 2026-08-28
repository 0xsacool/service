import { decideServiceReportV2 } from '../src/serviceReportV2Operations.ts';
import {
  APPROVER_UID,
  BRAND,
  MemoryObjectStore,
  MemoryV2Store,
  SERVICE_JOB_ID,
  evidenceKey,
  putEvidence,
  readEvidenceMetadata,
  seedFinalReport,
  seedServiceJob,
  seedStaffProfile,
} from './serviceReportV2StoreHarness.mts';

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('Running Service Report V2 approval retention regression test');

const KEY_A = evidenceKey('1');

// plusThreeCalendarYears(now) is the deadline the approval transaction derives,
// so an approval at this instant projects to exactly this deadline.
const EARLIER_NOW = '2026-03-01T00:00:00.000Z';
const EARLIER_DEADLINE = '2029-03-01T00:00:00.000Z';
const LATER_NOW = '2026-09-01T00:00:00.000Z';
const LATER_DEADLINE = '2029-09-01T00:00:00.000Z';

async function buildApprovalFixture(options: {
  reportId: string;
  approvalRetainUntil?: string | null;
  store?: MemoryV2Store;
  objects?: MemoryObjectStore;
}) {
  const store = options.store ?? new MemoryV2Store();
  const objects = options.objects ?? new MemoryObjectStore();
  seedServiceJob(store);
  seedStaffProfile(store, APPROVER_UID, { role: 'approver', displayName: 'QA Approver' });
  store.set('brandApprovalPolicies', BRAND, {
    schemaVersion: 1,
    brandId: BRAND,
    allowSelfApproval: true,
    policyVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByUid: 'admin-uid',
  });
  if (!(await readEvidenceMetadata(store, KEY_A))) {
    await putEvidence(store, objects, KEY_A, { approvalRetainUntil: options.approvalRetainUntil ?? null });
  }
  const report = await seedFinalReport(store, {
    reportId: options.reportId,
    approvalState: 'pending',
    evidenceAttachmentIds: [KEY_A],
  });
  return { store, objects, report };
}

function decide(
  fixture: Awaited<ReturnType<typeof buildApprovalFixture>>,
  options: {
    reportId: string;
    decision: 'approved' | 'rejected';
    now: string;
    idempotencyKey: string;
  }
) {
  return decideServiceReportV2({
    store: fixture.store,
    objects: fixture.objects,
    actor: { uid: APPROVER_UID },
    serviceJobId: SERVICE_JOB_ID,
    reportId: options.reportId,
    idempotencyKey: options.idempotencyKey,
    request: {
      contractVersion: 2,
      decision: options.decision,
      rejectionReason: options.decision === 'rejected' ? 'Not acceptable' : null,
      expectedFinalDigest: fixture.report.finalContentDigest as never,
    },
    now: options.now,
  });
}

// 20: a later stored deadline must never move backward
{
  const fixture = await buildApprovalFixture({
    reportId: 'report-later-existing',
    approvalRetainUntil: LATER_DEADLINE,
  });
  await decide(fixture, {
    reportId: 'report-later-existing',
    decision: 'approved',
    now: EARLIER_NOW,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
  });
  const metadata = await readEvidenceMetadata(fixture.store, KEY_A);
  check(
    '20. an approval with an earlier deadline never moves a later one backward',
    metadata?.approvalRetainUntil === LATER_DEADLINE
  );
  const metadataWrites = fixture.store.committedWrites
    .flat()
    .filter((write) => write.collection === 'serviceJobAttachments');
  check('20b. the covered attachment field is not rewritten at all', metadataWrites.length === 0);
  const holds = [...fixture.store.docs.keys()].filter((address) =>
    address.startsWith('attachmentRetentionHolds/')
  );
  check('20c. the immutable hold is still written as source-of-truth history', holds.length === 1);
  const hold = fixture.store.read('attachmentRetentionHolds', holds[0]!.split('/')[1]!);
  check(
    '20d. the hold records this approval own deadline, not the projection',
    hold?.retainUntil === EARLIER_DEADLINE
  );
}

// 21: an earlier stored deadline rises to the new later one
{
  const fixture = await buildApprovalFixture({
    reportId: 'report-earlier-existing',
    approvalRetainUntil: EARLIER_DEADLINE,
  });
  await decide(fixture, {
    reportId: 'report-earlier-existing',
    decision: 'approved',
    now: LATER_NOW,
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
  });
  const metadata = await readEvidenceMetadata(fixture.store, KEY_A);
  check(
    '21. an earlier stored deadline rises to the new later deadline',
    metadata?.approvalRetainUntil === LATER_DEADLINE
  );
}

// 21b: an absent stored deadline takes the candidate
{
  const fixture = await buildApprovalFixture({
    reportId: 'report-null-existing',
    approvalRetainUntil: null,
  });
  await decide(fixture, {
    reportId: 'report-null-existing',
    decision: 'approved',
    now: EARLIER_NOW,
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
  });
  const metadata = await readEvidenceMetadata(fixture.store, KEY_A);
  check(
    '21b. a null stored deadline takes the newly calculated deadline',
    metadata?.approvalRetainUntil === EARLIER_DEADLINE
  );
}

// 22: both orderings of two approvals converge on the maximum
for (const [label, firstNow, secondNow] of [
  ['22a. later-then-earlier', LATER_NOW, EARLIER_NOW],
  ['22b. earlier-then-later', EARLIER_NOW, LATER_NOW],
] as const) {
  const store = new MemoryV2Store();
  const objects = new MemoryObjectStore();
  const first = await buildApprovalFixture({ reportId: 'report-seq-1', store, objects });
  await decide(first, {
    reportId: 'report-seq-1',
    decision: 'approved',
    now: firstNow,
    idempotencyKey: '55555555-5555-4555-8555-555555555555',
  });
  const second = await buildApprovalFixture({ reportId: 'report-seq-2', store, objects });
  await decide(second, {
    reportId: 'report-seq-2',
    decision: 'approved',
    now: secondNow,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
  });
  const metadata = await readEvidenceMetadata(store, KEY_A);
  check(`${label} converges on the maximum deadline`, metadata?.approvalRetainUntil === LATER_DEADLINE);
  const holds = [...store.docs.keys()].filter((address) =>
    address.startsWith('attachmentRetentionHolds/')
  );
  check(`${label} keeps one immutable hold per approval`, holds.length === 2);
}

// 22c: a transaction retry recomputes from transaction state rather than
// reapplying a value captured before the conflict
{
  const store = new MemoryV2Store();
  const objects = new MemoryObjectStore();
  const fixture = await buildApprovalFixture({ reportId: 'report-retry', store, objects });
  let injected = false;
  const originalGet = store.get.bind(store);
  store.get = async (collection, id) => {
    if (collection === 'serviceReportIdempotency' && !injected) {
      injected = true;
      const metadataAddress = [...store.docs.keys()].find((address) =>
        address.startsWith('serviceJobAttachments/')
      )!;
      const existing = store.docs.get(metadataAddress)!;
      store.docs.set(metadataAddress, { ...existing, approvalRetainUntil: LATER_DEADLINE });
    }
    return originalGet(collection, id);
  };
  await decide(fixture, {
    reportId: 'report-retry',
    decision: 'approved',
    now: EARLIER_NOW,
    idempotencyKey: '77777777-7777-4777-8777-777777777777',
  });
  const metadata = await readEvidenceMetadata(store, KEY_A);
  check(
    '22c. a deadline written during the transaction window is still respected',
    metadata?.approvalRetainUntil === LATER_DEADLINE
  );
}

// 23: rejection creates no approval retention extension
{
  const fixture = await buildApprovalFixture({
    reportId: 'report-rejected',
    approvalRetainUntil: null,
  });
  await decide(fixture, {
    reportId: 'report-rejected',
    decision: 'rejected',
    now: EARLIER_NOW,
    idempotencyKey: '88888888-8888-4888-8888-888888888888',
  });
  const metadata = await readEvidenceMetadata(fixture.store, KEY_A);
  check('23. a rejection leaves approvalRetainUntil untouched', metadata?.approvalRetainUntil === null);
  const holds = [...fixture.store.docs.keys()].filter((address) =>
    address.startsWith('attachmentRetentionHolds/')
  );
  check('23b. a rejection writes no retention hold', holds.length === 0);
  const event = fixture.store.read('serviceReportApprovals', 'report-rejected');
  check('23c. the rejection event records a null retain-until', event?.approvedEvidenceRetainUntil === null);
}

// A malformed stored deadline must not pin retention forever
{
  const fixture = await buildApprovalFixture({
    reportId: 'report-malformed',
    approvalRetainUntil: 'not-a-timestamp',
  });
  await decide(fixture, {
    reportId: 'report-malformed',
    decision: 'approved',
    now: EARLIER_NOW,
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
  });
  const metadata = await readEvidenceMetadata(fixture.store, KEY_A);
  check(
    'a malformed stored deadline is repaired by the new deadline',
    metadata?.approvalRetainUntil === EARLIER_DEADLINE
  );
}

if (failures) process.exitCode = 1;
