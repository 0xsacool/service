import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { SERVICE_ACTIONS, RESULT_STATUSES } = await vite.ssrLoadModule(
  '/src/types/serviceReport.ts'
);
const { fromFirestoreData: loadReportFromFirestore, toFirestoreFields } =
  await vite.ssrLoadModule('/src/repositories/firestore/serviceReportMapping.ts');
const {
  formatServiceReportNumber,
  getServiceReportFinalizationErrors,
  isValidServiceReport,
  orderServiceReports,
  parseServiceReportNumber,
} = await vite.ssrLoadModule('/src/services/serviceReport.ts');
const { serviceReportsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceReportsRepository.ts'
);
const { serviceJobsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceJobsRepository.ts'
);
const { mockServiceJobs } = await vite.ssrLoadModule(
  '/src/repositories/mockData/serviceJobs.mock.ts'
);

function makeServiceJob() {
  const source = mockServiceJobs[0];
  const id = `SR-REPORT-${crypto.randomUUID()}`;
  return {
    ...source,
    id,
    timeline: [...source.timeline],
    notes: [...source.notes],
    photos: [...source.photos],
  };
}

async function createJob() {
  const job = makeServiceJob();
  await serviceJobsRepository.create(job);
  return job;
}

function completeReportInput(overrides = {}) {
  return {
    customerReportedProblem: 'Customer reported a recurring fault',
    inspectionFindings: 'Inspection completed and fault reproduced',
    serviceActions: ['repair'],
    resultStatus: 'repaired',
    ...overrides,
  };
}

test('Service Report constants use explicit typed actions and result statuses', () => {
  assert.deepEqual(SERVICE_ACTIONS, [
    'repair',
    'replace-part',
    'replace-product',
    'claim-factory',
    'return-to-customer',
  ]);
  assert.deepEqual(RESULT_STATUSES, [
    'repaired',
    'awaiting-part',
    'sent-for-claim',
    'replaced',
    'returned',
    'unable-to-repair',
  ]);
});

test('report numbers follow the approved FR year/sequence format', () => {
  assert.equal(formatServiceReportNumber(2026, 1), 'FR-2026-000001');
  assert.deepEqual(parseServiceReportNumber('FR-2026-000042'), {
    year: 2026,
    sequence: 42,
  });
  assert.equal(parseServiceReportNumber('SR-2026-000042'), null);
});

test('draft creation references an existing Service Job and starts without a snapshot', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(job.id);

  assert.equal(draft.serviceJobId, job.id);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.snapshot, null);
  assert.equal(draft.finalizedAt, null);
  assert.equal(draft.customerReportedProblem, job.issue);
  assert.equal(isValidServiceReport(draft), true);
});

test('only one active draft is allowed while multiple finalized reports remain supported', async () => {
  const job = await createJob();
  const first = await serviceReportsRepository.createDraft(job.id, completeReportInput());
  await assert.rejects(
    () => serviceReportsRepository.createDraft(job.id),
    /already has an active draft/
  );
  const firstFinal = await serviceReportsRepository.finalize(first.id);
  const second = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput()
  );
  const secondFinal = await serviceReportsRepository.finalize(second.id);

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.reportNo, second.reportNo);
  assert.equal(firstFinal.status, 'final');
  assert.equal(secondFinal.status, 'final');
  assert.match(first.reportNo, /^FR-\d{4}-\d{6}$/);
  assert.match(second.reportNo, /^FR-\d{4}-\d{6}$/);
  assert.equal(serviceReportsRepository.getById(first.id)?.id, first.id);
});

test('listForServiceJob returns all reports in deterministic report order', async () => {
  const job = await createJob();
  const first = await serviceReportsRepository.createDraft(job.id, completeReportInput());
  await serviceReportsRepository.finalize(first.id);
  const second = await serviceReportsRepository.createDraft(job.id);
  const reports = serviceReportsRepository.listForServiceJob(job.id);

  assert.deepEqual(
    reports.map((report) => report.id),
    [first.id, second.id]
  );
  assert.deepEqual(
    orderServiceReports([...reports]).map((report) => report.reportNo),
    reports.map((report) => report.reportNo)
  );
  assert.deepEqual(serviceReportsRepository.listForServiceJob('missing-service-job'), []);
});

