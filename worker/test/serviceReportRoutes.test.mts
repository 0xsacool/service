import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Service Report route regression test');

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

interface FakeState {
  profile: { uid: string; brandId: 'bruno-thailand' | 'join-lux-club' } | null;
  jobs: Map<string, ServiceJob>;
  reports: Map<string, ServiceReport>;
  draftKeys: Map<string, string>;
  locks: Map<string, { draftReportId: string }>;
  sequences: Map<string, number>;
}

function createHandler(state: FakeState) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token === 'invalid-token') throw new Error('invalid');
        return { uid: 'staff-uid-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          if (!state.profile || state.profile.uid !== uid) return null;
          return { uid, brandId: state.profile.brandId };
        },
        async getServiceJobAuthorization(jobId: string) {
          const job = state.jobs.get(jobId);
          return job ? { id: jobId, brandId: job.brandId } : null;
        },
        async beginTransaction() {
          return { id: crypto.randomUUID() };
        },
        async getDraftKey(_: unknown, key: string) {
          return state.draftKeys.get(key) ?? null;
        },
        async getServiceReport(_: unknown, reportId: string) {
          return state.reports.get(reportId) ?? null;
        },
        async getActiveDraftLock(_: unknown, serviceJobId: string) {
          return state.locks.get(serviceJobId) ?? null;
        },
        async getSequence(_: unknown, brandId: string, __: string, year: number) {
          return state.sequences.get(`${brandId}__${year}`) ?? null;
        },
        async getServiceJob(_: unknown, id: string) {
          return state.jobs.get(id) ?? null;
        },
        async commitDraftCreation(
          _: unknown,
          input: {
            key: string;
            report: ServiceReport;
            brandId: string;
            sequence: number;
            year: number;
          }
        ) {
          state.reports.set(input.report.id, input.report);
          state.draftKeys.set(input.key, input.report.id);
          state.locks.set(input.report.serviceJobId, { draftReportId: input.report.id });
          state.sequences.set(`${input.brandId}__${input.year}`, input.sequence);
        },
        async commitFinalization(
          _: unknown,
          input: { serviceJobId: string; finalized: ServiceReport }
        ) {
          state.reports.set(input.finalized.id, input.finalized);
          state.locks.delete(input.serviceJobId);
        },
      }) as unknown as FirestoreClient,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  return { handler: createWorkerHandler(dependencies), env };
}

function authHeaders(token = 'valid-token'): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// --- unauthenticated / unauthorized ---
{
  const { handler, env } = createHandler({
    profile: null,
    jobs: new Map(),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  });
  const noAuth = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    }),
    env
  );
  check('create-draft with no Authorization header is 401', noAuth.status === 401);

  const badToken = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: { ...authHeaders('invalid-token'), 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    }),
    env
  );
  // authorizeStaffCreation() (reused unchanged from POST /service-jobs)
  // returns 403 on a verification failure, not 401 — matching its existing
  // behavior, not a new convention introduced here.
  check(
    'create-draft with an invalid token is 403 (matches authorizeStaffCreation existing behavior)',
    badToken.status === 403
  );
}

// --- brand mismatch ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'join-lux-club' },
    jobs: new Map([['BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    }),
    env
  );
  check('create-draft for a Service Job outside the staff brand is 403', response.status === 403);
}

// --- invalid idempotency key ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([['BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': 'not-a-uuid' },
    }),
    env
  );
  check('create-draft with a malformed idempotency key is 400', response.status === 400);
}

// --- successful create then finalize ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([['BRN-2026-000001', makeServiceJob('BRN-2026-000001', 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);

  const createResponse = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
      },
      body: JSON.stringify({
        input: {
          customerReportedProblem: 'Fault reported',
          inspectionFindings: 'Fault reproduced',
          serviceActions: ['repair'],
          resultStatus: 'repaired',
        },
      }),
    }),
    env
  );
  check('create-draft with a valid body succeeds with 201', createResponse.status === 201);
  const createBody = (await createResponse.json()) as { report: ServiceReport };
  check(
    'the created draft is returned with a real FR number and draft status',
    createBody.report.status === 'draft' && /^FR-\d{4}-\d{6}$/.test(createBody.report.reportNo)
  );

  const duplicateCreate = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
      },
      body: '{}',
    }),
    env
  );
  check('a second create-draft attempt (different key) is 409 — active draft exists', duplicateCreate.status === 409);

  const finalizeResponse = await handler.fetch(
    new Request(
      `http://worker.test/service-jobs/BRN-2026-000001/service-reports/${createBody.report.id}/finalize`,
      { method: 'POST', headers: authHeaders() }
    ),
    env
  );
  check('finalize on a complete draft succeeds with 200', finalizeResponse.status === 200);
  const finalizeBody = (await finalizeResponse.json()) as { report: ServiceReport };
  check(
    'the finalized report has status final and a snapshot',
    finalizeBody.report.status === 'final' && finalizeBody.report.snapshot !== null
  );

  const secondFinalize = await handler.fetch(
    new Request(
      `http://worker.test/service-jobs/BRN-2026-000001/service-reports/${createBody.report.id}/finalize`,
      { method: 'POST', headers: authHeaders() }
    ),
    env
  );
  check(
    'finalizing an already-final report is idempotently 200, not an error',
    secondFinalize.status === 200
  );
}

