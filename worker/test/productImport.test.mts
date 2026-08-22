import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { ProductImportCommitInput } from '../src/productImport.ts';
import { TransactionConflictError } from '../src/serviceJobCreation.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';
import { computeCatalogFingerprint } from '../../src/services/productCatalogFingerprint.ts';
import type { CatalogProduct } from '../../src/services/productIdentity.ts';

// PI-3 — route-level regression coverage for POST /products/import.
//
// Follows this suite's existing plain check()/counter convention rather than
// node:test, matching every other worker/test/*.mts file, and drives the
// real exported handler through real Request/Response objects with an
// injected fake FirestoreClient (the strategy serviceReportRoutes.test.mts
// established).

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Product Import route regression test');

const ACTOR_UID = 'staff-uid-1';
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

interface FakeState {
  profile: { uid: string; brandId: string; canImportProducts?: unknown } | null;
  catalog: CatalogProduct[];
  imports: Map<string, unknown>;
  catalogState: { revision: number } | null;
  commits: ProductImportCommitInput[];
  commitBehavior?: (attempt: number) => void;
  // Mutates the catalog between beginTransaction and listProducts, to
  // simulate another writer landing mid-transaction.
  onTransactionBegin?: (attempt: number) => void;
  transactionCount: number;
  listCalls: number;
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    profile: { uid: ACTOR_UID, brandId: 'bruno-thailand', canImportProducts: true },
    catalog: [],
    imports: new Map(),
    catalogState: null,
    commits: [],
    transactionCount: 0,
    listCalls: 0,
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
        // Routes through the REAL parseStaffProfile, exactly as the real
        // firestoreClient.getStaffProfile does. Returning the raw fixture
        // instead would let a test pass a non-boolean canImportProducts
        // straight through to the route and prove nothing about how a real
        // malformed Firestore field is actually handled.
        async getStaffProfile(uid: string) {
          if (!state.profile || state.profile.uid !== uid) return null;
          return parseStaffProfile(
            uid,
            state.profile.uid,
            state.profile.brandId,
            state.profile.canImportProducts
          );
        },
        async beginTransaction() {
          state.transactionCount += 1;
          state.onTransactionBegin?.(state.transactionCount);
          return { id: `txn-${state.transactionCount}` };
        },
        async getProductImport(_txn: unknown, key: string) {
          return state.imports.get(key) ?? null;
        },
        async listProducts(_txn: unknown, limit: number) {
          state.listCalls += 1;
          return state.catalog.slice(0, limit);
        },
        async getProductCatalogState() {
          return state.catalogState;
        },
        async commitProductImport(_txn: unknown, input: ProductImportCommitInput) {
          state.commitBehavior?.(state.transactionCount);
          state.commits.push(input);
          state.imports.set(input.key, input.record);
        },
      }) as unknown as FirestoreClient,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  return { handler: createWorkerHandler(dependencies), env };
}

interface RequestOptions {
  token?: string | null;
  key?: string | null;
  contentType?: string | null;
  body?: unknown;
  rawBody?: string;
}

async function post(state: FakeState, options: RequestOptions = {}) {
  const { handler, env } = createHandler(state);
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? 'good-token' : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const key = options.key === undefined ? KEY_A : options.key;
  if (key !== null) headers['Idempotency-Key'] = key;
  const contentType =
    options.contentType === undefined ? 'application/json' : options.contentType;
  if (contentType !== null) headers['Content-Type'] = contentType;

  const response = await handler.fetch!(
    new Request('https://worker.test/products/import', {
      method: 'POST',
      headers,
      body: options.rawBody ?? JSON.stringify(options.body ?? {}),
    }),
    env,
    {} as ExecutionContext
  );
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body is itself a finding the caller can assert on */
  }
  return { status: response.status, body: parsed };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 1,
    brand: 'BRUNO',
    sku: 'ABC-123',
    model: 'ABC',
    productName: 'Test Product',
    category: 'Hot Plate',
    ...overrides,
  };
}

