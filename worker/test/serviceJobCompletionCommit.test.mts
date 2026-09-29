import assert from 'node:assert/strict';
import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

const captured: { url: URL; body: unknown }[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  captured.push({
    url,
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
};

try {
  const client = createFirestoreClient(env);
  await client.commitServiceJobCompletion(
    { id: 'txn-return-form' },
    {
      serviceJobId: 'BRN-2026-000777',
      brandId: 'bruno-thailand',
      returnFormNumber: 'RT-2027-000009',
      sequence: 9,
      year: 2027,
      closedAt: '2026-12-31T18:30:00.000Z',
      updatedAt: '2027-01-01',
      timeline: [
        {
          status: 'Completed',
          title: 'Completed',
          description: 'closed',
          date: '2027-01-01',
          time: '01:30',
          done: true,
        },
      ],
    }
  );

  const commit = captured.find((entry) => entry.url.pathname.endsWith(':commit'));
  assert.ok(commit, 'completion must issue one Firestore :commit');
  const body = commit.body as {
    transaction?: string;
    writes?: Array<{
      update?: {
        name?: string;
        fields?: Record<string, unknown>;
      };
      updateMask?: { fieldPaths?: string[] };
      currentDocument?: { exists?: boolean };
    }>;
  };
  assert.equal(body.transaction, 'txn-return-form');
  assert.equal(body.writes?.length, 2);

  const jobWrite = body.writes?.[0];
  const sequenceWrite = body.writes?.[1];
  assert.equal(
    jobWrite?.update?.name,
    'projects/test-project/databases/(default)/documents/serviceJobs/BRN-2026-000777'
  );
  assert.deepEqual(jobWrite?.updateMask?.fieldPaths, [
    'status',
    'closedAt',
    'updatedAt',
    'returnFormNumber',
    'timeline',
  ]);
  assert.equal(jobWrite?.currentDocument?.exists, true);
  assert.deepEqual(jobWrite?.update?.fields?.status, { stringValue: 'Completed' });
  assert.deepEqual(jobWrite?.update?.fields?.closedAt, {
    timestampValue: '2026-12-31T18:30:00.000Z',
  });
  assert.deepEqual(jobWrite?.update?.fields?.returnFormNumber, {
    stringValue: 'RT-2027-000009',
  });
  const timeline = jobWrite?.update?.fields?.timeline as {
    arrayValue?: { values?: Array<{ mapValue?: { fields?: Record<string, unknown> } }> };
  };
  assert.equal(timeline.arrayValue?.values?.length, 1);
  assert.deepEqual(timeline.arrayValue?.values?.[0]?.mapValue?.fields?.status, {
    stringValue: 'Completed',
  });

  assert.equal(
    sequenceWrite?.update?.name,
    'projects/test-project/databases/(default)/documents/numberSequences/bruno-thailand__return_form__2027'
  );
  assert.deepEqual(sequenceWrite?.update?.fields?.documentType, {
    stringValue: 'return_form',
  });
  assert.deepEqual(sequenceWrite?.update?.fields?.currentValue, {
    integerValue: '9',
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log('N7.6 Service Job completion Firestore commit-shape test passed');
