import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Catalog Management Firestore wire-shape test');

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

const captured: Array<{ url: URL; method: string; body: Record<string, unknown> }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  captured.push({
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
  });
  return new Response(JSON.stringify({ name: 'products/product-1' }), { status: 200 });
}) as typeof fetch;

try {
  const client = createFirestoreClient(env);
  const updated = await client.updateProductCatalogEntry(
    'product-1',
    {
      version: 1,
      brand: 'BRUNO',
      categoryId: 'kitchen',
      model: 'BOE127',
      sku: null,
      productName: 'Mini Rice Cooker',
      warrantyMonths: 12,
      status: 'Legacy',
    },
    '2026-09-29T06:00:00.000Z'
  );

  check('edit reports success', updated === true);
  check('exactly one Firestore request is issued', captured.length === 1);

  const call = captured[0]!;
  check('product edit uses PATCH', call.method === 'PATCH');
  check('product edit targets the exact document', call.url.pathname.endsWith('/products/product-1'));
  check('currentDocument.exists=true is required', call.url.searchParams.get('currentDocument.exists') === 'true');

  const masks = call.url.searchParams.getAll('updateMask.fieldPaths').sort();
  check(
    'edit mask is exactly the approved general-field set plus updatedAt',
    masks.join(',') === [
      'brand',
      'categoryId',
      'model',
      'productName',
      'sku',
      'status',
      'updatedAt',
      'warrantyMonths',
    ].sort().join(',')
  );
  check('edit mask never touches accessory associations', !masks.includes('accessoryIds'));
  check('edit mask never touches common-problem associations', !masks.includes('commonProblemIds'));
  check('edit path contains no delete operation', call.method !== 'DELETE');

  const fields = call.body.fields as Record<string, Record<string, unknown>>;
  check('Legacy is written as a string field', fields.status?.stringValue === 'Legacy');
  check('blank SKU is written as Firestore null', fields.sku?.nullValue === null);
  check('updatedAt remains a Firestore timestamp', typeof fields.updatedAt?.timestampValue === 'string');
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  console.error(`Product Catalog Management Firestore wire-shape failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog Management Firestore wire-shape passed');
}