async function body(catalog: CatalogProduct[], rows: unknown[], fileName = 'products.csv') {
  return {
    version: 1,
    fileName,
    catalogFingerprint: await computeCatalogFingerprint(catalog),
    rows,
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'p1',
    sku: 'ABC-123',
    brand: 'BRUNO',
    model: 'ABC',
    productName: 'Test Product',
    categoryId: 'hot-plate',
    ...overrides,
  };
}

// --- AUTH -----------------------------------------------------------------

{
  const state = createState();
  const noToken = await post(state, { token: null });
  check('no Authorization header -> 401 authentication_required', noToken.status === 401 && noToken.body.code === 'authentication_required');

  const badToken = await post(state, { token: 'invalid-token' });
  check('invalid token -> 401 authentication_required (not 403)', badToken.status === 401 && badToken.body.code === 'authentication_required');
  check('a rejected credential never reaches Firestore', state.transactionCount === 0);
}

{
  const state = createState({ profile: null });
  const result = await post(state, { body: await body([], [row()]) });
  check('missing staff profile -> 403 forbidden', result.status === 403 && result.body.code === 'forbidden');
}

{
  const state = createState({
    profile: { uid: ACTOR_UID, brandId: 'not-a-brand', canImportProducts: true },
  });
  const result = await post(state, { body: await body([], [row()]) });
  check('malformed profile (bad brandId) -> 403 even with the flag set', result.status === 403);
}

{
  const state = createState({ profile: { uid: ACTOR_UID, brandId: 'bruno-thailand' } });
  const result = await post(state, { body: await body([], [row()]) });
  check('canImportProducts absent -> 403 (fails closed, no default grant)', result.status === 403 && result.body.code === 'forbidden');
  check('an unauthorized import writes nothing', state.commits.length === 0);
}

{
  const state = createState({
    profile: { uid: ACTOR_UID, brandId: 'bruno-thailand', canImportProducts: false },
  });
  const result = await post(state, { body: await body([], [row()]) });
  check('canImportProducts false -> 403', result.status === 403);
}

{
  const state = createState({
    profile: { uid: ACTOR_UID, brandId: 'bruno-thailand', canImportProducts: 'true' },
  });
  const result = await post(state, { body: await body([], [row()]) });
  check('canImportProducts non-boolean "true" -> 403 (never coerced)', result.status === 403);
}

{
  const state = createState();
  const result = await post(state, { body: await body([], [row()]) });
  check('canImportProducts === true -> allowed (201)', result.status === 201);
}

// --- REQUEST VALIDATION ----------------------------------------------------

{
  const state = createState();
  const missingKey = await post(state, { key: null, body: await body([], [row()]) });
  check('missing Idempotency-Key -> 400', missingKey.status === 400);

  const badKey = await post(state, { key: 'not-a-uuid', body: await body([], [row()]) });
  check('non-UUIDv4 Idempotency-Key -> 400', badKey.status === 400);

  const wrongType = await post(state, { contentType: 'text/plain', body: await body([], [row()]) });
  check('wrong Content-Type -> 400', wrongType.status === 400);

  const badJson = await post(state, { rawBody: '{not json' });
  check('malformed JSON -> 400 validation_failed', badJson.status === 400 && badJson.body.code === 'validation_failed');

  check('no invalid request ever opened a transaction', state.transactionCount === 0);
}

{
  const state = createState();
  const unknownRoot = await post(state, {
    body: { ...(await body([], [row()])), somethingElse: 1 },
  });
  check('unknown root key -> 400', unknownRoot.status === 400);

  const unknownRow = await post(state, {
    body: await body([], [row({ nickname: 'x' })]),
  });
  check('unknown row key -> 400', unknownRow.status === 400);

  for (const forbidden of ['id', 'productId', 'status', 'warrantyMonths', 'createdBy', 'accessoryIds']) {
    const result = await post(state, {
      body: await body([], [row({ [forbidden]: 'x' })]),
    });
    check(`forbidden row field "${forbidden}" -> 400`, result.status === 400);
  }
}

