import { createFirestoreClient } from '../src/firestoreClient.ts';
import { allocateServiceJob } from '../src/serviceJobCreation.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';

// F5d-33/F5d-34 B-1 regression: worker/test/serviceJobCreation.test.mts only
// ever drives allocateServiceJob() against a hand-rolled fake
// ServiceJobCreationDataAccess — it can prove the allocation *algorithm* is
// correct but cannot prove the real Firestore REST client serializes a
// commit Firestore will actually accept. That gap is exactly how F5d-33
// found `update.name` built as a full URL (`${baseUrl}/serviceJobs/{id}`)
// instead of a bare resource name — Firestore rejected it with a 400
// ("lacks \"projects\" at index 0") before Rules/IAM were ever reached. This
// test exercises the real createFirestoreClient() implementation end to
// end, only stubbing the network boundary — the same pattern already used
// by firestoreClientMarkDeleted.test.mts — and asserts every write in the
// captured :commit body names a bare Firestore resource path, never a URL.

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
  url: URL;
  body: unknown;
}

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
let sequence = 0;

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  captured.push({ url, body });

  if (url.pathname.endsWith(':beginTransaction')) {
    return new Response(JSON.stringify({ transaction: `txn-${sequence += 1}` }), {
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

console.log('Running Service Job allocator Firestore commit-shape regression test');

try {
  const client = createFirestoreClient(env);
  const job = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111',
    intake,
    dataAccess: client,
    now: () => new Date('2026-08-11T10:00:00.000Z'),
  });

  check('allocation completed and returned the created job', job.id === 'BRN-2026-000001');

  const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
  if (!commitCall) throw new Error('no :commit request was captured');

  const body = commitCall.body as { writes?: { update?: { name?: string } }[] };
  const names = (body.writes ?? []).map((write) => write.update?.name ?? '');

  check('commit issues exactly four writes', names.length === 4);
  check(
    'every write.update.name is a bare Firestore resource name',
    names.every((name) => name.startsWith(RESOURCE_NAME_PREFIX))
  );
  check(
    'no write.update.name is an HTTP(S) URL (the F5d-33 defect)',
    names.every((name) => !name.startsWith('http'))
  );
  check(
    'the Service Job write targets the allocated document ID',
    names.includes(`${RESOURCE_NAME_PREFIX}serviceJobs/BRN-2026-000001`)
  );
  check(
    'the idempotency key write targets the submitted key',
    names.includes(
      `${RESOURCE_NAME_PREFIX}serviceJobIntakeKeys/11111111-1111-4111-8111-111111111111`
    )
  );
  check(
    'both sequence writes target the Bangkok-year sequence documents',
    names.includes(`${RESOURCE_NAME_PREFIX}numberSequences/bruno-thailand__tracking_number__2026`) &&
      names.includes(`${RESOURCE_NAME_PREFIX}numberSequences/bruno-thailand__service_request__2026`)
  );

  const createOnlyWrites = (body.writes ?? []).filter(
    (write) =>
      write.update?.name === `${RESOURCE_NAME_PREFIX}serviceJobs/BRN-2026-000001` ||
      write.update?.name ===
        `${RESOURCE_NAME_PREFIX}serviceJobIntakeKeys/11111111-1111-4111-8111-111111111111`
  ) as { currentDocument?: { exists?: boolean } }[];
  check(
    'the Service Job and idempotency writes are create-only (exists: false)',
    createOnlyWrites.length === 2 &&
      createOnlyWrites.every((write) => write.currentDocument?.exists === false)
  );
} finally {
  globalThis.fetch = originalFetch;
}

if (failures) process.exitCode = 1;
