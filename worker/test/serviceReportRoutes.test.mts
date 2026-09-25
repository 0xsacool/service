import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type { ActiveDraftLock } from '../src/serviceReportCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { CanonicalAttachmentKey } from '../../src/types/attachment.ts';
import { attachmentMetadataDocId } from '../../src/services/attachmentIdentity.ts';
import { createServiceReportDraft } from '../../src/services/serviceReport.ts';
import { MemoryV2Store } from './serviceReportV2StoreHarness.mts';
import type { DeletionObjectStore } from '../src/attachmentDeletionCoordinatorV2.ts';

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
  locks: Map<string, ActiveDraftLock>;
  sequences: Map<string, number>;
}

function createHandler(
  state: FakeState,
  options: {
    mode?: Env['SERVICE_REPORT_V2_MODE'];
    v2Store?: MemoryV2Store;
    objects?: DeletionObjectStore;
  } = {}
) {
  const v2Store = options.v2Store;
  const objects = options.objects;
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
          const lock = state.locks.get(serviceJobId);
          if (!lock) return null;
          if (lock.slotVersion === 1) {
            return {
              ...lock,
              draftReportId: lock.state === 'active' ? String(lock.activeReportId) : '',
            };
          }
          return lock;
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
            activeDraftSlot: ActiveDraftLock;
            activeDraftSlotExists: boolean;
          }
        ) {
          state.reports.set(input.report.id, input.report);
          state.draftKeys.set(input.key, input.report.id);
          state.locks.set(input.report.serviceJobId, input.activeDraftSlot);
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
    ...(v2Store ? { createServiceReportV2Store: () => v2Store } : {}),
    ...(objects ? { createEvidenceObjectStore: () => objects } : {}),
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    ...(options.mode ? { SERVICE_REPORT_V2_MODE: options.mode } : {}),
  };
  return { handler: createWorkerHandler(dependencies), env };
}

function authHeaders(token = 'valid-token'): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function createMemoryEvidenceObjects(): DeletionObjectStore & {
  objects: Map<CanonicalAttachmentKey, number>;
} {
  const objects = new Map<CanonicalAttachmentKey, number>();
  return {
    objects,
    async head(key) {
      const size = objects.get(key);
      return size === undefined ? null : { key, size };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

async function seedEvidence(
  store: MemoryV2Store,
  objects: ReturnType<typeof createMemoryEvidenceObjects>,
  key: CanonicalAttachmentKey,
  serviceJobId: string,
  size = 1024,
  includeObject = true
): Promise<void> {
  store.set('serviceJobAttachments', await attachmentMetadataDocId(key), {
    jobId: serviceJobId,
    category: 'report',
    name: 'evidence.jpg',
    path: key,
    contentType: 'image/jpeg',
    size,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    uploadedBy: 'staff-uid-1',
    deleteAfter: '2026-12-31T00:00:00.000Z',
    retentionStatus: 'active',
    retentionExtensions: 0,
    deletedAt: null,
    metadataKeyVersion: 2,
    approvalRetainUntil: null,
  });
  if (includeObject) objects.objects.set(key, size);
}

function createLegacySaveFixture(jobId: string, suffix: string) {
  const serviceJob = makeServiceJob(jobId, 'bruno-thailand');
  const report = createServiceReportDraft(
    `00000000-0000-4000-8000-0000000000${suffix}`,
    `FR-2026-${suffix.padStart(6, '0')}`,
    serviceJob,
    {},
    new Date('2026-03-01T00:00:00.000Z')
  );
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([[jobId, serviceJob]]),
    reports: new Map([[report.id, report]]),
    draftKeys: new Map(),
    locks: new Map([[jobId, { draftReportId: report.id }]]),
    sequences: new Map(),
  };
  const store = new MemoryV2Store();
  store.set('serviceJobs', jobId, { ...serviceJob });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Technician',
  });
  const reportData = { ...report } as unknown as Record<string, unknown>;
  delete reportData.id;
  store.set('serviceReports', report.id, reportData);
  return { serviceJob, report, state, store };
}

