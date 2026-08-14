import { createFirestoreClient } from '../src/firestoreClient.ts';
import { allocateServiceJob } from '../src/serviceJobCreation.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';

// F5d-56, Objective 7. Independent, strengthened verification of the
// occupied-ID skip path against the real createFirestoreClient()
// implementation (only the network boundary stubbed) — the exact scenario
// this whole incident traced back to (BRN-2026-000001 protected/occupied,
// BRN-2026-000002 the expected next allocation). Proves, with GET/PATCH-
// level request capture rather than only the final returned job.id:
//   - the occupied BRN-2026-000001 is read (a GET), never written
//   - the allocator selects BRN-2026-000002
//   - the tracking sequence becomes 2 only inside the successful :commit
//   - the protected existing record is never part of the commit write set

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
const OCCUPIED_ID = 'BRN-2026-000001';

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

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
let txnSequence = 0;

// The occupied-legacy-record's Firestore document — served on every GET
// for its exact ID, exactly like a real prior Service Job would be.
const occupiedDocument = {
  name: `${RESOURCE_NAME_PREFIX}serviceJobs/${OCCUPIED_ID}`,
  fields: {
    customerName: { stringValue: 'Legacy Customer' },
    status: { stringValue: 'Received' },
  },
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  captured.push({ method, url, body });

  if (url.pathname.endsWith(':beginTransaction')) {
    return new Response(JSON.stringify({ transaction: `txn-${(txnSequence += 1)}` }), {
      status: 200,
    });
  }
  if (url.pathname.endsWith(':commit')) {
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  if (url.pathname.endsWith(`/serviceJobs/${OCCUPIED_ID}`)) {
    return new Response(JSON.stringify(occupiedDocument), { status: 200 });
  }
  // Every other read (idempotency key, both sequences, BRN-2026-000002's
  // own collision probe): nothing recorded yet.
  return new Response('', { status: 404 });
}) as typeof fetch;

console.log('Running allocator occupied-ID skip regression test');

try {
  const client = createFirestoreClient(env);
  const job = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111',
    intake,
    dataAccess: client,
    now: () => new Date('2026-08-11T10:00:00.000Z'),
  });

  check(
    'the allocator selects BRN-2026-000002, skipping the occupied unbranded legacy 000001',
    job.id === 'BRN-2026-000002'
  );
  check(
    'the allocated job carries the expected Service Request number SR-2026-000001',
    job.serviceRequestNumber === 'SR-2026-000001'
  );

  const occupiedIdRequests = captured.filter((call) =>
    call.url.pathname.endsWith(`/serviceJobs/${OCCUPIED_ID}`)
  );
  check(
    'the occupied ID was read at least once during the collision probe',
    occupiedIdRequests.length >= 1
  );
  check(
    'every request touching the occupied ID was a read (GET), never a write method',
    occupiedIdRequests.every((call) => call.method === 'GET' || call.method === undefined)
  );

  const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
  if (!commitCall) throw new Error('no :commit request was captured');
  const body = commitCall.body as {
    writes?: { update?: { name?: string; fields?: Record<string, unknown> } }[];
  };
  const writes = body.writes ?? [];
  const names = writes.map((write) => write.update?.name ?? '');

  check(
    'the protected occupied record is never part of the commit write set',
    !names.includes(`${RESOURCE_NAME_PREFIX}serviceJobs/${OCCUPIED_ID}`)
  );
  check(
    'the commit writes the newly allocated BRN-2026-000002 Service Job, not the occupied one',
    names.includes(`${RESOURCE_NAME_PREFIX}serviceJobs/BRN-2026-000002`)
  );

  const trackingSequenceWrite = writes.find(
    (write) =>
      write.update?.name ===
      `${RESOURCE_NAME_PREFIX}numberSequences/bruno-thailand__tracking_number__2026`
  );
  if (!trackingSequenceWrite)
    throw new Error('no tracking-number sequence write was captured');
  const currentValueField = trackingSequenceWrite.update?.fields?.currentValue as
    { integerValue?: string } | undefined;
  check(
    'the tracking sequence document is written as 2 (the allocated 000002 sequence), inside the atomic commit',
    currentValueField?.integerValue === '2'
  );

  const serviceRequestSequenceWrite = writes.find(
    (write) =>
      write.update?.name ===
      `${RESOURCE_NAME_PREFIX}numberSequences/bruno-thailand__service_request__2026`
  );
  if (!serviceRequestSequenceWrite)
    throw new Error('no service-request sequence write was captured');
  const serviceRequestCurrentValueField = serviceRequestSequenceWrite.update?.fields
    ?.currentValue as { integerValue?: string } | undefined;
  check(
    'the Service Request sequence document is written as 1 (unaffected by the tracking-ID collision), inside the same atomic commit',
    serviceRequestCurrentValueField?.integerValue === '1'
  );

  // The sequence write is only ever captured inside the :commit body above
  // — there is no separate/earlier PATCH or update call to the sequence
  // document anywhere in the captured request log, confirming the
  // sequence only "becomes 2" as part of the one atomic commit, not as a
  // side effect of the read/probe phase.
  const sequenceWritesOutsideCommit = captured.filter(
    (call) =>
      call.url.pathname.includes('numberSequences') &&
      call.method !== 'GET' &&
      !call.url.pathname.endsWith(':commit')
  );
  check(
    'no sequence write happens outside the atomic commit',
    sequenceWritesOutsideCommit.length === 0
  );
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) process.exitCode = 1;
