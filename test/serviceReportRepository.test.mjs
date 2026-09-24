import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import ts from 'typescript';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { SERVICE_ACTIONS, RESULT_STATUSES } = await vite.ssrLoadModule(
  '/src/types/serviceReport.ts'
);
const { fromFirestoreData: loadReportFromFirestore, toFirestoreFields } =
  await vite.ssrLoadModule('/src/repositories/firestore/serviceReportMapping.ts');
const {
  compareOrdinal,
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

test('Firestore repository delegates create/finalize/history and draft saves to the Worker', async () => {
  const source = await readFile(
    new URL('../src/repositories/firestoreServiceReportsRepository.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /SERVICE_REPORTS_COLLECTION, reportId/);
  assert.match(source, /createWorkerServiceReportHistoryRepository/);
  assert.match(source, /fetchHistoryForServiceJob\(serviceJobId, signal\)/);
  assert.equal(source.includes("where('serviceJobId', '==', serviceJobId)"), false);
  assert.equal(source.includes('collection(getFirestoreDb(), SERVICE_REPORTS_COLLECTION)'), false);
  assert.equal(source.includes('fetchWithWorkerToken'), true);
  assert.equal(source.includes('/service-reports'), true);
  assert.equal(source.includes('/finalize'), true);
  assert.equal(source.includes('Idempotency-Key'), true);
  // Sequence allocation, the active-draft query, and the direct
  // creation/finalization writes are gone from this file — they now live
  // only in worker/src/serviceReportCreation.ts and
  // serviceReportFinalization.ts.
  assert.equal(source.includes('numberSequences'), false);
  assert.equal(source.includes('getDocs('), false);
  assert.equal(source.includes('already has an active draft'), false);
  assert.match(source, /legacy-draft-save/);
  assert.match(source, /expectedUpdatedAt: existing.updatedAt/);
  assert.match(source, /contractVersion: 2, expectedContentRevision, patch: normalizedPatch/);
  assert.doesNotMatch(source, /runTransaction|transaction\.update|serverTimestamp/);
  assert.equal(source.includes('createdAt: serverTimestamp()'), false);
  assert.equal(source.includes('finalizedAt: serverTimestamp()'), false);
});

async function draftSaveHarness(storedReport, respond) {
  const source = await readFile(
    new URL('../src/repositories/firestoreServiceReportsRepository.ts', import.meta.url), 'utf8'
  );
  const requests = [];
  const tokenProvider = { getIdToken: async () => 'local-test-token' };
  const { fetchWithWorkerToken } = await vite.ssrLoadModule('/src/auth/workerTokenProvider.ts');
  const modules = {
    'firebase/firestore': {
      doc: (_db, collection, id) => ({ collection, id }),
      getDocFromServer: async () => ({
        exists: () => true, id: storedReport.id,
        data: () => storedReport.schemaVersion === 2
          ? Object.fromEntries(Object.entries(storedReport).filter(([key]) => key !== 'id'))
          : toFirestoreFields(storedReport),
      }),
      onSnapshot: () => {},
    },
    '../lib/firebase/firebase': { getFirestoreDb: () => ({}) },
    '../auth/workerTokenProvider': {
      fetchWithWorkerToken: (provider, url, init) => {
        assert.equal(provider, tokenProvider);
        return fetchWithWorkerToken(provider, url, init, {
          fetch: async (input, options) => {
            requests.push({ url: input, ...options, body: JSON.parse(options.body) });
            return respond(requests.length);
          },
        });
      },
    },
    '../config/workerUrl': { getFilesWorkerBaseUrl: () => 'https://worker.invalid' },
    './workerServiceReportReadRepository': { createWorkerServiceReportHistoryRepository: () => ({}) },
    './firestoreInitDiagnostics': {},
  };
  for (const path of ['../services/serviceReport', '../services/serviceReportV2', './types', './firestore/serviceReportMapping']) {
    modules[path] = await vite.ssrLoadModule(`/src/repositories/${path}.ts`);
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  }, exports);
  const repository = await exports.createFirestoreServiceReportsRepository(
    { getById: () => ({ id: storedReport.serviceJobId }) }, tokenProvider
  );
  return { repository, requests };
}

async function browserDraft(version) {
  const job = await createJob();
  const v1 = await serviceReportsRepository.createDraft(job.id);
  if (version === 1) return v1;
  return {
    ...v1, schemaVersion: 2, reportId: v1.id, brandId: 'bruno-thailand',
    activeDraftGeneration: 1, contentRevision: 3, predecessorReportId: null,
    warrantyOutcome: 'undetermined',
    createdByUid: 'test-technician', createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: null, finalizedByUid: null,
    finalizedByRoleSnapshot: null, finalizedByDisplayNameSnapshot: null,
    finalizedFromRevision: null, finalContentDigest: null,
    approvalState: 'not-submitted', currentApprovalEventId: null, approvalDecidedAt: null,
  };
}

for (const version of [1, 2]) {
  const save = (repository, report, patch) => version === 1
    ? repository.updateDraft(report.id, patch)
    : repository.updateDraftV2(report.id, report.contentRevision, patch);

  test(`V${version} browser draft save sends authenticated Worker contract and caches returned revision`, async () => {
    const report = await browserDraft(version);
    const patch = {
      technicianRemark: 'Updated findings',
      evidenceAttachmentIds: [version === 1 ? 'attachment-1' : `service-jobs/${report.serviceJobId}/report/photo.jpg`],
    };
    const updated = {
      ...report, ...patch, updatedAt: '2026-09-24T01:00:00.000Z',
      ...(version === 2 ? { contentRevision: 4 } : {}),
    };
    const { repository, requests } = await draftSaveHarness(report, () => Response.json({
      ok: true, data: { report: updated }, replayed: false,
    }));
    assert.deepEqual(await save(repository, report, patch), updated);
    assert.deepEqual(repository.getById(report.id), updated);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `https://worker.invalid/service-jobs/${encodeURIComponent(report.serviceJobId)}/service-reports/${encodeURIComponent(report.id)}/${version === 1 ? 'legacy-draft-save' : 'draft-save'}`);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers.Authorization, 'Bearer local-test-token');
    assert.equal(requests[0].headers['Content-Type'], 'application/json');
    assert.match(requests[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
    assert.deepEqual(requests[0].body, {
      contractVersion: version, patch,
      ...(version === 1 ? { expectedUpdatedAt: report.updatedAt } : { expectedContentRevision: 3 }),
    });
  });

  test(`V${version} browser draft errors preserve Worker semantics without Firestore fallback`, async () => {
    const report = await browserDraft(version);
    for (const status of [400, 403, 409, 412, 503]) {
      const error = { code: 'save_denied', message: 'Save denied', retryClass: 'reload' };
      const { repository, requests } = await draftSaveHarness(report, () => Response.json(
        { ok: false, error }, { status }
      ));
      await assert.rejects(save(repository, report, { technicianRemark: 'edit' }), (failure) => {
        assert.equal(failure.status, status);
        assert.equal(failure.code, error.code);
        assert.equal(failure.retryClass, error.retryClass);
        assert.equal(failure.message, error.message);
        return true;
      });
      assert.equal(requests.length, 1);
      assert.equal(repository.getById(report.id), undefined);
    }
    const networkError = new Error('Network unavailable');
    const { repository, requests } = await draftSaveHarness(report, () => { throw networkError; });
    await assert.rejects(save(repository, report, { technicianRemark: 'edit' }), (error) => error === networkError);
    assert.equal(requests.length, 1);
  });

  test(`V${version} authorization retry keeps the same draft-save body and idempotency key`, async () => {
    const report = await browserDraft(version);
    const { repository, requests } = await draftSaveHarness(report, (attempt) => attempt === 1
      ? Response.json({}, { status: 401 })
      : Response.json({ ok: true, data: { report }, replayed: true }));
    await save(repository, report, { technicianRemark: 'edit' });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
  });
}

test('browser draft validation and stale V2 revisions fail before any Worker request', async () => {
  for (const version of [1, 2]) {
    const report = await browserDraft(version);
    const { repository, requests } = await draftSaveHarness(report, () => assert.fail('Unexpected request'));
    await assert.rejects(version === 1
      ? repository.updateDraft(report.id, { parts: [{ quantity: 0 }] })
      : repository.updateDraftV2(report.id, 3, { evidenceAttachmentIds: ['invalid'] }));
    if (version === 2) {
      await assert.rejects(repository.updateDraftV2(report.id, 2, { technicianRemark: 'edit' }),
        (error) => error.status === 412 && error.code === 'stale_revision' && error.retryClass === 'reload');
    }
    assert.equal(requests.length, 0);
  }
});

test('D24 ordinal comparator is code-unit based, not locale-collated', () => {
  // The pairs where a locale collator and code-unit order genuinely disagree.
  assert.ok(compareOrdinal('Z', 'a') < 0, 'uppercase sorts before lowercase');
  assert.ok('Z'.localeCompare('a') > 0, 'a collator would disagree — that is the point');
  assert.ok(compareOrdinal('_', 'a') < 0);
  assert.ok(compareOrdinal('ab', 'abc') < 0, 'a prefix sorts before its extension');
  assert.equal(compareOrdinal('same', 'same'), 0);
  assert.ok(compareOrdinal('FR-2026-000002', 'FR-2026-000010') < 0);
  // Zero-padded report numbers must order numerically as a side effect of
  // fixed-width ordinal comparison.
  assert.ok(compareOrdinal('FR-2026-000009', 'FR-2026-000010') < 0);
});

test('D24 documentary order is createdAt, then reportNo, then reportId', () => {
  const report = (id, createdAt, reportNo) => ({ id, createdAt, reportNo });
  const ordered = orderServiceReports([
    report('r-3', '2026-01-02T00:00:00.000Z', 'FR-2026-000001'),
    report('r-2', '2026-01-01T00:00:00.000Z', 'FR-2026-000010'),
    report('r-1', '2026-01-01T00:00:00.000Z', 'FR-2026-000002'),
    report('r-0', '2026-01-01T00:00:00.000Z', 'FR-2026-000002'),
  ]);
  assert.deepEqual(ordered.map((entry) => entry.id), ['r-0', 'r-1', 'r-2', 'r-3']);
});

test('D24 ordering is stable, total, and never mutates its input', () => {
  const input = [
    { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', reportNo: 'FR-2026-000001' },
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', reportNo: 'FR-2026-000001' },
  ];
  const snapshot = input.map((entry) => entry.id);
  const first = orderServiceReports(input).map((entry) => entry.id);
  const second = orderServiceReports(input).map((entry) => entry.id);
  assert.deepEqual(first, ['a', 'b'], 'a full tie falls through to reportId');
  assert.deepEqual(first, second, 'ordering is reproducible across calls');
  assert.deepEqual(input.map((entry) => entry.id), snapshot, 'input is not mutated');
  assert.deepEqual(orderServiceReports([]), []);
});
