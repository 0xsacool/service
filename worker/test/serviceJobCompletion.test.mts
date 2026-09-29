import assert from 'node:assert/strict';
import {
  completeServiceJob,
  ServiceJobCompletionHistoricalStateError,
  ServiceJobCompletionTerminalError,
  type ServiceJobCompletionDataAccess,
} from '../src/serviceJobCompletion.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

function makeJob(overrides: Partial<ServiceJob> = {}): ServiceJob {
  return {
    id: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    customerName: 'QA',
    customerPhone: '0800000000',
    customerEmail: '',
    product: 'QA Product',
    productCategory: 'QA',
    serialNumber: 'QA-777',
    issue: 'issue',
    description: 'description',
    status: 'Ready for Pickup',
    priority: 'Normal',
    createdAt: '2026-09-20',
    updatedAt: '2026-09-20',
    technician: 'Tech',
    estimatedCompletion: '2026-09-28',
    warranty: true,
    photos: [],
    timeline: [],
    notes: [],
    serviceRequestNumber: 'SR-2026-000777',
    returnFormNumber: null,
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: null,
    purchaseDate: null,
    orderDeliveredDate: null,
    externalEvidenceUrl: null,
    externalEvidenceNote: null,
    ...overrides,
  };
}

function createCompletionStore(initial: ServiceJob, currentSequence = 0) {
  let job = { ...initial };
  let sequence = currentSequence;
  const commits: Array<Record<string, unknown>> = [];
  const dataAccess: ServiceJobCompletionDataAccess = {
    async beginServiceJobTransaction() {
      return { id: crypto.randomUUID() };
    },
    async getServiceJob() {
      return { ...job };
    },
    async getSequence(_tx, brandId, type, year) {
      assert.equal(brandId, 'bruno-thailand');
      assert.equal(type, 'return_form');
      assert.ok(year >= 2026);
      return sequence;
    },
    async commitServiceJobCompletion(_tx, input) {
      commits.push({ ...input });
      sequence = input.sequence;
      job = {
        ...job,
        status: 'Completed',
        returnFormNumber: input.returnFormNumber,
        closedAt: input.closedAt,
        updatedAt: input.updatedAt,
        timeline: input.timeline,
      };
    },
  };
  return {
    dataAccess,
    get job() {
      return { ...job };
    },
    get sequence() {
      return sequence;
    },
    commits,
  };
}

{
  const store = createCompletionStore(makeJob(), 8);
  const completed = await completeServiceJob({
    serviceJobId: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    dataAccess: store.dataAccess,
    now: () => new Date('2026-12-31T18:30:00.000Z'),
  });
  assert.equal(completed.status, 'Completed');
  assert.equal(completed.returnFormNumber, 'RT-2027-000009');
  assert.equal(completed.closedAt, '2026-12-31T18:30:00.000Z');
  assert.equal(completed.timeline.length, 1);
  assert.equal(completed.timeline[0]?.status, 'Completed');
  assert.equal(completed.timeline[0]?.date, '2027-01-01');
  assert.equal(store.commits.length, 1);
  assert.equal(store.sequence, 9);

  const replay = await completeServiceJob({
    serviceJobId: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    dataAccess: store.dataAccess,
    now: () => new Date('2027-01-01T20:00:00.000Z'),
  });
  assert.equal(replay.returnFormNumber, 'RT-2027-000009');
  assert.equal(replay.timeline.length, 1);
  assert.equal(store.commits.length, 1);
  assert.equal(store.sequence, 9);
}

{
  const historical = createCompletionStore(
    makeJob({
      status: 'Completed',
      closedAt: '2026-09-28T00:00:00.000Z',
      returnFormNumber: null,
    })
  );
  await assert.rejects(
    () =>
      completeServiceJob({
        serviceJobId: 'BRN-2026-000777',
        brandId: 'bruno-thailand',
        dataAccess: historical.dataAccess,
      }),
    ServiceJobCompletionHistoricalStateError
  );
  assert.equal(historical.commits.length, 0);
}


for (const invalidClosedAt of [
  '2026-02-30T03:04:05.000Z',
  '2026-13-01T03:04:05.000Z',
  '2026-09-28T24:00:00.000Z',
  '2026-09-28T03:60:00.000Z',
  '2026-09-28T03:04:60.000Z',
  '2026-09-28T03:04:05.000+24:00',
]) {
  const malformedHistorical = createCompletionStore(
    makeJob({
      status: 'Completed',
      closedAt: invalidClosedAt,
      returnFormNumber: 'RT-2026-000777',
    })
  );
  await assert.rejects(
    () =>
      completeServiceJob({
        serviceJobId: 'BRN-2026-000777',
        brandId: 'bruno-thailand',
        dataAccess: malformedHistorical.dataAccess,
      }),
    ServiceJobCompletionHistoricalStateError,
    `invalid closedAt must fail closed: ${invalidClosedAt}`
  );
  assert.equal(malformedHistorical.commits.length, 0);
}

