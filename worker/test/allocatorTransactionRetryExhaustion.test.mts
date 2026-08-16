import {
  allocateServiceJob,
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
  type ServiceJobCreationDataAccess,
} from '../src/serviceJobCreation.ts';
import { createFirestoreClient } from '../src/firestoreClient.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

// F5d-59. Terra's background finding: TransactionConflictError is
// intentionally never logged by logAllocatorStageFailure() (canonical
// ABORTED is expected, retried optimistic-concurrency behavior, not a genuine
// failure) — but that same unconditional skip also silences the FINAL
// attempt's TransactionConflictError once allocateServiceJob()'s retry
// loop gives up and rethrows it unchanged, so genuine retry exhaustion
// could reach the client as an unattributed generic 500 exactly like the
// blind spots F5d-56/56B/56D closed elsewhere. This proves: normal
// retried conflicts stay silent (A, B), genuine exhaustion logs exactly
// one sanitized line (C, D), and the real Firestore REST layer + Worker
// HTTP handler behave identically end to end (E2E).

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running allocator transaction retry exhaustion diagnostic test');

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

// Conflicts on commit exactly `conflictsBeforeSuccess` times, then
// succeeds — or, when conflictsBeforeSuccess >= MAX_TRANSACTION_RETRIES,
// conflicts on every single attempt (never succeeds). Exercises
// allocateServiceJob()'s real retry loop directly — the exact code F5d-59
// modifies — rather than the Firestore REST layer beneath it.
class FakeStore implements ServiceJobCreationDataAccess {
  commitAttempts = 0;
  committed = false;
  readonly conflictsBeforeSuccess: number;
  constructor(conflictsBeforeSuccess: number) {
    this.conflictsBeforeSuccess = conflictsBeforeSuccess;
  }
  async beginServiceJobTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getIntakeKey(): Promise<string | null> {
    return null;
  }
  async getSequence(): Promise<number | null> {
    return 0;
  }
  async getServiceJob(): Promise<ServiceJob | null> {
    return null;
  }
  async serviceJobExists(): Promise<boolean> {
    return false;
  }
  async commitServiceJobCreation(): Promise<void> {
    this.commitAttempts += 1;
    if (this.commitAttempts <= this.conflictsBeforeSuccess) {
      throw new TransactionConflictError();
    }
    this.committed = true;
  }
}

function runAllocation(
  store: FakeStore,
  key: string,
  overrideIntake: ServiceJobIntakePayload = intake
) {
  return allocateServiceJob({
    brandId: 'bruno-thailand',
    key,
    intake: overrideIntake,
    dataAccess: store,
    now: () => new Date('2026-08-13T10:00:00.000Z'),
  });
}

// --- A. first conflict, then success ----------------------------------------
{
  const store = new FakeStore(1);
  const { logged, restore } = captureConsoleError();
  let job: ServiceJob | undefined;
  let threw = false;
  try {
    job = await runAllocation(store, '11111111-1111-4111-8111-111111111111');
  } catch {
    threw = true;
  }
  restore();
  check(
    'A: allocation succeeds after exactly one retried conflict',
    !threw && job !== undefined && store.commitAttempts === 2 && store.committed
  );
  check(
    'A: no [ServiceJob Allocator] diagnostic is logged for a single retried conflict',
    !logged.some((line) => line.startsWith('[ServiceJob Allocator]'))
  );
}

