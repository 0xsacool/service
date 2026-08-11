import { createFirestoreClient, FirestoreRequestError } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';

const docId = 'service-jobs__BRN-2026-000001__documents__uuid-file.pdf';
const deletedAt = '2026-08-09T00:00:00.000Z';
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

async function captureSuccessfulPatch(): Promise<{
  url: URL;
  init: RequestInit | undefined;
}> {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | null = null;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = new URL(typeof input === 'string' ? input : input.toString());
    capturedInit = init;
    return new Response('{}', { status: 200 });
  };

  try {
    await createFirestoreClient(env).markAttachmentDeleted(docId, deletedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!capturedUrl) {
    throw new Error('markAttachmentDeleted did not issue a request');
  }
  return { url: capturedUrl, init: capturedInit };
}

console.log('Running Firestore markAttachmentDeleted regression test');

const captured = await captureSuccessfulPatch();
check('markAttachmentDeleted uses PATCH', captured.init?.method === 'PATCH');
check(
  'targets the deterministic existing attachment document ID',
  captured.url.pathname ===
    `/v1/projects/test-project/databases/(default)/documents/serviceJobAttachments/${docId}`
);

{
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | null = null;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = new URL(typeof input === 'string' ? input : input.toString());
    capturedInit = init;
    return new Response(
      JSON.stringify({
        name: 'projects/test-project/databases/(default)/documents/serviceJobs/BRN-2026-000123',
        fields: {
          publicTrackingTokenHash: { stringValue: 'A'.repeat(43) },
          status: { stringValue: 'In Repair' },
          product: { stringValue: 'Bruno Vacuum' },
          serialNumber: { stringValue: 'SERIAL-1234' },
          updatedAt: { stringValue: '2026-08-09T00:00:00.000Z' },
          timeline: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      status: { stringValue: 'Received' },
                      date: { stringValue: '2026-08-01' },
                      time: { stringValue: '09:00' },
                      description: { stringValue: 'must never be returned publicly' },
                    },
                  },
                },
              ],
            },
          },
        },
      }),
      { status: 200 }
    );
  };
  try {
    const publicRecord = await createFirestoreClient(env).getPublicTrackingServiceJob(
      'BRN-2026-000123'
    );
    check(
      'public lookup uses one exact serviceJobs document GET, never a collection query',
      capturedUrl?.pathname ===
        '/v1/projects/test-project/databases/(default)/documents/serviceJobs/BRN-2026-000123' &&
        capturedUrl.search === '' &&
        !capturedInit?.method
    );
    check(
      'public lookup parser retains only the safe timeline fields',
      publicRecord?.timeline.length === 1 &&
        publicRecord.timeline[0]?.occurredAt === '2026-08-01T09:00' &&
        !JSON.stringify(publicRecord.timeline).includes('must never be returned publicly')
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
check(
  'updateMask contains only deletedAt',
  captured.url.searchParams.getAll('updateMask.fieldPaths').length === 1 &&
    captured.url.searchParams.get('updateMask.fieldPaths') === 'deletedAt'
);
check(
  'requires an existing Firestore document',
  captured.url.searchParams.get('currentDocument.exists') === 'true'
);
check(
  'body changes only deletedAt and carries no create or upsert fields',
  captured.init?.body ===
    JSON.stringify({ fields: { deletedAt: { stringValue: deletedAt } } })
);

{
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | null = null;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = new URL(typeof input === 'string' ? input : input.toString());
    capturedInit = init;
    return new Response('{}', { status: 200 });
  };
  try {
    await createFirestoreClient(env).writeExistingPublicTrackingTokenHash(
      'BRN-2026-000123',
      'A'.repeat(43)
    );
    check(
      'trusted issuance writer uses an existing-document PATCH for the exact Service Job',
      capturedInit?.method === 'PATCH' &&
        capturedUrl?.pathname ===
          '/v1/projects/test-project/databases/(default)/documents/serviceJobs/BRN-2026-000123' &&
        capturedUrl.searchParams.get('updateMask.fieldPaths') === 'publicTrackingTokenHash' &&
        capturedUrl.searchParams.get('currentDocument.exists') === 'true'
    );
    check(
      'trusted issuance writer sends only the token hash field',
      capturedInit?.body ===
        JSON.stringify({
          fields: { publicTrackingTokenHash: { stringValue: 'A'.repeat(43) } },
        })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('document does not exist', { status: 409 });
  let failedClosed = false;
  try {
    await createFirestoreClient(env).markAttachmentDeleted(docId, deletedAt);
  } catch (error) {
    failedClosed =
      error instanceof FirestoreRequestError &&
      error.status === 409 &&
      error.body === 'document does not exist';
  } finally {
    globalThis.fetch = originalFetch;
  }
  check('a missing-document precondition failure rejects and never succeeds', failedClosed);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
