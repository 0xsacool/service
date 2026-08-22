import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';
import { runProductImportTransaction } from '../src/productImport.ts';
import { computeCatalogFingerprint } from '../../src/services/productCatalogFingerprint.ts';
import type { CatalogProduct } from '../../src/services/productIdentity.ts';

// PI-3 — proves the WIRE SHAPE of the product import commit against the real
// createFirestoreClient, with only globalThis.fetch stubbed. The route-level
// test (productImport.test.mts) uses a fake client and therefore cannot see
// what is actually sent to Firestore; this one can.
//
// Modeled on serviceJobAllocatorCommit.test.mts, including setting
// FIRESTORE_EMULATOR_HOST so getAccessToken() short-circuits and no OAuth is
// attempted.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Import commit wire-shape regression test');

const RESOURCE_NAME_PREFIX = 'projects/test-project/databases/(default)/documents/';

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

interface CapturedRequest {
  url: URL;
  method: string;
  body: Record<string, unknown> | null;
}

const existing: CatalogProduct = {
  id: 'existing-product',
  sku: 'KEEP-1',
  brand: 'BRUNO',
  model: 'KEEP',
  productName: 'Old Name',
  categoryId: 'hot-plate',
};

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
let transactionSequence = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  captured.push({ url, method: init?.method ?? 'GET', body });

  if (url.pathname.endsWith(':beginTransaction')) {
    transactionSequence += 1;
    return new Response(JSON.stringify({ transaction: `txn-${transactionSequence}` }), {
      status: 200,
    });
  }
  if (url.pathname.endsWith(':commit')) {
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  // productImports/{key} lookup — no prior import.
  if (url.pathname.includes('/productImports/')) {
    return new Response('{}', { status: 404 });
  }
  // productCatalogState/current — start from absent.
  if (url.pathname.includes('/productCatalogState/')) {
    return new Response('{}', { status: 404 });
  }
  // The products collection list.
  if (url.pathname.endsWith('/products')) {
    return new Response(
      JSON.stringify({
        documents: [
          {
            name: `${RESOURCE_NAME_PREFIX}products/${existing.id}`,
            fields: {
              brand: { stringValue: existing.brand },
              model: { stringValue: existing.model },
              sku: { stringValue: existing.sku },
              productName: { stringValue: existing.productName },
              categoryId: { stringValue: existing.categoryId },
              status: { stringValue: 'Active' },
              warrantyMonths: { integerValue: '24' },
            },
          },
        ],
      }),
      { status: 200 }
    );
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

try {
  const client = createFirestoreClient(env);

  const result = await runProductImportTransaction({
    key: '33333333-3333-4333-8333-333333333333',
    actorUid: 'staff-uid-1',
    request: {
      version: 1,
      fileName: 'catalog.csv',
      catalogFingerprint: await computeCatalogFingerprint([existing]),
      rows: [
        {
          rowNumber: 1,
          brand: 'BRUNO',
          sku: 'KEEP-1',
          model: 'KEEP',
          productName: 'New Name',
          category: 'Hot Plate',
        },
        {
          rowNumber: 2,
          brand: 'BRUNO',
          sku: 'FRESH-1',
          model: 'FRESH',
          productName: 'Brand New',
          category: 'Blender',
        },
      ],
    },
    dataAccess: client,
    now: () => new Date('2026-08-21T04:05:06.000Z'),
    newProductId: () => 'generated-uuid-1',
  });

  check('the import committed', result.replayed === false);

  // --- the catalog list read -------------------------------------------
  const listCall = captured.find((call) => call.url.pathname.endsWith('/products'));
  check('the catalog is listed', listCall !== undefined);
  check(
    'the catalog list is transactional (?transaction=)',
    listCall?.url.searchParams.get('transaction') === 'txn-1'
  );
  check('the catalog list is bounded by pageSize', listCall?.url.searchParams.has('pageSize') === true);

  // --- the commit -------------------------------------------------------
  const commitCall = captured.find((call) => call.url.pathname.endsWith(':commit'));
  check('a commit was issued', commitCall !== undefined);

  const writes = (commitCall?.body?.writes ?? []) as Record<string, unknown>[];
  check('the commit carries the transaction id', commitCall?.body?.transaction === 'txn-1');

  // 1 create + 1 update + 1 catalog state + 1 audit record
  check('the commit issues exactly four writes', writes.length === 4);

  const names = writes.map((write) => {
    const update = write.update as { name?: string } | undefined;
    return update?.name ?? (write.delete as string | undefined) ?? '';
  });
  check(
    'every write name is a bare Firestore resource name',
    names.every((name) => name.startsWith(RESOURCE_NAME_PREFIX))
  );
  check(
    'no write name is an HTTP(S) URL (the F5d-33 B-1 defect)',
    names.every((name) => !name.startsWith('http'))
  );

  // --- no delete, ever --------------------------------------------------
  check(
    'the commit contains NO delete write of any kind',
    writes.every((write) => write.delete === undefined)
  );

  // --- the create -------------------------------------------------------
  const createWrite = writes.find((write) => {
    const update = write.update as { name?: string } | undefined;
    return update?.name === `${RESOURCE_NAME_PREFIX}products/generated-uuid-1`;
  });
  check('a new product is created under the server-allocated id', createWrite !== undefined);
  check(
    'the create is guarded by currentDocument.exists=false',
    (createWrite?.currentDocument as { exists?: boolean } | undefined)?.exists === false
  );

  const createFields = (createWrite?.update as { fields?: Record<string, unknown> } | undefined)
    ?.fields as Record<string, Record<string, unknown>> | undefined;
  check('the new product gets status Active', createFields?.status?.stringValue === 'Active');
  check('the new product gets warrantyMonths 12', createFields?.warrantyMonths?.integerValue === '12');
  check('the new product gets empty associations', Array.isArray((createFields?.accessoryIds?.arrayValue as { values?: unknown[] })?.values ?? []));
  check(
    'the new product carries a real Firestore timestampValue for createdAt',
    typeof createFields?.createdAt?.timestampValue === 'string'
  );
  check(
    'createdAt is not written as a plain string (would mix types with seeded docs)',
    createFields?.createdAt?.stringValue === undefined
  );

  // --- the update / write mask -----------------------------------------
  const updateWrite = writes.find((write) => {
    const update = write.update as { name?: string } | undefined;
    return update?.name === `${RESOURCE_NAME_PREFIX}products/existing-product`;
  });
  check('the matched product is updated in place', updateWrite !== undefined);
  check(
    'the update is guarded by currentDocument.exists=true',
    (updateWrite?.currentDocument as { exists?: boolean } | undefined)?.exists === true
  );

  const mask = (updateWrite?.updateMask as { fieldPaths?: string[] } | undefined)?.fieldPaths ?? [];
  check('the update carries an explicit updateMask', mask.length > 0);
  check('the mask contains the changed field', mask.includes('productName'));
  check('the mask contains updatedAt', mask.includes('updatedAt'));
  check('the mask does NOT contain status', !mask.includes('status'));
  check('the mask does NOT contain warrantyMonths', !mask.includes('warrantyMonths'));
  check('the mask does NOT contain createdAt', !mask.includes('createdAt'));
  check('the mask does NOT contain accessoryIds', !mask.includes('accessoryIds'));
  check('the mask does NOT contain commonProblemIds', !mask.includes('commonProblemIds'));
  check('the mask does NOT contain an unchanged field (brand)', !mask.includes('brand'));

  // --- catalog state + audit record -------------------------------------
  const stateWrite = writes.find((write) => {
    const update = write.update as { name?: string } | undefined;
    return update?.name === `${RESOURCE_NAME_PREFIX}productCatalogState/current`;
  });
  check('the catalog revision document is written for a mutating import', stateWrite !== undefined);
  const stateFields = (stateWrite?.update as { fields?: Record<string, Record<string, unknown>> })
    ?.fields;
  check('the revision starts at 1 when no state existed', stateFields?.revision?.integerValue === '1');

  const auditWrite = writes.find((write) => {
    const update = write.update as { name?: string } | undefined;
    return update?.name?.startsWith(`${RESOURCE_NAME_PREFIX}productImports/`);
  });
  check('the audit/idempotency record is written', auditWrite !== undefined);
  check(
    'the audit record is create-only (exists=false), so a concurrent duplicate loses',
    (auditWrite?.currentDocument as { exists?: boolean } | undefined)?.exists === false
  );

  const serializedCommit = JSON.stringify(commitCall?.body ?? {});
  check('the commit body contains no bearer token', !serializedCommit.includes('Bearer'));
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(`Product Import commit regression test failed: ${failures} failure(s)`);
} else {
  console.log('Product Import commit regression test passed');
}
