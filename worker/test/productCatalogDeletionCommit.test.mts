import { createFirestoreClient } from '../src/firestoreClient.ts';
import { deleteProductSafely } from '../src/productCatalogDeletion.ts';
import type { Env } from '../src/env.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Catalog delete Firestore transaction wire test');

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

const captured: Array<{ url: URL; method: string; body: any }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  captured.push({ url, method, body });

  if (url.pathname.endsWith(':beginTransaction')) {
    return new Response(JSON.stringify({ transaction: 'txn-delete-1' }), { status: 200 });
  }
  if (url.pathname.endsWith('/products/product-1')) {
    return new Response(JSON.stringify({
      name: 'projects/test-project/databases/(default)/documents/products/product-1',
      fields: {
        status: { stringValue: 'Legacy' },
        referenceTrackingVersion: { integerValue: '1' },
      },
    }), { status: 200 });
  }
  if (url.pathname.endsWith(':runQuery')) {
    return new Response(JSON.stringify([{ readTime: '2026-09-29T08:00:00Z' }]), { status: 200 });
  }
  if (url.pathname.endsWith('/productCatalogState/current')) {
    return new Response(JSON.stringify({
      name: 'projects/test-project/databases/(default)/documents/productCatalogState/current',
      fields: { revision: { integerValue: '4' } },
    }), { status: 200 });
  }
  if (url.pathname.endsWith(':commit')) {
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

try {
  const client = createFirestoreClient(env);
  await deleteProductSafely({
    productId: 'product-1',
    dataAccess: client,
    now: () => new Date('2026-09-29T08:00:00.000Z'),
  });

  const query = captured.find((call) => call.url.pathname.endsWith(':runQuery'));
  check('reference query runs inside the same transaction', query?.body?.transaction === 'txn-delete-1');
  check(
    'reference query targets serviceJobs.catalogProductId with limit 1',
    query?.body?.structuredQuery?.from?.[0]?.collectionId === 'serviceJobs' &&
      query?.body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath === 'catalogProductId' &&
      query?.body?.structuredQuery?.where?.fieldFilter?.value?.stringValue === 'product-1' &&
      query?.body?.structuredQuery?.limit === 1
  );

  const commit = captured.find((call) => call.url.pathname.endsWith(':commit'));
  check('delete commit uses the same transaction', commit?.body?.transaction === 'txn-delete-1');
  const writes = commit?.body?.writes ?? [];
  check('delete commit has exactly Product delete + catalog revision write', writes.length === 2);
  check(
    'delete is scoped to the exact Product document with exists precondition',
    writes[0]?.delete ===
      'projects/test-project/databases/(default)/documents/products/product-1' &&
      writes[0]?.currentDocument?.exists === true
  );
  check(
    'catalog revision advances atomically with deletion',
    writes[1]?.update?.name ===
      'projects/test-project/databases/(default)/documents/productCatalogState/current' &&
      writes[1]?.update?.fields?.revision?.integerValue === '5'
  );
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  console.error(`Product Catalog delete Firestore transaction wire test failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog delete Firestore transaction wire test passed');
}
