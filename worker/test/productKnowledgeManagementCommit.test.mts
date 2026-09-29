import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';
import { TransactionConflictError } from '../src/serviceJobCreation.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Knowledge Firestore wire-shape tests');

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

const captured: Array<Record<string, unknown>> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  captured.push(init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {});
  return new Response('{}', { status: 200 });
}) as typeof fetch;

try {
  const client = createFirestoreClient(env);

  await client.commitAccessoryCreate(
    { id: 'tx-accessory' },
    {
      productId: 'product-1',
      accessory: { id: 'acc-1', label: 'ฝา' },
      accessoryIds: ['acc-1'],
      now: '2026-09-29T17:00:00.000Z',
    }
  );

  const accessoryBody = captured.at(-1)!;
  const accessoryWrites = accessoryBody.writes as Array<Record<string, any>>;
  check('accessory create is one atomic Firestore commit', accessoryWrites.length === 2);
  check(
    'accessory definition uses create precondition',
    accessoryWrites[0]?.currentDocument?.exists === false
  );
  check(
    'accessory definition targets accessories collection',
    String(accessoryWrites[0]?.update?.name ?? '').endsWith('/accessories/acc-1')
  );
  check(
    'accessory create updates product association in same commit',
    String(accessoryWrites[1]?.update?.name ?? '').endsWith('/products/product-1')
  );
  check(
    'accessory association update mask is narrow',
    JSON.stringify(accessoryWrites[1]?.updateMask?.fieldPaths) ===
      JSON.stringify(['accessoryIds', 'updatedAt'])
  );

  await client.commitCommonProblemCreate(
    { id: 'tx-problem' },
    {
      productId: 'product-1',
      problem: {
        id: 'problem-1',
        label: 'เตาไม่ร้อน',
        status: 'Active',
        description: 'ตรวจฮีตเตอร์',
      },
      commonProblemIds: ['problem-1'],
      now: '2026-09-29T17:01:00.000Z',
    }
  );
  const problemBody = captured.at(-1)!;
  const problemWrites = problemBody.writes as Array<Record<string, any>>;
  check('common problem create is atomic definition + association', problemWrites.length === 2);
  check(
    'common problem targets commonProblems collection',
    String(problemWrites[0]?.update?.name ?? '').endsWith('/commonProblems/problem-1')
  );
  check(
    'common problem association uses narrow mask',
    JSON.stringify(problemWrites[1]?.updateMask?.fieldPaths) ===
      JSON.stringify(['commonProblemIds', 'updatedAt'])
  );

  await client.commitProductKnowledgeAssociation(
    { id: 'tx-association' },
    {
      productId: 'product-1',
      field: 'accessoryIds',
      ids: ['acc-1', 'acc-2'],
      now: '2026-09-29T17:02:00.000Z',
    }
  );
  const associationBody = captured.at(-1)!;
  const associationWrites = associationBody.writes as Array<Record<string, any>>;
  check('association-only update writes exactly one Product document', associationWrites.length === 1);
  check(
    'association-only update cannot overwrite unrelated Product fields',
    JSON.stringify(associationWrites[0]?.updateMask?.fieldPaths) ===
      JSON.stringify(['accessoryIds', 'updatedAt'])
  );
  check(
    'association-only update requires Product to exist',
    associationWrites[0]?.currentDocument?.exists === true
  );

  await client.commitCommonProblemUpdate(
    { id: 'tx-problem-update' },
    {
      problem: {
        id: 'problem-1',
        label: 'ไฟไม่เข้า',
        status: 'Inactive',
      },
      now: '2026-09-29T17:03:00.000Z',
    }
  );
  const updateBody = captured.at(-1)!;
  const updateWrites = updateBody.writes as Array<Record<string, any>>;
  check('common problem update writes exactly one definition', updateWrites.length === 1);
  check(
    'common problem update mask is narrow',
    JSON.stringify(updateWrites[0]?.updateMask?.fieldPaths) ===
      JSON.stringify(['label', 'status', 'description', 'updatedAt'])
  );
  check(
    'common problem update requires existing definition',
    updateWrites[0]?.currentDocument?.exists === true
  );

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { status: 'ABORTED' } }), {
      status: 409,
    })) as typeof fetch;
  let conflict = false;
  try {
    await client.commitProductKnowledgeAssociation(
      { id: 'tx-conflict' },
      {
        productId: 'product-1',
        field: 'commonProblemIds',
        ids: ['problem-1'],
        now: '2026-09-29T17:04:00.000Z',
      }
    );
  } catch (error) {
    conflict = error instanceof TransactionConflictError;
  }
  check('Firestore ABORTED maps to retryable transaction conflict', conflict);
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  console.error(`Product Knowledge Firestore wire-shape tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Knowledge Firestore wire-shape tests passed');
}
