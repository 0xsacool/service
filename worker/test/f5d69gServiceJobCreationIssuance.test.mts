import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running F5d-69G Service Job creation / public-tracking SEPARATION test');

// F5d-69G Phase 2-FIX — this file's whole purpose is the inverse of what an
// earlier draft asserted. Service Job creation must perform ZERO public
// tracking issuance, because the SRV code is a one-way bearer secret: issuing
// it inside an idempotent create means a create whose response is lost leaves
// the credential committed server-side but permanently unknowable to staff.
// Creation therefore creates no secret, so a creation retry cannot lose one.

interface FakeJob {
  [key: string]: unknown;
  id: string;
  brandId: string;
  publicTrackingCodeHash: string | null;
}

interface State {
  profile: { uid: string; brandId: 'bruno-thailand' | 'join-lux-club' } | null;
  intakeKeys: Map<string, string>;
  jobs: Map<string, FakeJob>;
  sequences: Map<string, number>;
  // Every public-tracking capability the Firestore client exposes is counted
  // here. Any non-zero count during a creation request is a hard failure.
  issuanceTransactions: number;
  issuanceExistenceChecks: number;
  issuanceCommits: number;
}

function baseIntakeBody(): unknown {
  return {
    intake: {
      customerName: 'QA Customer',
      customerPhone: '0800000000',
      customerEmail: '',
      product: 'QA Product',
      productCategory: 'Other',
      serialNumber: 'SERIAL-1',
      problemDescription: 'Does not power on',
      problemChips: [],
      accessories: [],
      internalNotes: '',
      photos: [],
      warranty: false,
    },
  };
}

function createHandler(state: State) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify() {
        return { uid: 'staff-uid-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          if (!state.profile || state.profile.uid !== uid) return null;
          return { uid, brandId: state.profile.brandId };
        },
        async beginServiceJobTransaction() {
          return { id: crypto.randomUUID() };
        },
        async getIntakeKey(_: unknown, key: string) {
          return state.intakeKeys.get(key) ?? null;
        },
        async getSequence(_: unknown, brandId: string, type: string, year: number) {
          return state.sequences.get(`${brandId}__${type}__${year}`) ?? null;
        },
        async getServiceJob(_: unknown, id: string) {
          return state.jobs.get(id) ?? null;
        },
        async serviceJobExists(_: unknown, id: string) {
          return state.jobs.has(id);
        },
        async commitServiceJobCreation(
          _: unknown,
          input: {
            key: string;
            job: FakeJob;
            trackingSequence: number;
            serviceRequestSequence: number;
            year: number;
          }
        ) {
          state.jobs.set(input.job.id, input.job);
          state.intakeKeys.set(input.key, input.job.id);
          state.sequences.set(
            `${input.job.brandId}__tracking_number__${input.year}`,
            input.trackingSequence
          );
          state.sequences.set(
            `${input.job.brandId}__service_request__${input.year}`,
            input.serviceRequestSequence
          );
        },
        async beginPublicTrackingCodeIssuanceTransaction() {
          state.issuanceTransactions += 1;
          return { id: crypto.randomUUID() };
        },
        async publicTrackingCodeExists() {
          state.issuanceExistenceChecks += 1;
          return false;
        },
        async commitPublicTrackingCodeIssuance() {
          state.issuanceCommits += 1;
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

function emptyState(): State {
  return {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    intakeKeys: new Map(),
    jobs: new Map(),
    sequences: new Map(),
    issuanceTransactions: 0,
    issuanceExistenceChecks: 0,
    issuanceCommits: 0,
  };
}

function createRequest(key: string): Request {
  return new Request('http://worker.test/service-jobs', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(baseIntakeBody()),
  });
}

function noIssuanceOccurred(state: State): boolean {
  return (
    state.issuanceTransactions === 0 &&
    state.issuanceExistenceChecks === 0 &&
    state.issuanceCommits === 0
  );
}

// --- creation performs ZERO public-tracking issuance -----------------------
{
  const state = emptyState();
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(
    createRequest('11111111-1111-4111-8111-111111111111'),
    env
  );
  check('Service Job creation succeeds with 201', response.status === 201);
  const body = (await response.json()) as Record<string, unknown>;

  check(
    'creation touched NO public-tracking capability at all (no transaction, no existence check, no commit)',
    noIssuanceOccurred(state)
  );
  check(
    'the created Service Job is persisted with a null publicTrackingCodeHash — creation never activates tracking',
    state.jobs.get((body.job as FakeJob).id)?.publicTrackingCodeHash === null
  );
  check(
    'the creation response body carries ONLY { job } — no bearer credential of any kind',
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['job'])
  );
  check(
    'no SRV-shaped value appears anywhere in the creation response',
    !/SRV-\d{4}-\d{4}-[0-9A-Z]{6}/.test(JSON.stringify(body))
  );
  check(
    "the returned job's publicTrackingCodeHash is null, matching what was actually persisted",
    (body.job as FakeJob).publicTrackingCodeHash === null
  );
}

