import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product quick-status / safe-delete route tests');

interface State {
  canManageProducts: boolean;
  status: 'Active' | 'Legacy';
  marker: number | null;
  referenced: boolean;
  statusWrites: string[];
  deleteCommits: number;
}

function createState(overrides: Partial<State> = {}): State {
  return {
    canManageProducts: true,
    status: 'Legacy',
    marker: 1,
    referenced: false,
    statusWrites: [],
    deleteCommits: 0,
    ...overrides,
  };
}

function createHandler(state: State) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'good-token') throw new Error('invalid');
        return { uid: 'owner-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          return parseStaffProfile(
            uid,
            uid,
            'bruno-thailand',
            true,
            state.canManageProducts
          );
        },
        async updateProductCatalogStatus(_: string, status: 'Active' | 'Legacy') {
          state.statusWrites.push(status);
          state.status = status;
          return true;
        },
        async beginServiceJobTransaction() {
          return { id: crypto.randomUUID() };
        },
        async getProductForDeletion() {
          return {
            status: state.status,
            referenceTrackingVersion: state.marker,
          };
        },
        async hasServiceJobProductReference() {
          return state.referenced;
        },
        async getProductCatalogState() {
          return { revision: 1 };
        },
        async commitProductDeletion() {
          state.deleteCommits += 1;
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
  method: 'PATCH' | 'DELETE',
  suffix: string,
  options: { token?: string | null; body?: unknown } = {}
) {
  const { handler, env } = createHandler(state);
  const token = options.token === undefined ? 'good-token' : options.token;
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (method === 'PATCH') headers['Content-Type'] = 'application/json';
  const response = await handler.fetch!(
    new Request(`https://worker.test/products/product-1${suffix}`, {
      method,
      headers,
      ...(method === 'PATCH'
        ? { body: JSON.stringify(options.body ?? { version: 1, status: 'Legacy' }) }
        : {}),
    }),
    env,
    {} as ExecutionContext
  );
  let body: any = null;
  if (response.status !== 204) body = await response.json();
  return { status: response.status, body };
}

{
  const state = createState({ status: 'Active' });
  const result = await request(state, 'PATCH', '/status');
  check('quick status endpoint returns 200', result.status === 200);
  check('quick status writes only the requested status operation', state.statusWrites.join(',') === 'Legacy');
}

{
  const state = createState({ status: 'Active' });
  const result = await request(state, 'DELETE', '');
  check('Active hard delete is rejected', result.status === 409 && result.body.code === 'product_not_legacy');
  check('Active hard delete performs no commit', state.deleteCommits === 0);
}

{
  const state = createState({ marker: null });
  const result = await request(state, 'DELETE', '');
  check('pre-cutover hard delete fails closed', result.status === 409 && result.body.code === 'product_reference_unknown');
  check('pre-cutover hard delete performs no commit', state.deleteCommits === 0);
}

{
  const state = createState({ referenced: true });
  const result = await request(state, 'DELETE', '');
  check('referenced Product hard delete is rejected', result.status === 409 && result.body.code === 'product_in_use');
  check('referenced Product hard delete performs no commit', state.deleteCommits === 0);
}

{
  const state = createState();
  const result = await request(state, 'DELETE', '');
  check('safe Legacy unreferenced Product returns 204', result.status === 204);
  check('safe Product delete commits exactly once', state.deleteCommits === 1);
}

{
  const state = createState();
  const result = await request(state, 'DELETE', '', { token: null });
  check('unauthenticated delete is rejected', result.status === 401);
  check('unauthenticated delete performs no commit', state.deleteCommits === 0);
}

{
  const state = createState({ canManageProducts: false });
  const result = await request(state, 'DELETE', '');
  check('canImportProducts without canManageProducts cannot delete', result.status === 403);
  check('forbidden delete performs no commit', state.deleteCommits === 0);
}

if (failures > 0) {
  console.error(`Product quick-status / safe-delete route tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product quick-status / safe-delete route tests passed');
}
