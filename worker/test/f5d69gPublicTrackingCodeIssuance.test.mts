import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import {
  issuePublicTrackingCodeForServiceJob,
  type PublicTrackingCodeIssuanceDataAccess,
} from '../src/publicTrackingCodeIssuance.ts';
import { TransactionConflictError, type AllocationTransaction } from '../src/serviceJobCreation.ts';
import {
  isValidPublicTrackingCode,
  PublicTrackingCodeCollisionError,
} from '../../src/services/publicTrackingCode.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running F5d-69G public tracking code issuance regression test');

// --- module-level: issuePublicTrackingCodeForServiceJob() ---

class FakeIssuanceDataAccess implements PublicTrackingCodeIssuanceDataAccess {
  codes = new Set<string>();
  commits: Array<{ serviceJobId: string; code: string; codeHash: string }> = [];
  beginCalls = 0;
  commitFailuresRemaining = 0;

  async beginPublicTrackingCodeIssuanceTransaction(): Promise<AllocationTransaction> {
    this.beginCalls += 1;
    return { id: `txn-${this.beginCalls}` };
  }
  async publicTrackingCodeExists(_: AllocationTransaction, code: string): Promise<boolean> {
    return this.codes.has(code);
  }
  async commitPublicTrackingCodeIssuance(
    _: AllocationTransaction,
    input: { serviceJobId: string; code: string; codeHash: string }
  ): Promise<void> {
    if (this.commitFailuresRemaining > 0) {
      this.commitFailuresRemaining -= 1;
      throw new TransactionConflictError();
    }
    this.codes.add(input.code);
    this.commits.push(input);
  }
}

{
  const dataAccess = new FakeIssuanceDataAccess();
  const issued = await issuePublicTrackingCodeForServiceJob(
    'BRN-2026-000006',
    dataAccess,
    () => new Date('2026-08-19T10:00:00Z')
  );
  check('a random code in the canonical SRV format is generated', isValidPublicTrackingCode(issued.code));
  check('the issued code is committed exactly once', dataAccess.commits.length === 1);
  check(
    'the commit targets the correct Service Job and matches the returned code/hash',
    dataAccess.commits[0]?.serviceJobId === 'BRN-2026-000006' &&
      dataAccess.commits[0]?.code === issued.code &&
      dataAccess.commits[0]?.codeHash === issued.codeHash
  );
  check('the raw code and its hash are never equal', issued.code !== issued.codeHash);
}

{
  // Collision retry: a fake existence store that reports the first N
  // candidates as already taken, forcing generateAvailablePublicTrackingCode
  // to keep retrying until one is free.
  const dataAccess = new FakeIssuanceDataAccess();
  let generatedCount = 0;
  const originalExists = dataAccess.publicTrackingCodeExists.bind(dataAccess);
  dataAccess.publicTrackingCodeExists = async (transaction, code) => {
    generatedCount += 1;
    if (generatedCount <= 2) return true;
    return originalExists(transaction, code);
  };
  const issued = await issuePublicTrackingCodeForServiceJob('BRN-2026-000007', dataAccess);
  check(
    'collision retry works: issuance still succeeds after simulated pre-existing candidates',
    isValidPublicTrackingCode(issued.code) && generatedCount > 2
  );
}

{
  // Bounded collision exhaustion: every candidate is reported as taken.
  const dataAccess = new FakeIssuanceDataAccess();
  dataAccess.publicTrackingCodeExists = async () => true;
  let threw: unknown = null;
  try {
    await issuePublicTrackingCodeForServiceJob('BRN-2026-000008', dataAccess);
  } catch (error) {
    threw = error;
  }
  check(
    'bounded collision exhaustion fails safely with PublicTrackingCodeCollisionError',
    threw instanceof PublicTrackingCodeCollisionError
  );
  check('no commit was ever attempted once every candidate was reported taken', dataAccess.commits.length === 0);
}

{
  // Transaction-conflict retry at the commit layer (distinct from pre-commit
  // existence-check collision retry above).
  const dataAccess = new FakeIssuanceDataAccess();
  dataAccess.commitFailuresRemaining = 1;
  const issued = await issuePublicTrackingCodeForServiceJob('BRN-2026-000009', dataAccess);
  check(
    'a single commit-time TransactionConflictError is retried and eventually succeeds',
    isValidPublicTrackingCode(issued.code) && dataAccess.beginCalls === 2
  );
}

{
  const dataAccess = new FakeIssuanceDataAccess();
  dataAccess.commitFailuresRemaining = 10;
  let threw: unknown = null;
  try {
    await issuePublicTrackingCodeForServiceJob('BRN-2026-000010', dataAccess);
  } catch (error) {
    threw = error;
  }
  check(
    'commit-time conflicts beyond the retry bound propagate as TransactionConflictError, not swallowed',
    threw instanceof TransactionConflictError
  );
}