for (const status of ['Cancelled', 'Rejected'] as const) {
  const terminal = createCompletionStore(
    makeJob({ status, closedAt: '2026-09-28T00:00:00.000Z' })
  );
  await assert.rejects(
    () =>
      completeServiceJob({
        serviceJobId: 'BRN-2026-000777',
        brandId: 'bruno-thailand',
        dataAccess: terminal.dataAccess,
      }),
    ServiceJobCompletionTerminalError
  );
  assert.equal(terminal.commits.length, 0);
}

interface RouteState {
  profileBrand: 'bruno-thailand' | 'join-lux-club' | null;
  job: ServiceJob | null;
  sequence: number;
  commits: number;
}

function routeHandler(state: RouteState) {
  const client = {
    async getStaffProfile(uid: string) {
      return state.profileBrand
        ? { uid, brandId: state.profileBrand, canImportProducts: false }
        : null;
    },
    async getServiceJobAuthorization(jobId: string) {
      return state.job && state.job.id === jobId
        ? { id: jobId, brandId: state.job.brandId }
        : null;
    },
    async beginServiceJobTransaction() {
      return { id: crypto.randomUUID() };
    },
    async getServiceJob(_tx: unknown, id: string) {
      return state.job?.id === id ? { ...state.job } : null;
    },
    async getSequence() {
      return state.sequence;
    },
    async commitServiceJobCompletion(_tx: unknown, input: {
      returnFormNumber: string;
      sequence: number;
      closedAt: string;
      updatedAt: string;
      timeline: ServiceJob['timeline'];
    }) {
      state.commits += 1;
      state.sequence = input.sequence;
      if (!state.job) throw new Error('missing');
      state.job = {
        ...state.job,
        status: 'Completed',
        returnFormNumber: input.returnFormNumber,
        closedAt: input.closedAt,
        updatedAt: input.updatedAt,
        timeline: input.timeline,
      };
    },
  } as unknown as FirestoreClient;

  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token: string) {
        if (token !== 'valid-token') throw new Error('invalid');
        return { uid: 'staff-1' };
      },
    },
    createFirestoreClient: () => client,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  return { handler: createWorkerHandler(dependencies), env };
}

function completeRequest(id = 'BRN-2026-000777', token = 'valid-token') {
  return new Request(`http://worker.test/service-jobs/${id}/complete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
}

{
  const state: RouteState = {
    profileBrand: 'bruno-thailand',
    job: makeJob(),
    sequence: 2,
    commits: 0,
  };
  const { handler, env } = routeHandler(state);

  const noAuth = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000777/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env
  );
  assert.equal(noAuth.status, 401);

  const completed = await handler.fetch(completeRequest(), env);
  assert.equal(completed.status, 200);
  assert.equal(state.commits, 1);
  assert.equal(state.job?.returnFormNumber, 'RT-2026-000003');

  const replay = await handler.fetch(completeRequest(), env);
  assert.equal(replay.status, 200);
  assert.equal(state.commits, 1);
  assert.equal(state.sequence, 3);
}

{
  const state: RouteState = {
    profileBrand: 'join-lux-club',
    job: makeJob(),
    sequence: 0,
    commits: 0,
  };
  const { handler, env } = routeHandler(state);
  const response = await handler.fetch(completeRequest(), env);
  assert.equal(response.status, 403);
  assert.equal(state.commits, 0);
}

{
  const state: RouteState = {
    profileBrand: 'bruno-thailand',
    job: makeJob({
      status: 'Completed',
      closedAt: '2026-09-28T00:00:00.000Z',
      returnFormNumber: null,
    }),
    sequence: 0,
    commits: 0,
  };
  const { handler, env } = routeHandler(state);
  const response = await handler.fetch(completeRequest(), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, 'return_form_metadata_missing');
  assert.equal(state.commits, 0);
}

{
  const state: RouteState = {
    profileBrand: 'bruno-thailand',
    job: makeJob({
      status: 'Rejected',
      closedAt: '2026-09-28T00:00:00.000Z',
    }),
    sequence: 0,
    commits: 0,
  };
  const { handler, env } = routeHandler(state);
  const response = await handler.fetch(completeRequest(), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, 'terminal_state');
  assert.equal(state.commits, 0);
}

console.log('N7.6 Service Job completion tests passed');
