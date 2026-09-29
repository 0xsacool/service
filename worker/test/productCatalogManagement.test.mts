import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';
import type { ProductCatalogUpdateRequest } from '../../src/services/productCatalogManagement.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Catalog Management route regression test');

const ACTOR_UID = 'catalog-manager-1';

interface FakeState {
  canImportProducts: unknown;
  canManageProducts: unknown;
  updateResult: boolean;
  updates: Array<{ productId: string; request: ProductCatalogUpdateRequest }>;
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    canImportProducts: false,
    canManageProducts: true,
    updateResult: true,
    updates: [],
    ...overrides,
  };
}

function createHandler(state: FakeState) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'good-token') throw new Error('invalid token');
        return { uid: ACTOR_UID };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          if (uid !== ACTOR_UID) return null;
          return parseStaffProfile(
            uid,
            ACTOR_UID,
            'bruno-thailand',
            state.canImportProducts,
            state.canManageProducts
          );
        },
        async updateProductCatalogEntry(
          productId: string,
          request: ProductCatalogUpdateRequest
        ) {
          state.updates.push({ productId, request });
          return state.updateResult;
        },
      }) as unknown as FirestoreClient,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'https://app.test',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  return { handler: createWorkerHandler(dependencies), env };
}

const validBody = {
  version: 1,
  brand: 'BRUNO',
  categoryId: 'kitchen',
  model: 'BOE127',
  sku: 'BOE127-IV',
  productName: 'Mini Rice Cooker',
  warrantyMonths: 12,
  status: 'Legacy',
};

async function patch(
  state: FakeState,
  options: {
    token?: string | null;
    body?: unknown;
    productId?: string;
  } = {}
) {
  const { handler, env } = createHandler(state);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token === undefined ? 'good-token' : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await handler.fetch!(
    new Request(
      `https://worker.test/products/${options.productId ?? 'product-1'}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(options.body ?? validBody),
      }
    ),
    env,
    {} as ExecutionContext
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

{
  const state = createState();
  const result = await patch(state, { token: null });
  check('missing bearer token returns 401', result.status === 401);
  check('unauthorized request performs no write', state.updates.length === 0);
}

{
  const state = createState({ canImportProducts: true, canManageProducts: false });
  const result = await patch(state);
  check('import permission alone does not grant catalog edit', result.status === 403);
  check('forbidden request performs no write', state.updates.length === 0);
}

{
  const state = createState({ canManageProducts: 'true' });
  const result = await patch(state);
  check('non-boolean manage capability fails closed', result.status === 403);
}

{
  const state = createState();
  const result = await patch(state, { body: { ...validBody, unexpected: true } });
  check('extra request keys fail exact validation', result.status === 400);
  check('invalid request performs no write', state.updates.length === 0);
}

{
  const state = createState({ updateResult: false });
  const result = await patch(state);
  check('missing product returns 404', result.status === 404);
}

{
  const state = createState();
  const result = await patch(state);
  check('authorized valid update returns 200', result.status === 200);
  check('authorized update writes exactly once', state.updates.length === 1);
  check('route forwards the requested product id', state.updates[0]?.productId === 'product-1');
  check('route forwards Legacy status', state.updates[0]?.request.status === 'Legacy');
}

if (failures > 0) {
  console.error(`Product Catalog Management route regression failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog Management route regression passed');
}