// --- route-level: POST /service-jobs/{jobId}/public-tracking-code ---

interface RouteState {
  profile: { uid: string; brandId: 'bruno-thailand' | 'join-lux-club' } | null;
  jobs: Map<string, { id: string; brandId: string; publicTrackingCodeHash: string | null }>;
  codes: Map<string, string>; // code -> serviceJobId
}

function createRouteHandler(state: RouteState) {
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
        async beginPublicTrackingCodeIssuanceTransaction() {
          return { id: crypto.randomUUID() };
        },
        async publicTrackingCodeExists(_: unknown, code: string) {
          return state.codes.has(code);
        },
        async commitPublicTrackingCodeIssuance(
          _: unknown,
          input: { serviceJobId: string; code: string; codeHash: string }
        ) {
          const job = state.jobs.get(input.serviceJobId);
          if (!job) throw new Error('job missing');
          job.publicTrackingCodeHash = input.codeHash;
          state.codes.set(input.code, input.serviceJobId);
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

{
  const state: RouteState = { profile: null, jobs: new Map(), codes: new Map() };
  const { handler, env } = createRouteHandler(state);
  const noAuth = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/public-tracking-code', {
      method: 'POST',
    }),
    env
  );
  check('issuance with no Authorization header is 401', noAuth.status === 401);

  const badToken = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/public-tracking-code', {
      method: 'POST',
      headers: authHeaders('invalid-token'),
    }),
    env
  );
  check('issuance with an invalid token is 403', badToken.status === 403);
}

{
  const state: RouteState = {
    profile: { uid: 'staff-uid-1', brandId: 'join-lux-club' },
    jobs: new Map([
      ['BRN-2026-000001', { id: 'BRN-2026-000001', brandId: 'bruno-thailand', publicTrackingCodeHash: null }],
    ]),
    codes: new Map(),
  };
  const { handler, env } = createRouteHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000001/public-tracking-code', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('issuance for a Service Job outside the staff brand is 403', response.status === 403);
  check('a cross-brand issuance attempt never writes a hash', state.jobs.get('BRN-2026-000001')?.publicTrackingCodeHash === null);
}

{
  const state: RouteState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map(),
    codes: new Map(),
  };
  const { handler, env } = createRouteHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-999999/public-tracking-code', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('issuance for a nonexistent Service Job fails closed as 403 (not found is indistinguishable from cross-brand)', response.status === 403);
}

{
  // Inactive job -> "issue"
  const state: RouteState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map([
      ['BRN-2026-000006', { id: 'BRN-2026-000006', brandId: 'bruno-thailand', publicTrackingCodeHash: null }],
    ]),
    codes: new Map(),
  };
  const { handler, env } = createRouteHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000006/public-tracking-code', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('issuance for an inactive job succeeds with 201', response.status === 201);
  const body = (await response.json()) as { code: string };
  check('the response contains only a valid canonical code, no hash', isValidPublicTrackingCode(body.code) && !('codeHash' in body) && !('hash' in body));
  const firstHash = state.jobs.get('BRN-2026-000006')?.publicTrackingCodeHash ?? null;
  check('the Service Job now has a non-null publicTrackingCodeHash', firstHash !== null);

  // Rotate the same job.
  const rotateResponse = await handler.fetch(
    new Request('http://worker.test/service-jobs/BRN-2026-000006/public-tracking-code', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('rotation for an already-active job also succeeds with 201', rotateResponse.status === 201);
  const rotateBody = (await rotateResponse.json()) as { code: string };
  check('rotation issues a different code than the first issuance', rotateBody.code !== body.code);
  const rotatedHash = state.jobs.get('BRN-2026-000006')?.publicTrackingCodeHash ?? null;
  check('rotation replaces the stored hash with a new one', rotatedHash !== null && rotatedHash !== firstHash);
}

{
  const state: RouteState = {
    profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
    jobs: new Map(),
    codes: new Map(),
  };
  const { handler, env } = createRouteHandler(state);
  const response = await handler.fetch(
    new Request('http://worker.test/service-jobs/bad%20id!/public-tracking-code', {
      method: 'POST',
      headers: authHeaders(),
    }),
    env
  );
  check('an unsafe jobId is rejected with 400', response.status === 400);
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(`F5d-69G public tracking code issuance regression test failed: ${failures} failure(s)`);
} else {
  console.log('F5d-69G public tracking code issuance regression test passed');
}