function legacySaveRequest(
  jobId: string,
  reportId: string,
  idempotencyKey: string,
  expectedUpdatedAt: string,
  patch: Record<string, unknown>
): Request {
  return new Request(
    `http://worker.test/service-jobs/${jobId}/service-reports/${reportId}/legacy-draft-save`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ contractVersion: 1, expectedUpdatedAt, patch }),
    }
  );
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
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: '{}',
      }
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
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: '{}',
      }
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
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: '{}',
      }
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

// --- RRC-2A: the compatibility mode retains the checked-in V1 wire contract ---
{
  const jobId = 'BRN-2026-000013';
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([[jobId, makeServiceJob(jobId, 'bruno-thailand')]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const { handler, env } = createHandler(state, { mode: 'compatibility' });
  const create = await handler.fetch(
    new Request(`http://worker.test/service-jobs/${jobId}/service-reports`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Idempotency-Key': '77777777-7777-4777-8777-777777777777',
      },
      body: JSON.stringify({
        input: {
          customerReportedProblem: 'V1 issue',
          inspectionFindings: 'Fault reproduced',
          serviceActions: ['repair'],
          resultStatus: 'repaired',
        },
      }),
    }),
    env
  );
  const created = (await create.json()) as { report: ServiceReport };
  check('compatibility mode routes the legacy { input } create to V1', create.status === 201 && !('schemaVersion' in created.report));

  const finalized = await handler.fetch(
    new Request(`http://worker.test/service-jobs/${jobId}/service-reports/${created.report.id}/finalize`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env
  );
  const finalizedBody = (await finalized.json()) as { report: ServiceReport };
  check('compatibility mode routes the legacy {} finalize to V1 finalization, not approval',
    finalized.status === 200 && finalizedBody.report.status === 'final' && !('approvalState' in finalizedBody.report));
}

// --- RRC-2A: V1 draft-save Worker route is available only outside v2-active ---
for (const mode of ['disabled', 'compatibility'] as const) {
  const jobId = mode === 'disabled' ? 'BRN-2026-000014' : 'BRN-2026-000015';
  const serviceJob = makeServiceJob(jobId, 'bruno-thailand');
  const report = createServiceReportDraft(
    `00000000-0000-4000-8000-0000000000${mode === 'disabled' ? '14' : '15'}`,
    'FR-2026-000001',
    serviceJob,
    {},
    new Date('2026-03-01T00:00:00.000Z')
  );
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([[jobId, serviceJob]]),
    reports: new Map([[report.id, report]]),
    draftKeys: new Map(),
    locks: new Map([[jobId, { draftReportId: report.id }]]),
    sequences: new Map(),
  };
  const store = new MemoryV2Store();
  store.set('serviceJobs', jobId, { ...serviceJob });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Technician',
  });
  const reportData = { ...report } as unknown as Record<string, unknown>;
  delete reportData.id;
  store.set('serviceReports', report.id, reportData);
  const { handler, env } = createHandler(state, { mode, v2Store: store });
  const path = `http://worker.test/service-jobs/${jobId}/service-reports/${report.id}/legacy-draft-save`;
  const request = (key: string, expectedUpdatedAt: string, patch: Record<string, unknown>) =>
    new Request(path, {
      method: 'POST',
      headers: {
        ...authHeaders(), 'Content-Type': 'application/json', 'Idempotency-Key': key,
      },
      body: JSON.stringify({ contractVersion: 1, expectedUpdatedAt, patch }),
    });
  const key = mode === 'disabled'
    ? '88888888-8888-4888-8888-888888888888'
    : '99999999-9999-4999-8999-999999999999';
  const rollbackAttemptsBeforeSave = store.rollbackAttempts.length;
  const first = await handler.fetch(request(key, report.updatedAt, { technicianRemark: 'Saved through Worker' }), env);
  const firstBody = await first.json() as { replayed: boolean; data: { report: ServiceReport } };
  check(`${mode} mode routes V1 draft-save through the Worker with a revision check and does not roll back a committed transaction`,
    first.status === 200 && firstBody.data.report.technicianRemark === 'Saved through Worker' &&
    store.rollbackAttempts.length === rollbackAttemptsBeforeSave);
  const writesAfterSave = store.committedWrites.length;

  const rollbackAttemptsBeforeStale = store.rollbackAttempts.length;
  store.rollbackFailure = new Error('synthetic V1 rollback failure');
  const stale = await handler.fetch(request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', report.updatedAt, { technicianRemark: 'Stale' }), env);
  store.rollbackFailure = null;
  check(`${mode} mode rejects a stale V1 draft timestamp and preserves 412 when rollback fails`,
    stale.status === 412 && store.rollbackAttempts.length === rollbackAttemptsBeforeStale + 1);

  const rollbackAttemptsBeforeReplay = store.rollbackAttempts.length;
  const successfulRollbacksBeforeReplay = store.rolledBackTransactionIds.length;
  const replay = await handler.fetch(request(key, report.updatedAt, { technicianRemark: 'Saved through Worker' }), env);
  const replayBody = await replay.json() as { replayed: boolean };
  check(`${mode} mode replays the same V1 save and rolls back the read-only transaction`,
    replay.status === 200 && replayBody.replayed &&
    store.rollbackAttempts.length === rollbackAttemptsBeforeReplay + 1 &&
    store.rolledBackTransactionIds.length === successfulRollbacksBeforeReplay + 1);

  const conflict = await handler.fetch(request(key, report.updatedAt, { technicianRemark: 'Conflicting payload' }), env);
  check(`${mode} mode rejects a conflicting V1 save idempotency key`, conflict.status === 409);

  const deniedReplayHasNoReport = async (label: string) => {
    const response = await handler.fetch(
      request(key, report.updatedAt, { technicianRemark: 'Saved through Worker' }), env
    );
    const body = await response.json() as { data?: { report?: unknown }; report?: unknown };
    check(label, response.status === 403 && body.data?.report === undefined &&
      body.report === undefined && store.committedWrites.length === writesAfterSave);
  };

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'join-lux-club', role: 'technician', displayName: 'QA Technician',
  });
  await deniedReplayHasNoReport(`${mode} mode denies V1 same-key replay after brand authorization changes`);

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'customer', displayName: 'QA Technician',
  });
  await deniedReplayHasNoReport(`${mode} mode denies V1 same-key replay after staff role removal`);

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'invalid-brand', role: 'technician', displayName: 'QA Technician',
  });
  await deniedReplayHasNoReport(`${mode} mode denies V1 same-key replay with a malformed profile`);

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Technician',
  });
  const authorizedReplay = await handler.fetch(
    request(key, report.updatedAt, { technicianRemark: 'Saved through Worker' }), env
  );
  const authorizedReplayBody = await authorizedReplay.json() as { replayed: boolean };
  check(`${mode} mode still replays the same V1 save for an authorized actor`,
    authorizedReplay.status === 200 && authorizedReplayBody.replayed &&
    store.committedWrites.length === writesAfterSave);
}