// --- lost-response replay is a PURE Service Job replay ---------------------
{
  const state = emptyState();
  const { handler, env } = createHandler(state);
  const key = '22222222-2222-4222-8222-222222222222';

  const first = await handler.fetch(createRequest(key), env);
  const firstBody = (await first.json()) as { job: FakeJob };

  // Simulates the client never seeing the first response and retrying with
  // the same key it correctly retained (useCreateServiceJob's designed
  // lost-response replay path).
  const retry = await handler.fetch(createRequest(key), env);
  check('a lost-response retry with the same idempotency key still succeeds (201)', retry.status === 201);
  const retryBody = (await retry.json()) as Record<string, unknown>;

  check(
    'the retry returns the exact same canonical Service Job, not a second allocation',
    (retryBody.job as FakeJob).id === firstBody.job.id
  );
  check(
    'the replay is a PURE Service Job replay — still zero public-tracking activity across both requests',
    noIssuanceOccurred(state)
  );
  check(
    'no bearer credential could be lost by the replay, because creation never created one',
    !/SRV-\d{4}-\d{4}-[0-9A-Z]{6}/.test(JSON.stringify(retryBody)) &&
      state.jobs.get(firstBody.job.id)?.publicTrackingCodeHash === null
  );
  check(
    'the replayed response shape is identical to the first (still only { job })',
    JSON.stringify(Object.keys(retryBody).sort()) === JSON.stringify(['job'])
  );
}

// --- a creation replay can never rotate an ALREADY-ACTIVE job's credential -
{
  const state = emptyState();
  const { handler, env } = createHandler(state);
  const key = '33333333-3333-4333-8333-333333333333';

  const first = await handler.fetch(createRequest(key), env);
  const firstBody = (await first.json()) as { job: FakeJob };

  // Staff later issue a credential explicitly (simulated directly on state,
  // exactly as the separate issuance route would leave it).
  const job = state.jobs.get(firstBody.job.id)!;
  job.publicTrackingCodeHash = 'hash-issued-explicitly-later';

  const replay = await handler.fetch(createRequest(key), env);
  const replayBody = (await replay.json()) as { job: FakeJob };
  check(
    'a later creation replay does NOT rotate or disturb the explicitly-issued credential',
    state.jobs.get(firstBody.job.id)?.publicTrackingCodeHash === 'hash-issued-explicitly-later' &&
      noIssuanceOccurred(state)
  );
  check(
    'the replay truthfully reports the job as active (hash present), without inventing a plaintext code',
    replayBody.job.publicTrackingCodeHash === 'hash-issued-explicitly-later' &&
      !/SRV-\d{4}-\d{4}-[0-9A-Z]{6}/.test(JSON.stringify(replayBody))
  );
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(
    `F5d-69G Service Job creation separation test failed: ${failures} failure(s)`
  );
} else {
  console.log('F5d-69G Service Job creation separation test passed');
}
