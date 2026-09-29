import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';
import { TransactionConflictError } from '../src/serviceJobCreation.ts';
import type { CatalogProduct } from '../../src/services/productIdentity.ts';
import type { ProductCatalogCreateCommitInput } from '../src/productCatalogCreation.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Catalog direct-create route tests');

interface State {
  canManageProducts: boolean;
  catalog: CatalogProduct[];
  revision: number;
  commitAttempts: number;
  conflictsRemaining: number;
  commits: ProductCatalogCreateCommitInput[];
}

function createState(overrides: Partial<State> = {}): State {
  return {
    canManageProducts: true,
    catalog: [],
    revision: 0,
    commitAttempts: 0,
    conflictsRemaining: 0,
    commits: [],
    ...overrides,
  };
}

function createHandler(state: State) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'good-token') throw new Error('invalid token');
        return { uid: 'manager-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          return parseStaffProfile(
            uid,
            uid,
            'bruno-thailand',
            false,
            state.canManageProducts
          );
        },
        async beginTransaction() {
          return { id: `tx-${state.commitAttempts + 1}` };
        },
        async listProducts() {
          return state.catalog;
        },
        async getProductCatalogState() {
          return { revision: state.revision };
        },
        async commitProductCatalogCreate(
          _transaction: { id: string },
          input: ProductCatalogCreateCommitInput
        ) {
          state.commitAttempts += 1;
          if (state.conflictsRemaining > 0) {
            state.conflictsRemaining -= 1;
            throw new TransactionConflictError();
          }
          state.commits.push(input);
          state.revision = input.nextCatalogRevision;
          state.catalog = [
            ...state.catalog,
            {
              id: input.productId,
              sku: input.request.sku,
              brand: input.request.brand,
              model: input.request.model,
              productName: input.request.productName,
              categoryId: input.request.categoryId,
            },
          ];
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
  categoryId: 'hot-plate',
  model: 'BOE021',
  sku: 'BOE021-SHPK',
  productName: 'BRUNO Compact Hot Plate 1200W - Shell Pink',
  warrantyMonths: 12,
  status: 'Active',
};

async function post(
  state: State,
  options: { token?: string | null; body?: unknown } = {}
) {
  const { handler, env } = createHandler(state);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token === undefined ? 'good-token' : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  const response = await handler.fetch!(
    new Request('https://worker.test/products', {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? validBody),
    }),
    env,
    {} as ExecutionContext
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

{
  const state = createState();
  const result = await post(state, { token: null });
  check('missing bearer token returns 401', result.status === 401);
  check('unauthenticated create performs no commit', state.commitAttempts === 0);
}

{
  const state = createState({ canManageProducts: false });
  const result = await post(state);
  check('missing manage capability returns 403', result.status === 403);
  check('forbidden create performs no commit', state.commitAttempts === 0);
}

{
  const state = createState();
  const result = await post(state, { body: { ...validBody, sku: '' } });
  check('blank SKU fails direct-create validation', result.status === 400);
  check('invalid create performs no commit', state.commitAttempts === 0);
}

{
  const state = createState();
  const result = await post(state, {
    body: { ...validBody, categoryId: 'unknown-category' },
  });
  check('unknown category fails server validation', result.status === 400);
  check('unknown category performs no commit', state.commitAttempts === 0);
}

{
  const state = createState();
  const result = await post(state, {
    body: { ...validBody, categoryId: 'smartphone' },
  });
  check('removed Apple category fails server validation', result.status === 400);
  check('removed Apple category performs no commit', state.commitAttempts === 0);
}

{
  const state = createState({ revision: 2 });
  const result = await post(state, {
    body: {
      ...validBody,
      categoryId: 'coffee',
      model: 'BHK301',
      sku: 'BHK301',
      productName: 'BRUNO Coffee Grinder',
    },
  });
  check('new BRUNO coffee category is accepted', result.status === 201);
  check('new BRUNO coffee category commits once', state.commits.length === 1);
  check('new BRUNO coffee category is preserved', state.commits[0]?.request.categoryId === 'coffee');
}

{
  const state = createState({
    catalog: [
      {
        id: 'existing-1',
        sku: 'boe021-shpk',
        brand: 'BRUNO',
        model: 'OLD',
        productName: 'Existing',
        categoryId: 'hot-plate',
      },
    ],
  });
  const result = await post(state);
  check('normalized duplicate SKU returns 409', result.status === 409);
  check('duplicate create performs no commit', state.commitAttempts === 0);
}

{
  const state = createState({ revision: 7 });
  const result = await post(state);
  check('authorized create returns 201', result.status === 201);
  check('authorized create returns a product id', typeof result.body.productId === 'string');
  check('authorized create commits exactly once', state.commits.length === 1);
  check('catalog revision increments exactly once', state.commits[0]?.nextCatalogRevision === 8);
  check('create preserves requested status', state.commits[0]?.request.status === 'Active');
  check('create preserves requested warranty', state.commits[0]?.request.warrantyMonths === 12);
}

{
  const state = createState({ conflictsRemaining: 1 });
  const result = await post(state);
  check('one transaction conflict is retried successfully', result.status === 201);
  check('retry performs two commit attempts', state.commitAttempts === 2);
  check('retry produces one committed product', state.commits.length === 1);
}

if (failures > 0) {
  console.error(`Product Catalog direct-create route tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog direct-create route tests passed');
}
