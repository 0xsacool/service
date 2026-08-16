import { createFirestoreClient } from '../src/firestoreClient.ts';
import {
  allocateServiceJob,
  TransactionConflictError,
} from '../src/serviceJobCreation.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';

// F5d-56. Proves the real allocator failure stages (OAuth token
// acquisition, Firestore transaction begin, each distinct document read,
// and commit) are individually attributable via the exact
// "[ServiceJob Allocator] <stage>: <code>" console.error line — reproduced
// against the real createFirestoreClient() implementation with only the
// network boundary stubbed, the same pattern serviceJobAllocatorCommit.test.mts
// already established — plus proves the client-facing HTTP response stays
// generic throughout, and that a fully successful allocation logs nothing.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running allocator stage attribution regression test');

const intake: ServiceJobIntakePayload = {
  customerName: 'QA Customer',
  customerPhone: '0000000000',
  customerEmail: '',
  product: 'QA Product',
  productCategory: 'Other',
  serialNumber: 'SERIAL-1',
  problemDescription: '',
  problemChips: [],
  accessories: [],
  internalNotes: '',
  photos: [],
  warranty: false,
};

const commitInput = {
  key: '11111111-1111-4111-8111-111111111111',
  job: {
    id: 'BRN-2026-000001',
    serviceRequestNumber: 'SR-2026-000001',
    brandId: 'bruno-thailand' as const,
    customerName: 'x',
    customerPhone: '',
    customerEmail: '',
    product: '',
    productCategory: '',
    serialNumber: '',
    issue: '',
    description: '',
    status: 'Received' as const,
    priority: 'Normal' as const,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    technician: '',
    estimatedCompletion: '',
    warranty: false,
    photos: [],
    timeline: [],
    notes: [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
  },
  trackingSequence: 1,
  serviceRequestSequence: 1,
  year: 2026,
};

function captureConsoleError(): { logged: string[]; restore: () => void } {
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  return {
    logged,
    restore: () => {
      console.error = original;
    },
  };
}

// --- oauth-token: no network call happens at all (getAccessToken() throws
// synchronously before any fetch), so no fetch stub is even installed for
// this case — proving the diagnostic fires purely from local config state.
{
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    // Deliberately no FIRESTORE_EMULATOR_HOST and no
    // GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY — getAccessToken() throws
    // its "Missing GOOGLE_SERVICE_ACCOUNT..." error before any fetch.
  };
  const client = createFirestoreClient(env);
  const { logged, restore } = captureConsoleError();
  let threw = false;
  try {
    await client.beginServiceJobTransaction();
  } catch {
    threw = true;
  } finally {
    restore();
  }
  check('an OAuth/token failure rejects beginServiceJobTransaction', threw);
  check(
    'an OAuth/token failure is logged as stage oauth-token, not folded into a generic allocator stage',
    logged.some((line) => line === '[ServiceJob Allocator] oauth-token: not-configured')
  );
}

// Emulator-mode env for every fetch-stubbed scenario below — getAccessToken()
// returns null (no real Google token exchange), matching every other
// Worker test's established pattern for exercising the REST layer without
// real credentials.
const emulatorEnv: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