// --- RRC-2A follow-up: V1 saves validate the entire resulting evidence list ---
{
  const jobId = 'BRN-2026-000016';
  const { report, state, store } = createLegacySaveFixture(jobId, '16');
  const objects = createMemoryEvidenceObjects();
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const malformedKey = 'not-a-canonical-attachment-key';
  const malformed = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a1111111-1111-4111-8111-111111111111', report.updatedAt,
      { evidenceAttachmentIds: [malformedKey] }
    ),
    env
  );
  const malformedText = await malformed.text();
  check('V1 save rejects a noncanonical evidence ID without report or idempotency writes',
    malformed.status === 422 && store.committedWrites.length === 0 &&
    store.read('serviceReports', report.id)?.evidenceAttachmentIds instanceof Array &&
    (store.read('serviceReports', report.id)?.evidenceAttachmentIds as string[]).length === 0 &&
    !malformedText.includes(malformedKey));
}

{
  const jobId = 'BRN-2026-000017';
  const otherJobId = 'BRN-2026-000099';
  const { report, state, store } = createLegacySaveFixture(jobId, '17');
  const objects = createMemoryEvidenceObjects();
  const foreignKey = `service-jobs/${otherJobId}/report/foreign-evidence.jpg`;
  await seedEvidence(store, objects, foreignKey, otherJobId);
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const foreign = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a2222222-2222-4222-8222-222222222222', report.updatedAt,
      { evidenceAttachmentIds: [foreignKey] }
    ),
    env
  );
  const foreignText = await foreign.text();
  check('V1 save rejects canonical evidence owned by another Service Job without writes',
    foreign.status === 403 && store.committedWrites.length === 0 &&
    !foreignText.includes(foreignKey));
}

