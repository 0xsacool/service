import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { createServer } from 'vite';

// F5d-66 — approved architecture: Service Report draft creation and
// finalization are Worker-mediated privileged transactions (DECISIONS.md
// #036/#040); updateDraft remains a direct-client Firestore operation,
// unchanged and untested here (already covered by
// test/serviceReportRepository.test.mjs's Mock-repository functional
// suite and the updated source-shape assertions in that same file). This
// file exercises only the new Worker-calling behavior in
// firestoreServiceReportsRepository.ts.
//
// workerTokenProvider.ts's fetchWithWorkerToken() binds globalThis.fetch
// exactly once, at module import time (F5d-55's own fix for Chrome's
// receiver-check — see that file's comment). Reassigning globalThis.fetch
// *after* the module graph has already been imported has no effect on
// that bound reference. A stable dispatcher must therefore be installed on
// globalThis.fetch BEFORE the repository module (and its transitive
// workerTokenProvider.ts import) is ever loaded; each test then swaps the
// mutable currentHandler the dispatcher delegates to, instead of
// reassigning globalThis.fetch itself.
let currentHandler = async () =>
  new Response(JSON.stringify({ error: 'test did not install a fetch handler' }), {
    status: 599,
  });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => currentHandler(input, init);
after(() => {
  globalThis.fetch = originalFetch;
});

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { createFirestoreServiceReportsRepository } = await vite.ssrLoadModule(
  '/src/repositories/firestoreServiceReportsRepository.ts'
);
// Resolved from the same module graph (and therefore the same .env) the
// repository itself uses — never hardcoded, since VITE_FILES_WORKER_URL
// legitimately differs between local dev and this checked-out repo's own
// .env (production Worker origin).
const { getFilesWorkerBaseUrl } = await vite.ssrLoadModule('/src/config/workerUrl.ts');
const WORKER_BASE_URL = getFilesWorkerBaseUrl();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const serviceJob = {
  id: 'BRN-2026-000001',
  brandId: 'bruno-thailand',
  technician: 'Unassigned',
  issue: 'Reported issue',
};

function fakeServiceJobsRepository() {
  return {
    getAll: () => [serviceJob],
    getById: (id) => (id === serviceJob.id ? serviceJob : undefined),
    getByTrackingNumber: () => undefined,
    create: async () => serviceJob,
    update: async () => serviceJob,
  };
}

function fakeTokenProvider(token = 'fake-id-token') {
  return {
    async getIdToken() {
      return token;
    },
  };
}

function draftServiceReport(overrides = {}) {
  return {
    id: 'report-1',
    serviceJobId: serviceJob.id,
    reportNo: 'FR-2026-000001',
    status: 'draft',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    finalizedAt: null,
    technician: 'QA Tech',
    customerReportedProblem: 'Fault reported',
    inspectionFindings: '',
    serviceActions: [],
    parts: [],
    technicianRemark: '',
    resultStatus: null,
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
    ...overrides,
  };
}

afterEach(() => {
  currentHandler = async () =>
    new Response(JSON.stringify({ error: 'test did not install a fetch handler' }), {
      status: 599,
    });
});