async function withStubbedFetch<T>(
  respond: (url: URL) => Response | null,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const response = respond(url);
    if (response) return response;
    return new Response('', { status: 404 });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- firestore-transaction-begin --------------------------------------------
{
  const client = createFirestoreClient(emulatorEnv);
  const { logged, restore } = captureConsoleError();
  let threw = false;
  await withStubbedFetch(
    (url) =>
      url.pathname.endsWith(':beginTransaction')
        ? new Response('boom', { status: 500 })
        : null,
    async () => {
      try {
        await client.beginServiceJobTransaction();
      } catch {
        threw = true;
      }
    }
  );
  restore();
  check('a transaction-begin failure rejects beginServiceJobTransaction', threw);
  check(
    'a transaction-begin failure is logged as stage firestore-transaction-begin',
    logged.some(
      (line) => line === '[ServiceJob Allocator] firestore-transaction-begin: http-500'
    )
  );
}

// --- intake-key-read / tracking-sequence-read / service-request-sequence-read / occupied-id-read
const readScenarios: {
  label: string;
  matchesPathname: (pathname: string) => boolean;
  run: (client: FirestoreClient) => Promise<unknown>;
  expectedStage: string;
}[] = [
  {
    label: 'intake-key-read',
    matchesPathname: (pathname) => pathname.includes('/serviceJobIntakeKeys/'),
    run: (client) =>
      client.getIntakeKey({ id: 'txn-1' }, '11111111-1111-4111-8111-111111111111'),
    expectedStage: 'intake-key-read',
  },
  {
    label: 'tracking-sequence-read',
    matchesPathname: (pathname) =>
      pathname.includes('/numberSequences/') && pathname.includes('tracking_number'),
    run: (client) =>
      client.getSequence({ id: 'txn-1' }, 'bruno-thailand', 'tracking_number', 2026),
    expectedStage: 'tracking-sequence-read',
  },
  {
    label: 'service-request-sequence-read',
    matchesPathname: (pathname) =>
      pathname.includes('/numberSequences/') && pathname.includes('service_request'),
    run: (client) =>
      client.getSequence({ id: 'txn-1' }, 'bruno-thailand', 'service_request', 2026),
    expectedStage: 'service-request-sequence-read',
  },
  {
    label: 'occupied-id-read',
    matchesPathname: (pathname) => pathname.includes('/serviceJobs/'),
    run: (client) => client.getServiceJob({ id: 'txn-1' }, 'BRN-2026-000001'),
    expectedStage: 'occupied-id-read',
  },
];

for (const scenario of readScenarios) {
  const client = createFirestoreClient(emulatorEnv);
  const { logged, restore } = captureConsoleError();
  let threw = false;
  await withStubbedFetch(
    (url) =>
      scenario.matchesPathname(url.pathname)
        ? new Response('boom', { status: 403 })
        : null,
    async () => {
      try {
        await scenario.run(client);
      } catch {
        threw = true;
      }
    }
  );
  restore();
  check(`a ${scenario.label} failure rejects the read`, threw);
  check(
    `a ${scenario.label} failure is logged with exactly that stage`,
    logged.some(
      (line) => line === `[ServiceJob Allocator] ${scenario.expectedStage}: http-403`
    )
  );
}

// --- firestore-commit --------------------------------------------------------
{
  const client = createFirestoreClient(emulatorEnv);
  const { logged, restore } = captureConsoleError();
  let threw = false;
  await withStubbedFetch(
    (url) =>
      url.pathname.endsWith(':commit') ? new Response('boom', { status: 500 }) : null,
    async () => {
      try {
        await client.commitServiceJobCreation({ id: 'txn-1' }, commitInput);
      } catch {
        threw = true;
      }
    }
  );
  restore();
  check('a commit failure rejects commitServiceJobCreation', threw);
  check(
    'a commit failure is logged as stage firestore-commit',
    logged.some((line) => line === '[ServiceJob Allocator] firestore-commit: http-500')
  );
}

// --- canonical commit-status discrimination --------------------------------
const hostileMessage =
  'customers/0899999999 intake=11111111-1111-4111-8111-111111111111 Bearer secret-token';
const commitErrorScenarios: {
  label: string;
  response: () => Response;
  expectConflict: boolean;
  expectedDiagnostic: string | null;
}[] = [
  {
    label: 'canonical ABORTED over HTTP 409',
    response: () =>
      new Response(
        JSON.stringify({
          error: { code: 409, status: 'ABORTED', message: hostileMessage },
        }),
        { status: 409 }
      ),
    expectConflict: true,
    expectedDiagnostic: null,
  },
  {
    label: 'canonical ALREADY_EXISTS over HTTP 409',
    response: () =>
      new Response(
        JSON.stringify({
          error: { code: 409, status: 'ALREADY_EXISTS', message: hostileMessage },
        }),
        { status: 409 }
      ),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: ALREADY_EXISTS',
  },
  {
    label: 'canonical FAILED_PRECONDITION',
    response: () =>
      new Response(
        JSON.stringify({
          error: { code: 400, status: 'FAILED_PRECONDITION', message: hostileMessage },
        }),
        { status: 400 }
      ),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: FAILED_PRECONDITION',
  },
  {
    label: 'empty HTTP 409',
    response: () => new Response('', { status: 409 }),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: http-409',
  },
  {
    label: 'malformed HTTP 409',
    response: () => new Response('{not-json', { status: 409 }),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: http-409',
  },
  {
    label: 'unknown canonical status over HTTP 409',
    response: () =>
      new Response(
        JSON.stringify({
          error: { status: 'SOMETHING_MADE_UP', message: hostileMessage },
        }),
        { status: 409 }
      ),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: http-409',
  },
  {
    label: 'inconsistent FAILED_PRECONDITION over HTTP 409',
    response: () =>
      new Response(
        JSON.stringify({
          error: { status: 'FAILED_PRECONDITION', message: hostileMessage },
        }),
        { status: 409 }
      ),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: FAILED_PRECONDITION',
  },
  {
    label: 'canonical ABORTED over HTTP 412',
    response: () =>
      new Response(
        JSON.stringify({
          error: { status: 'ABORTED', message: hostileMessage },
        }),
        { status: 412 }
      ),
    expectConflict: false,
    expectedDiagnostic: '[ServiceJob Allocator] firestore-commit: ABORTED',
  },
];

for (const scenario of commitErrorScenarios) {
  const client = createFirestoreClient(emulatorEnv);
  const { logged, restore } = captureConsoleError();
  let caughtError: unknown;
  await withStubbedFetch(
    (url) => (url.pathname.endsWith(':commit') ? scenario.response() : null),
    async () => {
      try {
        await client.commitServiceJobCreation({ id: 'txn-1' }, commitInput);
      } catch (error) {
        caughtError = error;
      }
    }
  );
  restore();
  check(
    `${scenario.label}: retry classification is correct`,
    caughtError instanceof TransactionConflictError === scenario.expectConflict
  );
  const allocatorLines = logged.filter((line) =>
    line.startsWith('[ServiceJob Allocator]')
  );
  check(
    `${scenario.label}: diagnostic behavior is correct`,
    scenario.expectedDiagnostic === null
      ? allocatorLines.length === 0
      : allocatorLines.length === 1 && allocatorLines[0] === scenario.expectedDiagnostic
  );
  check(
    `${scenario.label}: hostile response content never appears in logs`,
    !logged.some(
      (line) =>
        line.includes('0899999999') ||
        line.includes('11111111-1111-4111-8111-111111111111') ||
        line.includes('secret-token')
    )
  );
}

// A non-OK commit body may contain sensitive server text. The transport reads
// it once, then shares that one string between retry discrimination and the
// existing sanitized diagnostic path.
{
  const client = createFirestoreClient(emulatorEnv);
  const response = new Response(
    JSON.stringify({ error: { status: 'ALREADY_EXISTS', message: hostileMessage } }),
    { status: 409 }
  );
  const originalText = response.text.bind(response);
  let bodyReads = 0;
  response.text = async () => {
    bodyReads += 1;
    return await originalText();
  };
  const { restore } = captureConsoleError();
  await withStubbedFetch(
    (url) => (url.pathname.endsWith(':commit') ? response : null),
    async () => {
      try {
        await client.commitServiceJobCreation({ id: 'txn-1' }, commitInput);
      } catch {
        // expected fail-fast response
      }
    }
  );
  restore();
  check('a non-OK commit response body is read exactly once', bodyReads === 1);
}

// --- successful allocation logs nothing -------------------------------------
{
  const client = createFirestoreClient(emulatorEnv);
  const { logged, restore } = captureConsoleError();
  let sequence = 0;
  await withStubbedFetch(
    (url) => {
      if (url.pathname.endsWith(':beginTransaction')) {
        return new Response(JSON.stringify({ transaction: `txn-${(sequence += 1)}` }), {
          status: 200,
        });
      }
      if (url.pathname.endsWith(':commit')) {
        return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
      }
      return null; // every read: 404, i.e. nothing recorded yet
    },
    async () => {
      await allocateServiceJob({
        brandId: 'bruno-thailand',
        key: '22222222-2222-4222-8222-222222222222',
        intake,
        dataAccess: client,
        now: () => new Date('2026-08-11T10:00:00.000Z'),
      });
    }
  );
  restore();
  check(
    'a fully successful allocation logs no [ServiceJob Allocator] diagnostic at all',
    logged.length === 0
  );
}

// --- client-facing HTTP response stays generic regardless of which stage failed
{
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  };
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify() {
        return { uid: 'staff-1' };
      },
    },
    createFirestoreClient: (e) => createFirestoreClient(e),
  };
  const handler = createWorkerHandler(dependencies);
  const { logged, restore } = captureConsoleError();
  let response: Response;
  let txnSequence = 0;
  await withStubbedFetch(
    (url) => {
      if (url.pathname.includes('/staffProfiles/')) {
        return new Response(
          JSON.stringify({
            name: 'projects/test-project/databases/(default)/documents/staffProfiles/staff-1',
            fields: { brandId: { stringValue: 'bruno-thailand' } },
          }),
          { status: 200 }
        );
      }
      if (url.pathname.endsWith(':beginTransaction')) {
        return new Response(
          JSON.stringify({ transaction: `txn-${(txnSequence += 1)}` }),
          { status: 200 }
        );
      }
      if (url.pathname.endsWith(':commit')) {
        return new Response('boom', { status: 500 });
      }
      return null; // every other read (intake key, sequences, occupied-id probe): 404
    },
    async () => {
      response = await handler.fetch(
        new Request('https://worker.example/service-jobs', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
            'Idempotency-Key': '33333333-3333-4333-8333-333333333333',
          },
          body: JSON.stringify({
            intake,
            customer: { kind: 'existing', customerId: 'test-customer' },
          }),
        }),
        env,
        {} as ExecutionContext
      );
    }
  );
  restore();
  const body = (await response!.json()) as { error?: string };
  check(
    'the client-facing response is the existing generic 500, unchanged, even when the failure is a Firestore commit error',
    response!.status === 500 && body.error === 'Unable to create Service Job'
  );
  check(
    'no field of the client response reveals the internal stage or code',
    !JSON.stringify(body).includes('firestore-commit') &&
      !JSON.stringify(body).includes('http-500')
  );
  check(
    'the internal diagnostic was still logged server-side even though the client response stayed generic',
    logged.some((line) => line === '[ServiceJob Allocator] firestore-commit: http-500')
  );
}

if (failures > 0) process.exitCode = 1;