{
  const jobId = 'BRN-2026-000021';
  const otherJobId = 'BRN-2026-000099';
  const { report, state, store } = createLegacySaveFixture(jobId, '21');
  const objects = createMemoryEvidenceObjects();
  const mismatchedKey = `service-jobs/${otherJobId}/report/metadata-claims-current-job.jpg`;
  await seedEvidence(store, objects, mismatchedKey, jobId);
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const response = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', report.updatedAt,
      { evidenceAttachmentIds: [mismatchedKey] }
    ),
    env
  );
  const responseText = await response.text();
  check('V1 save rejects a foreign-job canonical path even when metadata claims the current owner',
    response.status === 403 && store.committedWrites.length === 0 &&
    !responseText.includes(mismatchedKey));
}

{
  const jobId = 'BRN-2026-000018';
  const { report, state, store } = createLegacySaveFixture(jobId, '18');
  const objects = createMemoryEvidenceObjects();
  const missingMetadataKey = `service-jobs/${jobId}/report/missing-metadata.jpg`;
  await seedEvidence(store, objects, missingMetadataKey, jobId, 1024, false);
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const missingObject = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a3333333-3333-4333-8333-333333333333', report.updatedAt,
      { evidenceAttachmentIds: [missingMetadataKey] }
    ),
    env
  );
  check('V1 save rejects evidence with valid metadata but missing object bytes without writes',
    missingObject.status === 409 && store.committedWrites.length === 0);

  const missingKey = `service-jobs/${jobId}/report/missing-record.jpg`;
  const missingMetadata = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a4444444-4444-4444-8444-444444444444', report.updatedAt,
      { evidenceAttachmentIds: [missingKey] }
    ),
    env
  );
  check('V1 save rejects evidence with missing metadata without writes',
    missingMetadata.status === 409 && store.committedWrites.length === 0);
}

{
  const jobId = 'BRN-2026-000019';
  const { report, state, store } = createLegacySaveFixture(jobId, '19');
  const objects = createMemoryEvidenceObjects();
  const evidenceKey = `service-jobs/${jobId}/report/valid-evidence.jpg`;
  await seedEvidence(store, objects, evidenceKey, jobId);
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const first = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a5555555-5555-4555-8555-555555555555', report.updatedAt,
      { evidenceAttachmentIds: [evidenceKey] }
    ),
    env
  );
  const firstBody = await first.json() as {
    data?: { report?: ServiceReport };
  };
  const firstReport = firstBody.data?.report;
  check('V1 save accepts same-job evidence and returns the saved report as readable data',
    first.status === 200 && firstReport?.evidenceAttachmentIds[0] === evidenceKey);

  const unchanged = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a6666666-6666-4666-8666-666666666666',
      firstReport?.updatedAt ?? report.updatedAt,
      { technicianRemark: 'Evidence retained on the resulting draft' }
    ),
    env
  );
  const unchangedBody = await unchanged.json() as {
    data?: { report?: ServiceReport };
  };
  check('V1 save keeps unchanged valid evidence and remains editable',
    unchanged.status === 200 &&
    unchangedBody.data?.report?.evidenceAttachmentIds[0] === evidenceKey &&
    unchangedBody.data.report.technicianRemark === 'Evidence retained on the resulting draft');

  const emptied = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a7777777-7777-4777-8777-777777777777',
      unchangedBody.data?.report?.updatedAt ?? report.updatedAt,
      { evidenceAttachmentIds: [] }
    ),
    env
  );
  const emptiedBody = await emptied.json() as {
    data?: { report?: ServiceReport };
  };
  check('V1 save accepts an explicit empty evidence list',
    emptied.status === 200 && emptiedBody.data?.report?.evidenceAttachmentIds.length === 0);
}