test('createDraft POSTs to the Worker with a fresh UUID Idempotency-Key and the intake input, and caches the returned draft', async () => {
  const calls = [];
  currentHandler = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  const created = await repo.createDraft(serviceJob.id, { technician: 'QA Tech' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${WORKER_BASE_URL}/service-jobs/${serviceJob.id}/service-reports`);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers.Authorization, /^Bearer fake-id-token$/);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.match(calls[0].init.headers['Idempotency-Key'], UUID_V4);
  assert.deepEqual(JSON.parse(calls[0].init.body), { input: { technician: 'QA Tech' } });

  assert.equal(created.id, 'report-1');
  assert.equal(created.status, 'draft');
  // Deliberately not asserting via repo.getById() here: it calls
  // subscribeToReport(), which opens a real Firestore onSnapshot listener
  // against this repo's actual configured project (no emulator in this
  // test) with no teardown path — the listener itself fails closed
  // (permission-denied, harmless) but leaves an open handle that can hang
  // process exit when this file runs alongside others. createDraft()'s own
  // return value already proves the cache was populated with the right
  // data; that's sufficient here.
});

test('createDraft surfaces the Worker error message on failure (e.g. active draft already exists)', async () => {
  currentHandler = async () =>
    new Response(JSON.stringify({ error: 'Active draft already exists' }), { status: 409 });

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  await assert.rejects(() => repo.createDraft(serviceJob.id), /Active draft already exists/);
});

test('createDraft fails fast on an unknown Service Job before any Worker call', async () => {
  let called = false;
  currentHandler = async () => {
    called = true;
    return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  await assert.rejects(() => repo.createDraft('missing-service-job'), /no Service Job/);
  assert.equal(called, false);
});

test('finalize resolves the parent Service Job from the just-created draft cache and POSTs to the finalize route', async () => {
  const calls = [];
  currentHandler = async (input, init) => {
    if (String(input).endsWith('/service-reports')) {
      calls.push({ phase: 'create', url: String(input), init });
      return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
    }
    calls.push({ phase: 'finalize', url: String(input), init });
    return new Response(
      JSON.stringify({
        report: draftServiceReport({
          status: 'final',
          finalizedAt: '2026-08-17T01:00:00.000Z',
          snapshot: {
            trackingReference: serviceJob.id,
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
        }),
      }),
      { status: 200 }
    );
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  const draft = await repo.createDraft(serviceJob.id);
  const finalized = await repo.finalize(draft.id);

  const finalizeCall = calls.find((call) => call.phase === 'finalize');
  assert.equal(
    finalizeCall.url,
    `${WORKER_BASE_URL}/service-jobs/${serviceJob.id}/service-reports/${draft.id}/finalize`
  );
  assert.equal(finalizeCall.init.method, 'POST');
  assert.match(finalizeCall.init.headers.Authorization, /^Bearer fake-id-token$/);
  assert.equal(finalized.status, 'final');
  assert.equal(finalized.snapshot.trackingReference, serviceJob.id);
});

test('finalize surfaces the Worker error message on an incomplete-report rejection', async () => {
  currentHandler = async (input) => {
    if (String(input).endsWith('/service-reports')) {
      return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
    }
    return new Response(
      JSON.stringify({ error: 'Service Report is incomplete: Result status is required' }),
      { status: 400 }
    );
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  const draft = await repo.createDraft(serviceJob.id);
  await assert.rejects(() => repo.finalize(draft.id), /Result status is required/);
});

// F5d-66 Phase 2B-R — proves the repository actually uses a caller-supplied
// idempotencyKey (rather than always generating its own), closing the loop
// between serviceReportDraftAttemptKey.ts's controller (unit-tested on its
// own in f5d66ServiceReportDraftAttemptKey.test.mjs) and the real Worker
// request this repository sends.
test('createDraft sends a caller-supplied idempotencyKey verbatim instead of generating its own', async () => {
  const headers = [];
  currentHandler = async (_input, init) => {
    headers.push(init.headers['Idempotency-Key']);
    return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  await repo.createDraft(serviceJob.id, {}, 'caller-owned-fixed-key');
  await repo.createDraft(serviceJob.id, {}, 'caller-owned-fixed-key');

  assert.deepEqual(headers, ['caller-owned-fixed-key', 'caller-owned-fixed-key']);
});

test('createDraft still generates its own key when no idempotencyKey is supplied (backward compatible)', async () => {
  const headers = [];
  currentHandler = async (_input, init) => {
    headers.push(init.headers['Idempotency-Key']);
    return new Response(JSON.stringify({ report: draftServiceReport() }), { status: 201 });
  };

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  await repo.createDraft(serviceJob.id);

  assert.equal(headers.length, 1);
  assert.match(headers[0], UUID_V4);
});

test('a malformed Worker response body is rejected rather than returned as-is', async () => {
  currentHandler = async () =>
    new Response(JSON.stringify({ notAReport: true }), { status: 201 });

  const repo = await createFirestoreServiceReportsRepository(
    fakeServiceJobsRepository(),
    fakeTokenProvider()
  );
  await assert.rejects(() => repo.createDraft(serviceJob.id), /malformed Service Report/);
});
