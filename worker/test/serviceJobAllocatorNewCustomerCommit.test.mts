import { createFirestoreClient } from '../src/firestoreClient.ts';
import { allocateServiceJob } from '../src/serviceJobCreation.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';

// F5d-65 regression, same rationale as serviceJobAllocatorCommit.test.mts
// (F5d-33/F5d-34 B-1): a fake ServiceJobCreationDataAccess can prove the
// allocation *algorithm* is correct but not that the real Firestore REST
// client actually serializes the fifth (customer) write Firestore would
// accept, atomically alongside the other four, only for a brand-new
// customer, and never for an existing one. This exercises the real
// createFirestoreClient() end to end, stubbing only the network boundary.

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

const RESOURCE_NAME_PREFIX = 'projects/test-project/databases/(default)/documents/';

const intake: ServiceJobIntakePayload = {
  customerName: 'Walk-in Customer',
  customerPhone: '0891234567',
  customerEmail: 'walkin@example.com',
  product: 'QA Product',
  productCategory: 'Other',
  serialNumber: 'SERIAL-NEW-1',
  problemDescription: '',
  problemChips: [],
  accessories: [],
  internalNotes: '',
  photos: [],
  warranty: false,
};

interface CapturedRequest {
  url: URL;
  body: unknown;
}

function stubFetch(): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ url, body });
    if (url.pathname.endsWith(':beginTransaction')) {
      return new Response(JSON.stringify({ transaction: `txn-${(sequence += 1)}` }), {
        status: 200,
      });
    }
    if (url.pathname.endsWith(':commit')) {
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    // Every GET during allocation (idempotency key, both sequences, the
    // collision probe) is a fresh allocation with nothing recorded yet.
    return new Response('', { status: 404 });
  };
  return { captured, restore: () => (globalThis.fetch = originalFetch) };
}

console.log('Running Service Job allocator new-customer Firestore commit-shape regression test');

// --- 'new' customer: exactly five writes, the fifth a create-only customers/{id} ---
{
  const { captured, restore } = stubFetch();
  try {
    const client = createFirestoreClient(env);
    await allocateServiceJob({
      brandId: 'bruno-thailand',
      key: '11111111-1111-4111-8111-111111111111',
      intake,
      customer: { kind: 'new' },
      dataAccess: client,
      now: () => new Date('2026-08-16T04:00:00.000Z'),
    });

    const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
    if (!commitCall) throw new Error('no :commit request was captured');
    const body = commitCall.body as {
      writes?: { update?: { name?: string; fields?: Record<string, unknown> }; currentDocument?: { exists?: boolean } }[];
    };
    const writes = body.writes ?? [];
    check('a new-customer commit issues exactly five writes', writes.length === 5);

    const customerWrite = writes.find((write) =>
      write.update?.name?.startsWith(`${RESOURCE_NAME_PREFIX}customers/`)
    );
    check('exactly one write targets the customers collection', customerWrite !== undefined);
    check(
      'the customer write is create-only (currentDocument.exists === false)',
      customerWrite?.currentDocument?.exists === false
    );
    check(
      'the customer document id is not the phone number (never phone-as-id)',
      customerWrite !== undefined &&
        !customerWrite.update?.name?.endsWith(`/customers/${intake.customerPhone}`)
    );

    const fields = customerWrite?.update?.fields as
      | Record<string, { stringValue?: string; arrayValue?: { values?: { stringValue?: string }[] } }>
      | undefined;
    check(
      'the customer document carries name/phone/email exactly as submitted',
      fields?.name?.stringValue === intake.customerName &&
        fields?.phone?.stringValue === intake.customerPhone &&
        fields?.email?.stringValue === intake.customerEmail
    );
    check(
      'the customer document brandIds is exactly [authenticated staff brand] — never client-supplied',
      fields?.brandIds?.arrayValue?.values?.length === 1 &&
        fields.brandIds.arrayValue?.values?.[0]?.stringValue === 'bruno-thailand'
    );

    const serviceJobWrite = writes.find((write) =>
      write.update?.name?.startsWith(`${RESOURCE_NAME_PREFIX}serviceJobs/`)
    );
    check(
      'the Service Job write is still present and create-only, unaffected by the new customer write',
      serviceJobWrite !== undefined && serviceJobWrite.currentDocument?.exists === false
    );
  } finally {
    restore();
  }
}

// --- 'existing' customer: unchanged four-write commit (regression) ---
{
  const { captured, restore } = stubFetch();
  try {
    const client = createFirestoreClient(env);
    await allocateServiceJob({
      brandId: 'bruno-thailand',
      key: '22222222-2222-4222-8222-222222222222',
      intake,
      customer: { kind: 'existing', customerId: 'existing-customer-1' },
      dataAccess: client,
      now: () => new Date('2026-08-16T04:05:00.000Z'),
    });

    const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
    if (!commitCall) throw new Error('no :commit request was captured');
    const body = commitCall.body as { writes?: { update?: { name?: string } }[] };
    const names = (body.writes ?? []).map((write) => write.update?.name ?? '');

    check('an existing-customer commit still issues exactly four writes', names.length === 4);
    check(
      'no write targets the customers collection for an existing customer',
      names.every((name) => !name.startsWith(`${RESOURCE_NAME_PREFIX}customers/`))
    );
  } finally {
    restore();
  }
}

// --- legacy compatibility: the exact { intake }-only body a still-live
// older frontend sends, through the real POST /service-jobs HTTP handler ---
// (this project's own rollout history deploys Worker and frontend through
// separate, sequential gates, so a newly deployed Worker must keep serving
// this exact wire shape correctly, not just accept it structurally).
{
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify() {
        return { uid: 'staff-1' };
      },
    },
    createFirestoreClient: (e) => createFirestoreClient(e),
  };
  const handler = createWorkerHandler(dependencies);
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ url, body });
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
      return new Response(JSON.stringify({ transaction: `txn-${(sequence += 1)}` }), {
        status: 200,
      });
    }
    if (url.pathname.endsWith(':commit')) {
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;

  try {
    const response = await handler.fetch(
      new Request('https://worker.example/service-jobs', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '99999999-9999-4999-8999-999999999999',
        },
        // The legacy shape: exactly { intake }, no customer key at all.
        body: JSON.stringify({ intake }),
      }),
      env,
      {} as ExecutionContext
    );
    check('a legacy { intake }-only request still succeeds (201)', response.status === 201);

    const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
    if (!commitCall) throw new Error('no :commit request was captured');
    const body = commitCall.body as { writes?: { update?: { name?: string } }[] };
    const names = (body.writes ?? []).map((write) => write.update?.name ?? '');
    check(
      'a legacy request still issues exactly four writes — no customer document is created',
      names.length === 4 &&
        names.every((name) => !name.startsWith(`${RESOURCE_NAME_PREFIX}customers/`))
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (failures) process.exitCode = 1;