// A text-only edit must revalidate evidence already stored on the V1 draft.
{
  const jobId = 'BRN-2026-000020';
  const { report, state, store } = createLegacySaveFixture(jobId, '20');
  const objects = createMemoryEvidenceObjects();
  const evidenceKey = `service-jobs/${jobId}/report/retained-evidence.jpg`;
  await seedEvidence(store, objects, evidenceKey, jobId, 1024, false);
  store.set('serviceReports', report.id, {
    ...store.read('serviceReports', report.id),
    evidenceAttachmentIds: [evidenceKey],
  });
  const before = JSON.stringify(store.read('serviceReports', report.id));
  const { handler, env } = createHandler(state, {
    mode: 'compatibility', v2Store: store, objects,
  });
  const missingObject = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a8888888-8888-4888-8888-888888888888', report.updatedAt,
      { technicianRemark: 'Text-only update with unavailable retained evidence' }
    ),
    env
  );
  check('V1 text-only save rejects retained evidence whose object is missing without writes',
    missingObject.status === 409 && store.committedWrites.length === 0 &&
    JSON.stringify(store.read('serviceReports', report.id)) === before);

  await seedEvidence(store, objects, evidenceKey, 'BRN-2026-000099');
  const foreignOwner = await handler.fetch(
    legacySaveRequest(
      jobId, report.id, 'a9999999-9999-4999-8999-999999999999', report.updatedAt,
      { technicianRemark: 'Text-only update with foreign-owned retained evidence' }
    ),
    env
  );
  check('V1 text-only save rejects retained evidence whose metadata owner changed without writes',
    foreignOwner.status === 403 && store.committedWrites.length === 0 &&
    JSON.stringify(store.read('serviceReports', report.id)) === before);
}

// V2 creation/finalization in compatibility mode releases a versioned slot
// that the ordinary V1 create route can advance without duplicate drafts.
{
  const jobId = 'BRN-2026-000023';
  const serviceJob = makeServiceJob(jobId, 'bruno-thailand');
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([[jobId, serviceJob]]),
    reports: new Map(),
    draftKeys: new Map(),
    locks: new Map(),
    sequences: new Map(),
  };
  const store = new MemoryV2Store();
  store.set('serviceJobs', jobId, { ...serviceJob });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Technician',
  });
  const { handler, env } = createHandler(state, { mode: 'compatibility', v2Store: store });
  const base = `http://worker.test/service-jobs/${jobId}/service-reports`;
  const v2Create = await handler.fetch(new Request(base, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json',
      'Idempotency-Key': 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeee01' },
    body: JSON.stringify({
      contractVersion: 2,
      content: {
        technician: 'QA Technician',
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
        warrantyOutcome: 'undetermined',
      },
    }),
  }), env);
  const v2Body = await v2Create.json() as { data?: { report?: { id: string } } };
  const v2ReportId = v2Body.data?.report?.id;
  const v2Save = v2ReportId ? await handler.fetch(new Request(
    `${base}/${v2ReportId}/draft-save`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json',
        'Idempotency-Key': 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeee04' },
      body: JSON.stringify({
        contractVersion: 2, expectedContentRevision: 0,
        patch: { technicianRemark: 'Saved before finalize' },
      }),
    }
  ), env) : null;
  const v2FinalizeRequest = () => new Request(
    `${base}/${v2ReportId}/finalize`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json',
        'Idempotency-Key': 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeee02' },
      body: JSON.stringify({ contractVersion: 2, expectedContentRevision: 1 }),
    }
  );
  const v2Finalize = v2ReportId ? await handler.fetch(v2FinalizeRequest(), env) : null;
  // The client may lose the committed response. Resending the exact request
  // must return the final report without another transaction commit.
  const writesAfterV2Finalize = store.committedWrites.length;
  const v2FinalizeReplay = v2ReportId ? await handler.fetch(v2FinalizeRequest(), env) : null;
  const v2FinalizeReplayBody = v2FinalizeReplay
    ? await v2FinalizeReplay.json() as { replayed?: boolean; data?: { report?: { status?: string } } }
    : null;
  check('compatibility V2 finalize replays a committed lost response without another write',
    v2Finalize?.status === 200 && v2FinalizeReplay?.status === 200 &&
    v2FinalizeReplayBody?.replayed === true &&
    v2FinalizeReplayBody.data?.report?.status === 'final' &&
    store.committedWrites.length === writesAfterV2Finalize);
  const slot = store.read('serviceReportActiveDrafts', jobId);

  check('compatibility V2 create/finalize leaves the expected released slot',
    v2Create.status === 201 && v2Finalize?.status === 200 &&
      slot?.slotVersion === 1 && slot.state === 'released' &&
      slot.activeReportId === null && slot.lastReleasedReportId === v2ReportId);
  if (slot) state.locks.set(jobId, slot as unknown as ActiveDraftLock);
  const v1Create = await handler.fetch(new Request(base, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json',
      'Idempotency-Key': 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeee03' },
    body: JSON.stringify({ input: {} }),
  }), env);
  const v1Body = await v1Create.json() as { report?: ServiceReport };
  check('compatibility mode creates one V1 draft after a V2 finalized slot',
    v1Create.status === 201 && v1Body.report?.status === 'draft' &&
      state.locks.get(jobId)?.state === 'active' &&
      state.locks.get(jobId)?.generation === 2 &&
      state.locks.get(jobId)?.activeReportId === v1Body.report.id);
}