// --- B. several conflicts, then success before exhaustion --------------------
{
  check(
    'sanity: MAX_TRANSACTION_RETRIES leaves room for multiple conflicts before exhaustion',
    MAX_TRANSACTION_RETRIES > 2
  );
  const conflictsBeforeSuccess = MAX_TRANSACTION_RETRIES - 1; // succeeds on the last allowed attempt
  const store = new FakeStore(conflictsBeforeSuccess);
  const { logged, restore } = captureConsoleError();
  let job: ServiceJob | undefined;
  let threw = false;
  try {
    job = await runAllocation(store, '22222222-2222-4222-8222-222222222222');
  } catch {
    threw = true;
  }
  restore();
  check(
    'B: allocation succeeds on the final allowed attempt after repeated conflicts',
    !threw &&
      job !== undefined &&
      store.commitAttempts === MAX_TRANSACTION_RETRIES &&
      store.committed
  );
  check(
    'B: no [ServiceJob Allocator] diagnostic is logged when exhaustion is narrowly avoided',
    !logged.some((line) => line.startsWith('[ServiceJob Allocator]'))
  );
}

// --- C. all retries conflict (genuine exhaustion) -----------------------------
{
  const store = new FakeStore(MAX_TRANSACTION_RETRIES); // conflicts on every attempt
  const { logged, restore } = captureConsoleError();
  let threw = false;
  let caughtError: unknown;
  try {
    await runAllocation(store, '33333333-3333-4333-8333-333333333333');
  } catch (error) {
    threw = true;
    caughtError = error;
  }
  restore();
  check('C: allocation still rejects once every retry is exhausted', threw);
  check(
    'C: the rejection is the ORIGINAL TransactionConflictError, never wrapped/replaced',
    caughtError instanceof TransactionConflictError
  );
  check(
    'C: the retry loop made exactly MAX_TRANSACTION_RETRIES commit attempts, no more',
    store.commitAttempts === MAX_TRANSACTION_RETRIES
  );
  check(
    'C: zero partial writes — commitServiceJobCreation never recorded a successful commit',
    !store.committed
  );
  const allocatorLines = logged.filter((line) =>
    line.startsWith('[ServiceJob Allocator]')
  );
  check(
    'C: exactly ONE [ServiceJob Allocator] diagnostic line is emitted for the whole exhausted sequence',
    allocatorLines.length === 1
  );
  check(
    'C: the one line is attributed to stage firestore-commit with code transaction-retries-exhausted',
    allocatorLines[0] ===
      '[ServiceJob Allocator] firestore-commit: transaction-retries-exhausted'
  );
}

// --- D. sanitization — the exhaustion line carries no dynamic content at all --
{
  const secretPhone = '0899999999';
  const secretUuid = '44444444-4444-4444-8444-444444444444';
  const secretToken = 'Bearer ey.raw.jwt.should.never.appear';
  const secretDocPath = 'serviceJobs/BRN-2026-000099';
  const piiIntake: ServiceJobIntakePayload = {
    ...intake,
    customerName: 'PII Customer',
    customerPhone: secretPhone,
    problemDescription: `Customer reports issue, phone ${secretPhone}`,
  };
  const store = new FakeStore(MAX_TRANSACTION_RETRIES);
  const { logged, restore } = captureConsoleError();
  try {
    await runAllocation(store, secretUuid, piiIntake);
  } catch {
    // expected — exhaustion
  }
  restore();
  check(
    'D: the exhaustion diagnostic is the fixed literal string alone, with no document path, token, request body, PII, or intake UUID',
    logged.length === 1 &&
      logged[0] ===
        '[ServiceJob Allocator] firestore-commit: transaction-retries-exhausted' &&
      !logged[0].includes(secretPhone) &&
      !logged[0].includes(secretUuid) &&
      !logged[0].includes(secretToken) &&
      !logged[0].includes(secretDocPath) &&
      !logged[0].includes('PII Customer')
  );
}