{
  const state = createState();
  const zero = await post(state, { body: await body([], []) });
  check('zero rows -> 400', zero.status === 400);

  const tooMany = await post(state, {
    body: await body(
      [],
      Array.from({ length: 201 }, (_, index) => row({ rowNumber: index + 1, sku: `S-${index}` }))
    ),
  });
  check('201 rows -> 400 (200-row cap)', tooMany.status === 400);

  const exactly200 = await post(state, {
    body: await body(
      [],
      Array.from({ length: 200 }, (_, index) => row({ rowNumber: index + 1, sku: `S-${index}` }))
    ),
  });
  check('exactly 200 rows is accepted', exactly200.status === 201);
}

{
  const state = createState();
  const descending = await post(state, {
    body: await body([], [row({ rowNumber: 5 }), row({ rowNumber: 2, sku: 'X-1' })]),
  });
  check('non-ascending rowNumber -> 400', descending.status === 400);

  const duplicateNumber = await post(state, {
    body: await body([], [row({ rowNumber: 1 }), row({ rowNumber: 1, sku: 'X-1' })]),
  });
  check('duplicate rowNumber -> 400', duplicateNumber.status === 400);

  const zeroNumber = await post(state, { body: await body([], [row({ rowNumber: 0 })]) });
  check('rowNumber 0 -> 400', zeroNumber.status === 400);

  const blankBrand = await post(state, { body: await body([], [row({ brand: '   ' })]) });
  check('brand blank after trim -> 400', blankBrand.status === 400);

  const longName = await post(state, {
    body: await body([], [row({ productName: 'x'.repeat(201) })]),
  });
  check('productName over 200 code points -> 400', longName.status === 400);

  const control = await post(state, {
    body: await body([], [row({ productName: 'bad\nname' })]),
  });
  check('control character in a text field -> 400', control.status === 400);

  for (const sigil of ['=', '+', '-', '@']) {
    const formula = await post(state, {
      body: await body([], [row({ productName: `${sigil}HYPERLINK("x")` })]),
    });
    check(`formula-style value starting with "${sigil}" -> 400`, formula.status === 400);
  }
}

// --- IDENTITY --------------------------------------------------------------

{
  const catalog = [product()];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [row({ productName: 'Renamed' })]),
  });
  check('exact SKU match with a changed field -> updated', result.status === 201 && (result.body.summary as Record<string, number>).updated === 1);
}

{
  const catalog = [product({ sku: 'ABC-123' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [row({ sku: '  abc-123  ', productName: 'Renamed' })]),
  });
  const summary = result.body.summary as Record<string, number>;
  check('SKU match is case- and whitespace-insensitive', result.status === 201 && summary.updated === 1);
  check('a case-only SKU difference does not rewrite the stored SKU', state.commits[0]?.updates[0]?.fields.sku === undefined);
}

{
  // Legacy fallback: a product with no SKU whose model equals the incoming SKU.
  const catalog = [product({ id: 'legacy', sku: null, model: 'ABC-123' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [row({ sku: 'ABC-123', model: 'ABC-123', productName: 'Renamed' })]),
  });
  const summary = result.body.summary as Record<string, number>;
  check('SKU falls back to matching a SKU-less product by model', result.status === 201 && summary.updated === 1);
  check('the legacy fallback updates the existing row, not a new one', state.commits[0]?.updates[0]?.productId === 'legacy');
}

{
  // A blank-SKU row must NOT attach to a SKU-bearing product with the same model.
  const catalog = [product({ id: 'has-sku', sku: 'ABC-123', model: 'ABC' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [row({ sku: null, model: 'ABC' })]),
  });
  const summary = result.body.summary as Record<string, number>;
  check('a blank-SKU row never model-matches a SKU-bearing product -> new', result.status === 201 && summary.created === 1);
  check('the SKU-bearing product was not touched', state.commits[0]?.updates.length === 0);
}