test('draft updates validate parts, allow multiple actions, and retain evidence IDs only', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(job.id);
  const updated = await serviceReportsRepository.updateDraft(draft.id, {
    serviceActions: ['repair', 'replace-part'],
    parts: [
      {
        description: 'Display assembly',
        partNo: 'PART-1',
        quantity: 1,
        remark: 'Genuine replacement',
      },
    ],
    evidenceAttachmentIds: ['attachment-id-1', 'attachment-id-2'],
    resultStatus: 'repaired',
  });

  assert.deepEqual(updated.serviceActions, ['repair', 'replace-part']);
  assert.equal(updated.parts[0].quantity, 1);
  assert.deepEqual(updated.evidenceAttachmentIds, ['attachment-id-1', 'attachment-id-2']);
  assert.equal('path' in updated, false);
  assert.equal('publicTrackingTokenHash' in updated, false);
  await assert.rejects(
    () =>
      serviceReportsRepository.updateDraft(draft.id, {
        parts: [{ description: 'invalid', partNo: null, quantity: 0, remark: '' }],
      }),
    /parts are malformed/
  );
});

test('finalization creates an immutable snapshot and trusted final timestamp', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput({ customerReportedProblem: 'Initial customer complaint' })
  );
  const finalized = await serviceReportsRepository.finalize(draft.id);

  assert.equal(finalized.status, 'final');
  assert.equal(typeof finalized.finalizedAt, 'string');
  assert.equal(finalized.snapshot?.trackingReference, job.id);
  assert.equal(finalized.snapshot?.brandCode, 'BRN');
  assert.equal(finalized.snapshot?.brandName, 'Bruno Thailand');
  assert.equal(finalized.snapshot?.customerReportedProblem, 'Initial customer complaint');
  assert.equal('brandId' in finalized.snapshot, false);
  assert.equal('publicTrackingTokenHash' in finalized, false);
  assert.equal('path' in finalized, false);
  await assert.rejects(
    () =>
      serviceReportsRepository.updateDraft(draft.id, { technicianRemark: 'late edit' }),
    /immutable/
  );
  await assert.rejects(
    () => serviceReportsRepository.finalize(draft.id),
    /already final/
  );
});

test('a later report does not mutate an earlier finalized report snapshot', async () => {
  const job = await createJob();
  const first = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput({
      customerReportedProblem: 'First complaint',
      resultStatus: 'unable-to-repair',
    })
  );
  const firstFinal = await serviceReportsRepository.finalize(first.id);
  const firstSnapshot = structuredClone(firstFinal.snapshot);

  await serviceJobsRepository.update(job.id, {
    technician: 'Second Technician',
    issue: 'Second complaint',
  });
  const second = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput({
      customerReportedProblem: 'Second complaint',
      resultStatus: 'replaced',
    })
  );
  const secondFinal = await serviceReportsRepository.finalize(second.id);

  assert.deepEqual(serviceReportsRepository.getById(first.id)?.snapshot, firstSnapshot);
  assert.equal(secondFinal.snapshot?.customerReportedProblem, 'Second complaint');
  assert.notEqual(firstFinal.id, secondFinal.id);
});

test('incomplete drafts remain saveable but finalization fails closed on business-critical gaps', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(job.id);
  const saved = await serviceReportsRepository.updateDraft(draft.id, {
    technicianRemark: 'Still gathering findings',
  });

  assert.equal(saved.status, 'draft');
  assert.deepEqual(getServiceReportFinalizationErrors(saved), [
    'Technical inspection findings are required',
    'At least one service action is required',
    'Result status is required',
  ]);
  await assert.rejects(
    () => serviceReportsRepository.finalize(draft.id),
    /Service Report is incomplete/
  );
});