// --- E2E: real Firestore REST layer + real Worker HTTP handler ---------------
// Proves the same exhaustion diagnostic and generic client response hold
// through the actual createFirestoreClient()/createWorkerHandler() stack —
// not just the in-memory FakeStore above — and that exactly
// MAX_TRANSACTION_RETRIES `:commit` REST calls occur against Firestore, no
// more, no fewer, each rejected with canonical ABORTED over HTTP 409.
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
  let commitAttempts = 0;
  let txnSequence = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
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
      return new Response(JSON.stringify({ transaction: `txn-${(txnSequence += 1)}` }), {
        status: 200,
      });
    }
    if (url.pathname.endsWith(':commit')) {
      commitAttempts += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 409,
            status: 'ABORTED',
            message: 'transaction contention',
          },
        }),
        { status: 409 }
      );
    }
    return new Response('', { status: 404 }); // every read: nothing recorded yet
  }) as typeof fetch;
  let response: Response;
  try {
    response = await handler.fetch(
      new Request('https://worker.example/service-jobs', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '55555555-5555-4555-8555-555555555555',
        },
        body: JSON.stringify({
          intake,
          customer: { kind: 'existing', customerId: 'test-customer' },
        }),
      }),
      env,
      {} as ExecutionContext
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
  const body = (await response!.json()) as { error?: string };
  check(
    'E2E: the client-facing response is the existing generic 500, unchanged, even on genuine retry exhaustion',
    response!.status === 500 && body.error === 'Unable to create Service Job'
  );
  check(
    'E2E: no field of the client response reveals the internal stage/code',
    !JSON.stringify(body).includes('firestore-commit') &&
      !JSON.stringify(body).includes('transaction-retries-exhausted')
  );
  check(
    'E2E: exactly MAX_TRANSACTION_RETRIES :commit attempts occurred against the real Firestore REST layer, no more',
    commitAttempts === MAX_TRANSACTION_RETRIES
  );
  const allocatorLines = logged.filter((line) =>
    line.startsWith('[ServiceJob Allocator]')
  );
  check(
    'E2E: exactly one allocator diagnostic line is emitted server-side, attributed to firestore-commit: transaction-retries-exhausted',
    allocatorLines.length === 1 &&
      allocatorLines[0] ===
        '[ServiceJob Allocator] firestore-commit: transaction-retries-exhausted'
  );
}

// --- E2E fail-fast: canonical ALREADY_EXISTS is not retryable ---------------
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
  let commitAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
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
      return new Response(JSON.stringify({ transaction: 'txn-already-exists' }), {
        status: 200,
      });
    }
    if (url.pathname.endsWith(':commit')) {
      commitAttempts += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 409,
            status: 'ALREADY_EXISTS',
            message: 'hostile customers/0899999999 Bearer secret-value',
          },
        }),
        { status: 409 }
      );
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  let response: Response;
  try {
    response = await handler.fetch(
      new Request('https://worker.example/service-jobs', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '66666666-6666-4666-8666-666666666666',
        },
        body: JSON.stringify({
          intake,
          customer: { kind: 'existing', customerId: 'test-customer' },
        }),
      }),
      env,
      {} as ExecutionContext
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
  const body = (await response!.json()) as { error?: string };
  check(
    'E2E ALREADY_EXISTS: the existing generic client failure is preserved',
    response!.status === 500 && body.error === 'Unable to create Service Job'
  );
  check(
    'E2E ALREADY_EXISTS: exactly one commit attempt occurs, with no retry',
    commitAttempts === 1
  );
  const allocatorLines = logged.filter((line) =>
    line.startsWith('[ServiceJob Allocator]')
  );
  check(
    'E2E ALREADY_EXISTS: one sanitized fail-fast diagnostic is emitted',
    allocatorLines.length === 1 &&
      allocatorLines[0] === '[ServiceJob Allocator] firestore-commit: ALREADY_EXISTS'
  );
  check(
    'E2E ALREADY_EXISTS: transaction-retries-exhausted is never emitted',
    !logged.some((line) => line.includes('transaction-retries-exhausted'))
  );
  check(
    'E2E ALREADY_EXISTS: hostile response text and request identifiers are absent from logs',
    !logged.some(
      (line) =>
        line.includes('0899999999') ||
        line.includes('secret-value') ||
        line.includes('66666666-6666-4666-8666-666666666666')
    )
  );
}

if (failures > 0) process.exitCode = 1;