{
  // A blank-SKU row DOES match a SKU-less product by model.
  const catalog = [product({ id: 'no-sku', sku: null, model: 'ABC' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [row({ sku: null, model: 'ABC', productName: 'Renamed' })]),
  });
  const summary = result.body.summary as Record<string, number>;
  check('a blank-SKU row matches a SKU-less product by model -> updated', result.status === 201 && summary.updated === 1);
}

{
  // Two catalog products share a normalized SKU — genuinely ambiguous.
  const catalog = [product({ id: 'a', sku: 'ABC-123' }), product({ id: 'b', sku: 'abc-123' })];
  const state = createState({ catalog });
  const result = await post(state, { body: await body(catalog, [row()]) });
  check('ambiguous catalog identity -> 400 validation_failed', result.status === 400 && result.body.code === 'validation_failed');
  check('an ambiguous identity writes nothing', state.commits.length === 0);
}

{
  const state = createState();
  const result = await post(state, {
    body: await body([], [row({ rowNumber: 1, sku: 'DUP-1' }), row({ rowNumber: 2, sku: 'dup-1' })]),
  });
  check('two request rows sharing a SKU identity -> 400', result.status === 400);
  check('a duplicate request identity writes nothing', state.commits.length === 0);
}

{
  // Two rows that individually resolve fine but land on the same product.
  const catalog = [product({ id: 'target', sku: null, model: 'ABC' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [
      row({ rowNumber: 1, sku: 'ABC', model: 'ABC', productName: 'One' }),
      row({ rowNumber: 2, sku: null, model: 'ABC', productName: 'Two' }),
    ]),
  });
  check('two rows resolving to the same existing product -> 400', result.status === 400);
  check('a same-target collision writes nothing', state.commits.length === 0);
}

// --- CLASSIFICATION --------------------------------------------------------

{
  const state = createState();
  const result = await post(state, { body: await body([], [row()]) });
  const summary = result.body.summary as Record<string, number>;
  check('NEW: unmatched row creates', result.status === 201 && summary.created === 1);
  check('a create carries the Active/12 baseline the request cannot supply', state.commits[0]?.creates.length === 1);
}

{
  const catalog = [product()];
  const state = createState({ catalog });
  const result = await post(state, { body: await body(catalog, [row()]) });
  const summary = result.body.summary as Record<string, number>;
  check('SKIP: identical row writes nothing', result.status === 201 && summary.skipped === 1);
  check('a SKIP-only import performs no product write', state.commits[0]?.creates.length === 0 && state.commits[0]?.updates.length === 0);
  check('a SKIP-only import does NOT bump the catalog revision', state.commits[0]?.nextCatalogRevision === null);
  check('a SKIP-only import still writes its completed audit record', state.commits[0]?.record.status === 'completed');
}

{
  const catalog = [product()];
  const state = createState({ catalog, catalogState: { revision: 7 } });
  await post(state, { body: await body(catalog, [row({ productName: 'Renamed' })]) });
  check('a mutating import bumps the catalog revision exactly once', state.commits[0]?.nextCatalogRevision === 8);
}

{
  // Mixed valid + error: the error must block the whole import.
  const state = createState();
  const result = await post(state, {
    body: await body([], [
      row({ rowNumber: 1, sku: 'OK-1' }),
      row({ rowNumber: 2, sku: 'DUP' }),
      row({ rowNumber: 3, sku: 'dup' }),
    ]),
  });
  check('mixed valid + error rows -> 400, never a partial import', result.status === 400);
  check('a mixed valid/error import writes ZERO products', state.commits.length === 0);
}

{
  const state = createState();
  const result = await post(state, {
    body: await body([], [row({ category: 'Not A Real Category' })]),
  });
  const summary = result.body.summary as Record<string, number>;
  check('an unrecognized category warns but does not block', result.status === 201 && summary.created === 1 && summary.warnings === 1);
  check('an unrecognized category imports uncategorized', state.commits[0]?.creates[0]?.categoryId === '');
}

{
  const catalog = [product({ categoryId: 'hot-plate' })];
  const state = createState({ catalog });
  await post(state, {
    body: await body(catalog, [row({ category: 'Nope', productName: 'Renamed' })]),
  });
  check('an unrecognized category never CLEARS an existing category on update', state.commits[0]?.updates[0]?.fields.categoryId === undefined);
}