// Explicit V1 finalize replay must reauthorize the current profile inside the transaction.
{
  const jobId = 'BRN-2026-000022';
  const serviceJob = makeServiceJob(jobId, 'bruno-thailand');
  const report = createServiceReportDraft(
    '00000000-0000-4000-8000-000000000022',
    'FR-2026-000022',
    serviceJob,
    {
      customerReportedProblem: 'Fault reported',
      inspectionFindings: 'Fault reproduced',
      serviceActions: ['repair'],
      resultStatus: 'repaired',
    },
    new Date('2026-03-01T00:00:00.000Z')
  );
  const state: FakeState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([[jobId, serviceJob]]),
    reports: new Map([[report.id, report]]),
    draftKeys: new Map(),
    locks: new Map([[jobId, { draftReportId: report.id }]]),
    sequences: new Map(),
  };
  const store = new MemoryV2Store();
  store.set('serviceJobs', jobId, { ...serviceJob });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Technician',
  });
  const reportData = { ...report } as unknown as Record<string, unknown>;
  delete reportData.id;
  store.set('serviceReports', report.id, reportData);
  store.set('serviceReportActiveDrafts', jobId, { draftReportId: report.id });
  const { handler, env } = createHandler(state, { mode: 'disabled', v2Store: store });
  const key = 'accccccc-cccc-4ccc-8ccc-cccccccccccc';
  const request = () => new Request(
    `http://worker.test/service-jobs/${jobId}/service-reports/${report.id}/finalize`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ contractVersion: 1, expectedUpdatedAt: report.updatedAt }),
    }
  );
  const finalized = await handler.fetch(request(), env);
  check('explicit V1 finalize succeeds before access is revoked', finalized.status === 200);
  const writesAfterFinalize = store.committedWrites.length;
  const releasedSlot = store.read('serviceReportActiveDrafts', jobId);
  if (!releasedSlot) throw new Error('explicit V1 finalize did not retain a released slot');
  state.locks.set(jobId, releasedSlot as unknown as ActiveDraftLock);
  const nextDraftResponse = await handler.fetch(new Request(
    `http://worker.test/service-jobs/${jobId}/service-reports`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json',
        'Idempotency-Key': 'addddddd-dddd-4ddd-8ddd-dddddddddddd' },
      body: JSON.stringify({ input: {} }),
    }
  ), env);
  const nextDraftBody = await nextDraftResponse.json() as { report?: ServiceReport };
  check('disabled mode creates a new V1 draft after explicit versioned V1 finalization',
    nextDraftResponse.status === 201 && nextDraftBody.report?.status === 'draft' &&
      state.locks.get(jobId)?.state === 'active' &&
      state.locks.get(jobId)?.activeReportId === nextDraftBody.report.id &&
      state.locks.get(jobId)?.generation === 2);

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'customer', displayName: 'QA Technician',
  });
  const replay = await handler.fetch(request(), env);
  const replayBody = await replay.json() as { data?: { report?: unknown }; report?: unknown };
  check('explicit V1 finalize replay after role removal is 403 with no report data or writes',
    replay.status === 403 && replayBody.data?.report === undefined && replayBody.report === undefined &&
    store.committedWrites.length === writesAfterFinalize);
}

if (failures) process.exitCode = 1;
