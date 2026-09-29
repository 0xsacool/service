import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';
import type {
  AccessoryDefinition,
  CommonProblemDefinition,
} from '../../src/types/productMaster.ts';
import type { ProductKnowledgeTarget } from '../src/productKnowledgeManagement.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Knowledge management route tests');

interface State {
  canManageProducts: boolean;
  product: ProductKnowledgeTarget | null;
  accessories: AccessoryDefinition[];
  problems: CommonProblemDefinition[];
  commits: string[];
}

function createState(overrides: Partial<State> = {}): State {
  return {
    canManageProducts: true,
    product: { accessoryIds: [], commonProblemIds: [] },
    accessories: [],
    problems: [],
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
          return { id: `tx-${state.commits.length + 1}` };
        },
        async listAccessoryDefinitions() {
          return state.accessories;
        },
        async listCommonProblemDefinitions() {
          return state.problems;
        },
        async getProductKnowledgeTarget() {
          return state.product;
        },
        async getAccessoryDefinition(_tx: unknown, id: string) {
          return state.accessories.find((item) => item.id === id) ?? null;
        },
        async getCommonProblemDefinition(_tx: unknown, id: string) {
          return state.problems.find((item) => item.id === id) ?? null;
        },
        async commitAccessoryCreate(
          _tx: unknown,
          input: {
            accessory: AccessoryDefinition;
            accessoryIds: string[];
          }
        ) {
          state.accessories = [...state.accessories, input.accessory];
          if (state.product) state.product.accessoryIds = input.accessoryIds;
          state.commits.push('accessory-create');
        },
        async commitCommonProblemCreate(
          _tx: unknown,
          input: {
            problem: CommonProblemDefinition;
            commonProblemIds: string[];
          }
        ) {
          state.problems = [...state.problems, input.problem];
          if (state.product) state.product.commonProblemIds = input.commonProblemIds;
          state.commits.push('problem-create');
        },
        async commitProductKnowledgeAssociation(
          _tx: unknown,
          input: {
            field: 'accessoryIds' | 'commonProblemIds';
            ids: string[];
          }
        ) {
          if (state.product) state.product[input.field] = input.ids;
          state.commits.push(`association-${input.field}`);
        },
        async commitCommonProblemUpdate(
          _tx: unknown,
          input: { problem: CommonProblemDefinition }
        ) {
          state.problems = state.problems.map((problem) =>
            problem.id === input.problem.id ? input.problem : problem
          );
          state.commits.push('problem-update');
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

async function request(
  state: State,
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown } = {}
) {
  const { handler, env } = createHandler(state);
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? 'good-token' : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await handler.fetch!(
    new Request(`https://worker.test${path}`, {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    }),
    env,
    {} as ExecutionContext
  );
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // no body
  }
  return { status: response.status, body };
}

{
  const state = createState();
  const result = await request(state, 'GET', '/product-knowledge', { token: null });
  check('Product Knowledge read requires authentication', result.status === 401);
}

{
  const state = createState({ canManageProducts: false });
  const result = await request(state, 'GET', '/product-knowledge');
  check('ordinary authorized staff can read Product Knowledge', result.status === 200);
}

{
  const state = createState({ canManageProducts: false });
  const result = await request(state, 'POST', '/products/product-1/accessories', {
    body: { version: 1, label: 'ฝา' },
  });
  check('accessory create requires canManageProducts', result.status === 403);
  check('forbidden accessory create performs no commit', state.commits.length === 0);
}

{
  const state = createState();
  const result = await request(state, 'POST', '/products/product-1/accessories', {
    body: { version: 1, label: 'ฝา' },
  });
  check('authorized accessory create returns 201', result.status === 201);
  check('accessory create commits once', state.commits[0] === 'accessory-create');
  check('created accessory is immediately associated', state.product?.accessoryIds.length === 1);
}

{
  const state = createState({
    accessories: [{ id: 'existing-accessory', label: 'ฝา' }],
  });
  const result = await request(state, 'POST', '/products/product-1/accessories', {
    body: { version: 1, label: '  ฝา  ' },
  });
  check('duplicate accessory label returns 409', result.status === 409);
  check('duplicate accessory performs no commit', state.commits.length === 0);
}

{
  const state = createState();
  const result = await request(state, 'POST', '/products/product-1/common-problems', {
    body: {
      version: 1,
      label: 'เตาไม่ร้อน',
      status: 'Active',
      description: 'ตรวจฮีตเตอร์',
    },
  });
  check('authorized common problem create returns 201', result.status === 201);
  check('common problem is immediately associated', state.product?.commonProblemIds.length === 1);
}

{
  const state = createState({
    problems: [{ id: 'problem-1', label: 'เตาไม่ร้อน', status: 'Active' }],
  });
  const result = await request(
    state,
    'PATCH',
    '/product-knowledge/common-problems/problem-1',
    {
      body: {
        version: 1,
        label: 'ไฟไม่เข้า',
        status: 'Inactive',
        description: null,
      },
    }
  );
  check('common problem edit returns 200', result.status === 200);
  check('common problem edit preserves requested status', state.problems[0]?.status === 'Inactive');
  check('common problem edit updates label', state.problems[0]?.label === 'ไฟไม่เข้า');
}

{
  const state = createState({
    accessories: [{ id: 'acc-1', label: 'สายไฟ' }],
    product: { accessoryIds: ['acc-1'], commonProblemIds: [] },
  });
  const result = await request(
    state,
    'PUT',
    '/products/product-1/accessories/acc-1',
    { body: { version: 1, include: false } }
  );
  check('accessory unassociation returns 200', result.status === 200);
  check('accessory unassociation updates Product ids', state.product?.accessoryIds.length === 0);
}

{
  const state = createState();
  const result = await request(
    state,
    'PUT',
    '/products/product-1/common-problems/missing',
    { body: { version: 1, include: true } }
  );
  check('association requires an existing definition', result.status === 404);
  check('missing definition performs no commit', state.commits.length === 0);
}

{
  const state = createState();
  const result = await request(state, 'POST', '/products/product-1/accessories', {
    body: { version: 1, label: '' },
  });
  check('invalid accessory body returns 400', result.status === 400);
  check('invalid accessory performs no commit', state.commits.length === 0);
}

if (failures > 0) {
  console.error(`Product Knowledge management route tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Knowledge management route tests passed');
}