// --- WRITE MASK ------------------------------------------------------------

{
  const catalog = [product()];
  const state = createState({ catalog });
  await post(state, { body: await body(catalog, [row({ productName: 'Renamed' })]) });
  const update = state.commits[0]?.updates[0];
  const maskedKeys = Object.keys(update?.fields ?? {});
  check('an update writes ONLY the changed import-owned field', maskedKeys.length === 1 && maskedKeys[0] === 'productName');
  check('an update never carries status', !maskedKeys.includes('status'));
  check('an update never carries warrantyMonths', !maskedKeys.includes('warrantyMonths'));
  check('an update never carries createdAt', !maskedKeys.includes('createdAt'));
  check('an update never carries accessoryIds/commonProblemIds', !maskedKeys.includes('accessoryIds') && !maskedKeys.includes('commonProblemIds'));
}

// --- STALE CATALOG ---------------------------------------------------------

{
  const catalog = [product()];
  const state = createState({ catalog });
  const request = await body(catalog, [row({ productName: 'Renamed' })]);
  // Another writer changes the catalog after the preview was taken.
  state.catalog = [product({ productName: 'Changed By Someone Else' })];
  const result = await post(state, { body: request });
  check('a catalog change after preview -> 409 stale_catalog', result.status === 409 && result.body.code === 'stale_catalog');
  check('a stale catalog writes nothing', state.commits.length === 0);
  check('a stale catalog records no completed import', state.imports.size === 0);
}

{
  const catalog = [product()];
  const state = createState({ catalog });
  const request = await body(catalog, [row({ productName: 'Renamed' })]);
  // The catalog mutates between transaction attempts, so the retry sees a
  // different world than the preview did.
  state.onTransactionBegin = (attempt) => {
    if (attempt === 2) state.catalog = [product({ productName: 'Moved' })];
  };
  state.commitBehavior = (attempt) => {
    if (attempt === 1) throw new TransactionConflictError();
  };
  const result = await post(state, { body: request });
  check('a catalog mutation during a retry aborts with stale_catalog', result.status === 409 && result.body.code === 'stale_catalog');
  check('a mid-retry mutation writes nothing', state.commits.length === 0);
}

// --- IDEMPOTENCY -----------------------------------------------------------

{
  const state = createState();
  const request = await body([], [row()]);
  const first = await post(state, { key: KEY_A, body: request });
  check('first import -> 201', first.status === 201 && first.body.replayed === false);

  const replay = await post(state, { key: KEY_A, body: request });
  check('replay of the same key/actor/body -> 200 replayed', replay.status === 200 && replay.body.replayed === true);
  check('a replay performs no second write', state.commits.length === 1);
  check('a replay returns the canonical stored outcome', JSON.stringify(replay.body.summary) === JSON.stringify(first.body.summary));
}

{
  const state = createState();
  await post(state, { key: KEY_A, body: await body([], [row()]) });
  const changed = await post(state, {
    key: KEY_A,
    body: await body([], [row({ productName: 'Different Body' })]),
  });
  check('same key with a different body -> 409 idempotency_mismatch', changed.status === 409 && changed.body.code === 'idempotency_mismatch');
  check('an idempotency mismatch writes nothing new', state.commits.length === 1);
}

{
  const state = createState();
  const request = await body([], [row()]);
  await post(state, { key: KEY_A, body: request });
  // Same key, same body, different verified actor.
  const stored = state.imports.get(KEY_A) as Record<string, unknown>;
  state.imports.set(KEY_A, { ...stored, actorUid: 'someone-else' });
  const otherActor = await post(state, { key: KEY_A, body: request });
  check('same key bound to a different actor -> 409 idempotency_mismatch', otherActor.status === 409 && otherActor.body.code === 'idempotency_mismatch');
}

{
  const state = createState();
  const distinct = await post(state, { key: KEY_B, body: await body([], [row()]) });
  check('a different key is a genuinely new import -> 201', distinct.status === 201);
}

