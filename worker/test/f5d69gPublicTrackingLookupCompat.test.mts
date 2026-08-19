import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { PublicTrackingServiceJobRecord, PublicTrackingCodeLookupRecord } from '../src/publicTracking.ts';
import { hashPublicTrackingCode } from '../../src/services/publicTrackingCode.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running F5d-69G public tracking lookup forward-compatibility/privacy regression test');

interface FakeState {
  records: Map<string, PublicTrackingServiceJobRecord>;
  codeIndex: Map<string, PublicTrackingCodeLookupRecord>;
  lookups: string[];
  codeLookups: string[];
}

function createHandler(state: FakeState) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: { async verify() { throw new Error('not used'); } },
    createFirestoreClient: () =>
      ({
        async getPublicTrackingServiceJob(reference: string) {
          state.lookups.push(reference);
          return state.records.get(reference) ?? null;
        },
        async getPublicTrackingCode(code: string) {
          state.codeLookups.push(code);
          return state.codeIndex.get(code) ?? null;
        },
      }) as unknown as FirestoreClient,
    publicTrackingRateLimiter: { async allow() { return true; } },
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    PUBLIC_TRACKING_ENABLED: 'true',
  };
  return { handler: createWorkerHandler(dependencies), env };
}

function makeRecord(id: string, codeHash: string): PublicTrackingServiceJobRecord {
  return {
    id,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: codeHash,
    status: 'In Repair',
    productName: 'Bruno Vacuum',
    productModelOrSku: 'BR-100',
    serialNumber: 'SERIAL-9999',
    timeline: [{ status: 'Received', occurredAt: '2026-08-19T09:00' }],
    updatedAt: '2026-08-19T10:00:00.000Z',
  };
}

function lookupCodeRequest(code: string): Request {
  return new Request('https://worker.example/public/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

// --- D: an opaque/alphanumeric future-style Service Job id (not the
// sequential BRN-YYYY-NNNNNN shape) does not break the lookup ---
{
  const futureStyleId = 'BRN-2026-A7K29Q';
  const code = 'SRV-2026-0819-K7M2QX';
  const codeHash = await hashPublicTrackingCode(code);
  const state: FakeState = {
    records: new Map([[futureStyleId, makeRecord(futureStyleId, codeHash)]]),
    codeIndex: new Map([[code, { serviceJobId: futureStyleId }]]),
    lookups: [],
    codeLookups: [],
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(lookupCodeRequest(code), env, {} as ExecutionContext);
  const payload = (await response.json()) as Record<string, unknown>;
  check(
    'a valid SRV code resolves the approved public projection for an opaque/random-style Service Job id',
    response.status === 200 && payload.trackingReference === futureStyleId
  );
  check(
    'the lookup path performed one direct index lookup and one exact-id Service Job read, never a scan/query',
    state.codeLookups.length === 1 && state.lookups.length === 1 && state.lookups[0] === futureStyleId
  );
}

// --- D: today's sequential id shape still works identically (no regression) ---
{
  const sequentialId = 'BRN-2026-000006';
  const code = 'SRV-2026-0819-A1B2C3';
  const codeHash = await hashPublicTrackingCode(code);
  const state: FakeState = {
    records: new Map([[sequentialId, makeRecord(sequentialId, codeHash)]]),
    codeIndex: new Map([[code, { serviceJobId: sequentialId }]]),
    lookups: [],
    codeLookups: [],
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(lookupCodeRequest(code), env, {} as ExecutionContext);
  const payload = (await response.json()) as Record<string, unknown>;
  check(
    "today's sequential BRN-YYYY-NNNNNN id shape resolves identically, unaffected by opaque-id support",
    response.status === 200 && payload.trackingReference === sequentialId
  );
}

// --- D: the sequential Service Job ID itself is never usable as a public
// credential (the manual-code endpoint requires the SRV format) ---
{
  const state: FakeState = {
    records: new Map([['BRN-2026-000006', makeRecord('BRN-2026-000006', 'irrelevant-hash')]]),
    codeIndex: new Map(),
    lookups: [],
    codeLookups: [],
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(lookupCodeRequest('BRN-2026-000006'), env, {} as ExecutionContext);
  check(
    'a sequential Service Job ID submitted as if it were a public code fails generically before any lookup',
    response.status === 404 && state.codeLookups.length === 0
  );
}

// --- E: privacy — the approved public DTO never carries brandId, customer
// PII, or either hash, even though the underlying record has them ---
{
  const jobId = 'BRN-2026-000006';
  const code = 'SRV-2026-0819-Z9Y8X7';
  const codeHash = await hashPublicTrackingCode(code);
  const record: PublicTrackingServiceJobRecord & { brandId?: string; customerName?: string } = {
    ...makeRecord(jobId, codeHash),
  };
  const state: FakeState = {
    records: new Map([[jobId, record]]),
    codeIndex: new Map([[code, { serviceJobId: jobId }]]),
    lookups: [],
    codeLookups: [],
  };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(lookupCodeRequest(code), env, {} as ExecutionContext);
  const payload = (await response.json()) as Record<string, unknown>;
  check(
    'the public DTO exposes only the approved allowlisted keys — no brandId, no customer fields, no hashes',
    JSON.stringify(Object.keys(payload).sort()) ===
      JSON.stringify(['lastUpdatedAt', 'maskedSerial', 'productModelOrSku', 'productName', 'publicTimeline', 'status', 'trackingReference'])
  );
  check(
    'the serial number is masked, the full value never appears in the response',
    !JSON.stringify(payload).includes('SERIAL-9999')
  );
  check(
    'neither the code nor its hash ever appears anywhere in the response body',
    !JSON.stringify(payload).includes(code) && !JSON.stringify(payload).includes(codeHash)
  );
}

// --- E: no collection-wide listing capability exists on this lookup path —
// a code/reference that does not exist fails exactly like a wrong one ---
{
  const state: FakeState = { records: new Map(), codeIndex: new Map(), lookups: [], codeLookups: [] };
  const { handler, env } = createHandler(state);
  const response = await handler.fetch(lookupCodeRequest('SRV-2026-0819-000000'), env, {} as ExecutionContext);
  check('an unknown code fails generically (404), identical shape to any other rejection', response.status === 404);
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(
    `F5d-69G public tracking lookup compat/privacy regression test failed: ${failures} failure(s)`
  );
} else {
  console.log('F5d-69G public tracking lookup compat/privacy regression test passed');
}