test('finalization accepts optional fields as absent and rejects malformed part content', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput({
      claimNo: null,
      factoryReference: null,
      evidenceAttachmentIds: [],
      technicianRemark: '',
      parts: [{ description: '', partNo: null, quantity: 1, remark: '' }],
    })
  );
  assert.deepEqual(getServiceReportFinalizationErrors(draft), [
    'Each part requires a description, remark, and positive whole-number quantity',
  ]);
  await assert.rejects(
    () => serviceReportsRepository.finalize(draft.id),
    /description, remark, and positive whole-number quantity/
  );

  const corrected = await serviceReportsRepository.updateDraft(draft.id, {
    parts: [],
  });
  const finalized = await serviceReportsRepository.finalize(corrected.id);
  assert.equal(finalized.status, 'final');
});

test('full local V1 workflow is deterministic from draft through history', async () => {
  const job = await createJob();
  assert.deepEqual(serviceReportsRepository.listForServiceJob(job.id), []);

  const draft = await serviceReportsRepository.createDraft(job.id);
  const incompleteSave = await serviceReportsRepository.updateDraft(draft.id, {
    technicianRemark: 'Saved before final completion',
  });
  assert.equal(incompleteSave.status, 'draft');

  const reopened = serviceReportsRepository.getById(draft.id);
  assert.equal(reopened?.technicianRemark, 'Saved before final completion');
  const completed = await serviceReportsRepository.updateDraft(
    draft.id,
    completeReportInput({ customerReportedProblem: 'First workflow complaint' })
  );
  const firstFinal = await serviceReportsRepository.finalize(completed.id);
  assert.equal(firstFinal.status, 'final');

  const secondDraft = await serviceReportsRepository.createDraft(
    job.id,
    completeReportInput({ customerReportedProblem: 'Second workflow complaint' })
  );
  const secondFinal = await serviceReportsRepository.finalize(secondDraft.id);
  const history = serviceReportsRepository.listForServiceJob(job.id);

  assert.deepEqual(
    history.map((report) => report.reportNo),
    [firstFinal.reportNo, secondFinal.reportNo]
  );
  assert.equal(history[0].snapshot?.customerReportedProblem, 'First workflow complaint');
  assert.equal(history[1].snapshot?.customerReportedProblem, 'Second workflow complaint');
});

test('malformed persisted reports fail safely in the mapping', async () => {
  const job = await createJob();
  const draft = await serviceReportsRepository.createDraft(job.id);
  const fields = toFirestoreFields(draft);
  assert.equal(loadReportFromFirestore(draft.id, fields)?.id, draft.id);
  assert.equal(
    loadReportFromFirestore(draft.id, { ...fields, serviceJobId: 'other-job' }, job.id),
    null
  );
  assert.equal(loadReportFromFirestore(draft.id, { ...fields, status: 'final' }), null);
  assert.equal(
    loadReportFromFirestore(draft.id, { ...fields, parts: [{ quantity: 0 }] }),
    null
  );
});

test('missing Service Jobs fail safely before report creation', async () => {
  await assert.rejects(
    () => serviceReportsRepository.createDraft('missing-service-job'),
    /no Service Job/
  );
  await assert.rejects(
    () => serviceReportsRepository.finalize('missing-report'),
    /no report exists/
  );
});

test('Firestore repository uses report IDs, service-job queries, and server timestamps', async () => {
  const source = await readFile(
    new URL('../src/repositories/firestoreServiceReportsRepository.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /SERVICE_REPORTS_COLLECTION, reportId/);
  assert.match(source, /where\('serviceJobId', '==', serviceJobId\)/);
  assert.match(source, /createdAt: serverTimestamp\(\)/);
  assert.match(source, /updatedAt: serverTimestamp\(\)/);
  assert.match(source, /finalizedAt: serverTimestamp\(\)/);
  assert.match(source, /numberSequences/);
  assert.match(source, /getDocs\(/);
  assert.match(source, /already has an active draft/);
});