{
  // A failed import must leave no completed record behind.
  const state = createState();
  await post(state, { body: await body([], [row({ rowNumber: 1, sku: 'D' }), row({ rowNumber: 2, sku: 'd' })]) });
  check('a validation failure records no completed import', state.imports.size === 0);
}

// --- RETRY -----------------------------------------------------------------

{
  const state = createState();
  state.commitBehavior = (attempt) => {
    if (attempt < 3) throw new TransactionConflictError();
  };
  const result = await post(state, { body: await body([], [row()]) });
  check('a transient conflict retries and then succeeds', result.status === 201);
  check('each retry began a fresh transaction', state.transactionCount === 3);
  check('each retry re-read the authoritative catalog', state.listCalls === 3);
}

{
  const state = createState();
  state.commitBehavior = () => {
    throw new TransactionConflictError();
  };
  const result = await post(state, { body: await body([], [row()]) });
  check('persistent conflict -> 503 transaction_retry_exhausted', result.status === 503 && result.body.code === 'transaction_retry_exhausted');
  check('retries stop at the 5-attempt budget', state.transactionCount === 5);
  check('an exhausted import wrote nothing', state.commits.length === 0);
}

// --- RESPONSE SHAPE --------------------------------------------------------

{
  const catalog = [product({ id: 'existing', sku: 'KEEP-1', productName: 'Old' })];
  const state = createState({ catalog });
  const result = await post(state, {
    body: await body(catalog, [
      row({ rowNumber: 1, sku: 'KEEP-1', model: 'ABC', productName: 'New Name' }),
      row({ rowNumber: 2, sku: 'BRAND-NEW', model: 'BN', productName: 'Fresh' }),
    ]),
  });
  const rows = result.body.rows as { rowNumber: number; status: string; productId: string }[];
  check('the response reports a per-row status', rows.length === 2 && rows[0]?.status === 'updated' && rows[1]?.status === 'new');
  check('the response reports the server-allocated product id for a new row', typeof rows[1]?.productId === 'string' && rows[1]!.productId.length > 0);
  check('the new product id is not derived from anything the client sent', rows[1]?.productId !== 'BRAND-NEW');
  check('the response reports both fingerprints', typeof result.body.catalogFingerprintBefore === 'string' && typeof result.body.catalogFingerprintAfter === 'string');
  check('a mutating import changes the reported fingerprint', result.body.catalogFingerprintBefore !== result.body.catalogFingerprintAfter);
}

// --- AUDIT RECORD ----------------------------------------------------------

{
  const state = createState();
  await post(state, { body: await body([], [row()], 'my-products.csv') });
  const record = state.commits[0]!.record;
  check('the audit record binds the operation literal', record.operation === 'product_import_v1');
  check('the audit record binds the verified actor', record.actorUid === ACTOR_UID);
  check('the audit record stores a request fingerprint', typeof record.requestFingerprint === 'string' && record.requestFingerprint.length === 64);
  check('the audit record stores the file name', record.fileName === 'my-products.csv');
  check('the audit record is marked completed', record.status === 'completed');
  const serialized = JSON.stringify(record);
  check('the audit record contains no bearer token', !serialized.includes('good-token'));
  check('the audit record contains no raw CSV or raw request body', !serialized.includes('Hot Plate'));
}

// --- METHOD / ROUTING ------------------------------------------------------

{
  const { handler, env } = createHandler(createState());
  const wrongMethod = await handler.fetch!(
    new Request('https://worker.test/products/import', { method: 'GET' }),
    env,
    {} as ExecutionContext
  );
  check('GET /products/import is not routed (404)', wrongMethod.status === 404);

  const unrelated = await handler.fetch!(
    new Request('https://worker.test/products', { method: 'POST' }),
    env,
    {} as ExecutionContext
  );
  check('POST /products (no /import) is not routed (404)', unrelated.status === 404);
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(`Product Import route regression test failed: ${failures} failure(s)`);
} else {
  console.log('Product Import route regression test passed');
}
