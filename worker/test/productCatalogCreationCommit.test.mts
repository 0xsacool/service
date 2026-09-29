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

console.log('Running Product Catalog direct-create Firestore wire-shape test');

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
  return new Response('{}', { status: 200 });
}) as typeof fetch;

try {
  const client = createFirestoreClient(env);
  await client.commitProductCatalogCreate(
    { id: 'tx-create-1' },
    {
      productId: 'product-created-1',
      request: {
        version: 1,
        brand: 'BRUNO',
        categoryId: 'hot-plate',
        model: 'BOE021',
        sku: 'BOE021-SHPK',
        productName: 'BRUNO Compact Hot Plate 1200W - Shell Pink',
        warrantyMonths: 12,
        status: 'Active',
      },
      nextCatalogRevision: 4,
      now: '2026-09-29T14:30:00.000Z',
    }
  );

  check('direct create issues exactly one Firestore commit', captured.length === 1);
  const call = captured[0]!;
  check('direct create uses POST', call.method === 'POST');
  check('direct create targets Firestore :commit', call.url.pathname.endsWith('/documents:commit'));
  check('transaction id is forwarded', call.body.transaction === 'tx-create-1');

  const writes = call.body.writes as Array<{
    update?: { name?: unknown; fields?: Record<string, Record<string, unknown>> };
    currentDocument?: { exists?: unknown };
  }>;
  check('direct create commits product and catalog state atomically', writes.length === 2);

  const productWrite = writes[0]!;
  check('product create requires document absence', productWrite.currentDocument?.exists === false);
  check(
    'product create targets server-allocated product id',
    String(productWrite.update?.name ?? '').endsWith('/products/product-created-1')
  );
  const productFields = productWrite.update?.fields as Record<string, Record<string, unknown>>;
  check('product create stores requested SKU', productFields.sku?.stringValue === 'BOE021-SHPK');
  check('product create stores requested status', productFields.status?.stringValue === 'Active');
  check('product create stores warranty months', productFields.warrantyMonths?.integerValue === '12');
  check('product create initializes reference tracking', productFields.referenceTrackingVersion?.integerValue === '1');
  const accessoryArray = productFields.accessoryIds?.arrayValue as
    | { values?: unknown[] }
    | undefined;
  const commonProblemArray = productFields.commonProblemIds?.arrayValue as
    | { values?: unknown[] }
    | undefined;
  check(
    'product create initializes accessoryIds empty',
    (accessoryArray?.values?.length ?? 0) === 0
  );
  check(
    'product create initializes commonProblemIds empty',
    (commonProblemArray?.values?.length ?? 0) === 0
  );
  check('product create stores createdAt timestamp', typeof productFields.createdAt?.timestampValue === 'string');
  check('product create stores updatedAt timestamp', typeof productFields.updatedAt?.timestampValue === 'string');

  const stateWrite = writes[1]!;
  check(
    'catalog state write targets current state document',
    String(stateWrite.update?.name ?? '').endsWith('/productCatalogState/current')
  );
  const stateFields = stateWrite.update?.fields as Record<string, Record<string, unknown>>;
  check('catalog revision is bumped atomically', stateFields.revision?.integerValue === '4');

  captured.length = 0;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { status: 'ABORTED' } }), { status: 409 })) as typeof fetch;

  let sawConflict = false;
  try {
    await client.commitProductCatalogCreate(
      { id: 'tx-create-conflict' },
      {
        productId: 'product-created-2',
        request: {
          version: 1,
          brand: 'BRUNO',
          categoryId: 'hot-plate',
          model: 'BOE021',
          sku: 'BOE021-SHPK-2',
          productName: 'Another Product',
          warrantyMonths: 12,
          status: 'Active',
        },
        nextCatalogRevision: 5,
        now: '2026-09-29T14:31:00.000Z',
      }
    );
  } catch (error) {
    sawConflict = error instanceof TransactionConflictError;
  }
  check('Firestore ABORTED maps to transaction conflict for retry', sawConflict);
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  console.error(`Product Catalog direct-create Firestore wire-shape failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog direct-create Firestore wire-shape passed');
}