// --- incomplete finalization fails closed with 400 ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([['BRN-2026-000002', makeServiceJob('BRN-2026-000002', 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const createResponse = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000002/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': '33333333-3333-4333-8333-333333333333' },
    }),
    env
  );
  const created = (await createResponse.json()) as { report: ServiceReport };
  const finalizeResponse = await handler.fetch(
    new Request(
      `http://worker.test/service-jobs/BRN-2026-000002/service-reports/${created.report.id}/finalize`,
      { method: 'POST', headers: authHeaders() }
    ),
    env
  );
  check('finalizing an incomplete draft is 400', finalizeResponse.status === 400);
}

// --- invalid jobId / reportId formats ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map(),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const badJobId = await handler.fetch(
    new Request('http://worker.test/service-jobs/bad%20id!/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    }),
    env
  );
  check('a jobId with characters outside the safe segment charset is rejected with 400', badJobId.status === 400);

  const badReportId = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/service-reports/not-a-uuid/finalize', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('an unsafe reportId is rejected with 400', badReportId.status === 400);
}

// --- Service Job creation route is unaffected by the new prefix route ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map(),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs', { method: 'GET' }),
    env
  );
  check(
    'GET /service-jobs (no matching route/method) still falls through to 404, not swallowed by the new prefix',
    response.status === 404
  );
}

// --- F5d-66 Phase 2B-R2: a replay key is bound to its originating Service
// Job, never merely globally unique by key ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([
      ['BRN-2026-000010', makeServiceJob('BRN-2026-000010', 'bruno-thailand')],
      ['BRN-2026-000011', makeServiceJob('BRN-2026-000011', 'bruno-thailand')],
    ]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const sharedKey = '55555555-5555-4555-8555-555555555555';

  const jobACreate = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000010/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': sharedKey },
    }),
    env
  );
  check('create-draft for Job A with a fresh key succeeds', jobACreate.status === 201);
  const jobAReport = (await jobACreate.json()) as { report: ServiceReport };

  const jobBReplay = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000011/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': sharedKey },
    }),
    env
  );
  check(
    "Job A's key cannot be replayed through Job B's create-draft endpoint/path — rejected with 409, not Job A's draft",
    jobBReplay.status === 409
  );
  check(
    'Job B never received an active-draft lock or report from the rejected cross-job replay',
    !state.locks.has('BRN-2026-000011') &&
      ![...state.reports.values()].some((report) => report.serviceJobId === 'BRN-2026-000011')
  );
  check(
    "Job A's own draft is completely unaffected by the rejected cross-job replay attempt",
    state.reports.get(jobAReport.report.id)?.serviceJobId === 'BRN-2026-000010'
  );
}

// --- F5d-66 Phase 2B-R2: a legitimate same-job retry after a lost
// response still replays the canonical draft, not a fresh allocation or
// a 409 ---
{
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([['BRN-2026-000012', makeServiceJob('BRN-2026-000012', 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state);
  const key = '66666666-6666-4666-8666-666666666666';

  const first = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000012/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': key },
    }),
    env
  );
  const firstBody = (await first.json()) as { report: ServiceReport };

  // Simulates the client never seeing the first response (network drop)
  // and retrying with the same Idempotency-Key it correctly retained.
  const retry = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000012/service-reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': key },
    }),
    env
  );
  check('a same-job retry with the retained key succeeds (not 409)', retry.status === 201);
  const retryBody = (await retry.json()) as { report: ServiceReport };
  check(
    'the retry returns exactly the same canonical draft, not a second allocation',
    retryBody.report.id === firstBody.report.id &&
      retryBody.report.reportNo === firstBody.report.reportNo
  );
}

if (failures) process.exitCode = 1;
