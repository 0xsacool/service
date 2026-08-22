import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// PI-3 — behavioral coverage for the shared Product Import modules: identity
// normalization/matching, the catalog fingerprint, request validation, and
// classification.
//
// These are the modules the browser preview and the privileged Worker BOTH
// import, so this file is what proves the two runtimes agree. Everything
// here is real execution via ssrLoadModule — no source-text assertions.

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  normalizeDisplayValue,
  normalizeIdentityValue,
  hasSku,
  matchCatalogProduct,
  requestIdentityKey,
  changedImportOwnedFields,
} = await vite.ssrLoadModule('/src/services/productIdentity.ts');

const { buildCanonicalCatalogString, computeCatalogFingerprint, sha256Hex } =
  await vite.ssrLoadModule('/src/services/productCatalogFingerprint.ts');

const { parseProductImportRequest, buildCanonicalRequestString, PRODUCT_IMPORT_LIMITS } =
  await vite.ssrLoadModule('/src/services/productImportRequest.ts');

const { classifyProductImport } = await vite.ssrLoadModule(
  '/src/services/productImportClassification.ts'
);

const { resolveProductCategoryId } = await vite.ssrLoadModule(
  '/src/services/productCategories.ts'
);

function product(overrides = {}) {
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

function fields(overrides = {}) {
  return {
    sku: 'ABC-123',
    brand: 'BRUNO',
    model: 'ABC',
    productName: 'Test Product',
    categoryId: 'hot-plate',
    ...overrides,
  };
}

// --- normalization ----------------------------------------------------------

test('display normalization trims edges but preserves interior whitespace and casing', () => {
  assert.equal(normalizeDisplayValue('  BRUNO  Hot   Plate  '), 'BRUNO  Hot   Plate');
});

test('display normalization applies NFC so visually identical text has one representation', () => {
  // "é" as e + combining acute (NFD) must normalize to the single NFC code point.
  const decomposed = 'Café';
  const composed = 'Café';
  assert.notEqual(decomposed, composed);
  assert.equal(normalizeDisplayValue(decomposed), composed);
});

test('identity normalization lowercases, trims, and applies NFKC compatibility folding', () => {
  assert.equal(normalizeIdentityValue('  ABC-123  '), 'abc-123');
  // Full-width characters are a compatibility variant of their ASCII forms.
  assert.equal(normalizeIdentityValue('ＡＢＣ－１２３'), 'abc-123');
});

test('identity normalization is locale-independent (Turkish dotted I does not fold differently)', () => {
  // toLocaleLowerCase('tr') would produce 'ı' here; toLowerCase must not.
  assert.equal(normalizeIdentityValue('SKI'), 'ski');
});

test('hasSku treats absent, null, empty, and whitespace-only as the same "no SKU" state', () => {
  assert.equal(hasSku(undefined), false);
  assert.equal(hasSku(null), false);
  assert.equal(hasSku(''), false);
  assert.equal(hasSku('   '), false);
  assert.equal(hasSku('A'), true);
});

// --- matching (PI-3 §2) -----------------------------------------------------

test('a SKU matches an existing product by normalized SKU', () => {
  const outcome = matchCatalogProduct(fields({ sku: '  abc-123 ' }), [product()]);
  assert.equal(outcome.kind, 'matched');
  assert.equal(outcome.product.id, 'p1');
});

test('an unmatched SKU is new', () => {
  const outcome = matchCatalogProduct(fields({ sku: 'NOPE-1' }), [product()]);
  assert.equal(outcome.kind, 'new');
});

test('legacy fallback: a SKU matches a SKU-LESS product whose model equals it', () => {
  const legacy = product({ id: 'legacy', sku: null, model: 'ABC-123' });
  const outcome = matchCatalogProduct(fields({ sku: 'ABC-123' }), [legacy]);
  assert.equal(outcome.kind, 'matched');
  assert.equal(outcome.product.id, 'legacy');
});

test('the legacy fallback never reaches a product that HAS a different SKU', () => {
  const other = product({ id: 'other', sku: 'ZZZ-9', model: 'ABC-123' });
  const outcome = matchCatalogProduct(fields({ sku: 'ABC-123' }), [other]);
  assert.equal(outcome.kind, 'new');
});

test('a real SKU match wins over the legacy model fallback', () => {
  const real = product({ id: 'real', sku: 'ABC-123', model: 'X' });
  const legacy = product({ id: 'legacy', sku: null, model: 'ABC-123' });
  const outcome = matchCatalogProduct(fields({ sku: 'ABC-123' }), [legacy, real]);
  assert.equal(outcome.kind, 'matched');
  assert.equal(outcome.product.id, 'real');
});

test('two products sharing a normalized SKU are a conflict, never an arbitrary pick', () => {
  const outcome = matchCatalogProduct(fields(), [
    product({ id: 'a', sku: 'ABC-123' }),
    product({ id: 'b', sku: 'abc-123' }),
  ]);
  assert.equal(outcome.kind, 'conflict');
  assert.equal(outcome.candidates.length, 2);
});

test('a blank-SKU row matches ONLY a SKU-less product, by model', () => {
  const noSku = product({ id: 'no-sku', sku: null, model: 'ABC' });
  const outcome = matchCatalogProduct(fields({ sku: null }), [noSku]);
  assert.equal(outcome.kind, 'matched');
  assert.equal(outcome.product.id, 'no-sku');
});

test('a blank-SKU row NEVER matches a SKU-bearing product even when the model is identical', () => {
  const hasSkuProduct = product({ id: 'has-sku', sku: 'ABC-123', model: 'ABC' });
  const outcome = matchCatalogProduct(fields({ sku: null }), [hasSkuProduct]);
  assert.equal(outcome.kind, 'new');
});

test('two SKU-less products sharing a model are a conflict for a blank-SKU row', () => {
  const outcome = matchCatalogProduct(fields({ sku: null }), [
    product({ id: 'a', sku: null, model: 'ABC' }),
    product({ id: 'b', sku: null, model: 'abc' }),
  ]);
  assert.equal(outcome.kind, 'conflict');
});

test('a row with neither SKU nor model is new, never a match', () => {
  const outcome = matchCatalogProduct(fields({ sku: null, model: '  ' }), [
    product({ id: 'a', sku: null, model: '' }),
  ]);
  assert.equal(outcome.kind, 'new');
});

// --- request identity namespacing -------------------------------------------

test('SKU-bearing and SKU-less rows occupy separate identity namespaces', () => {
  const withSku = requestIdentityKey(fields({ sku: 'ABC' }));
  const withoutSku = requestIdentityKey(fields({ sku: null, model: 'ABC' }));
  assert.equal(withSku, 'sku:abc');
  assert.equal(withoutSku, 'model:abc');
  assert.notEqual(withSku, withoutSku);
});

test('a row with no usable identity has no key', () => {
  assert.equal(requestIdentityKey(fields({ sku: null, model: '' })), null);
});

// --- change detection --------------------------------------------------------

test('an identical row reports no changed fields (SKIP)', () => {
  assert.deepEqual(changedImportOwnedFields(fields(), product()), []);
});

test('a case-only SKU difference is NOT a change (stored spelling is preserved)', () => {
  assert.deepEqual(changedImportOwnedFields(fields({ sku: 'abc-123' }), product()), []);
});

test('a changed product name is reported, and only that field', () => {
  assert.deepEqual(
    changedImportOwnedFields(fields({ productName: 'Renamed' }), product()),
    ['productName']
  );
});

test('a null (unrecognized/blank) category never counts as a change', () => {
  assert.deepEqual(changedImportOwnedFields(fields({ categoryId: null }), product()), []);
});

test('adding a SKU to a SKU-less product IS a change', () => {
  const legacy = product({ id: 'legacy', sku: null, model: 'ABC-123' });
  const changed = changedImportOwnedFields(fields({ sku: 'ABC-123', model: 'ABC-123' }), legacy);
  assert.ok(changed.includes('sku'));
});

// --- catalog fingerprint ------------------------------------------------------

test('the fingerprint is independent of catalog ordering', async () => {
  const a = [product({ id: 'p1' }), product({ id: 'p2', sku: 'B' })];
  const b = [product({ id: 'p2', sku: 'B' }), product({ id: 'p1' })];
  assert.equal(await computeCatalogFingerprint(a), await computeCatalogFingerprint(b));
});

test('the fingerprint changes when an import-owned field changes', async () => {
  const before = await computeCatalogFingerprint([product()]);
  const after = await computeCatalogFingerprint([product({ productName: 'Renamed' })]);
  assert.notEqual(before, after);
});

test('the fingerprint changes when a product is added or removed', async () => {
  const one = await computeCatalogFingerprint([product()]);
  const two = await computeCatalogFingerprint([product(), product({ id: 'p2', sku: 'B' })]);
  assert.notEqual(one, two);
});

test('the fingerprint IGNORES fields an import can neither read nor write', async () => {
  // status/warrantyMonths/associations are not part of CatalogProduct at all,
  // so a change to them cannot invalidate a preview — and must not cause a
  // spurious stale_catalog abort.
  const base = await computeCatalogFingerprint([product()]);
  const withExtras = await computeCatalogFingerprint([
    { ...product(), status: 'Legacy', warrantyMonths: 99, accessoryIds: ['x'] },
  ]);
  assert.equal(base, withExtras);
});

test('the fingerprint ignores a case-only SKU difference but not a name case change', async () => {
  const a = await computeCatalogFingerprint([product({ sku: 'ABC-123' })]);
  const b = await computeCatalogFingerprint([product({ sku: 'abc-123' })]);
  assert.equal(a, b);

  const c = await computeCatalogFingerprint([product({ productName: 'test product' })]);
  assert.notEqual(a, c);
});

test('the canonical catalog string serializes rows as positional arrays, never objects', () => {
  const canonical = buildCanonicalCatalogString([product()]);
  // An object serialization would contain field names; a positional array
  // must not. This is what makes the browser's and Worker's serializations
  // agree regardless of property insertion order.
  assert.doesNotMatch(canonical, /"productName"/);
  assert.doesNotMatch(canonical, /"categoryId"/);
  assert.match(canonical, /^pcf-1\n\[\[/);
});

test('the fingerprint is a lowercase 64-char SHA-256 hex digest', async () => {
  const fingerprint = await computeCatalogFingerprint([product()]);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
});

test('sha256Hex matches a known vector', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

// --- request validation -------------------------------------------------------

function request(overrides = {}) {
  return {
    version: 1,
    fileName: 'products.csv',
    catalogFingerprint: 'a'.repeat(64),
    rows: [
      {
        rowNumber: 1,
        brand: 'BRUNO',
        sku: 'ABC-123',
        model: 'ABC',
        productName: 'Test',
        category: 'Hot Plate',
      },
    ],
    ...overrides,
  };
}

test('a well-formed request parses', () => {
  const result = parseProductImportRequest(request());
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
});

test('an unknown root or row key is rejected', () => {
  assert.equal(parseProductImportRequest({ ...request(), extra: 1 }).failure, 'unknown_field');
  const withRowKey = request();
  withRowKey.rows[0].extra = 1;
  assert.equal(parseProductImportRequest(withRowKey).failure, 'unknown_field');
});

test('every forbidden server-owned field is rejected explicitly, not silently dropped', () => {
  for (const forbidden of [
    'id',
    'productId',
    'brandId',
    'status',
    'warrantyMonths',
    'createdAt',
    'updatedAt',
    'actorUid',
    'createdBy',
    'accessoryIds',
  ]) {
    const body = request();
    body.rows[0][forbidden] = 'x';
    const result = parseProductImportRequest(body);
    assert.equal(result.ok, false, `${forbidden} should be rejected`);
    assert.equal(result.failure, 'forbidden_field', `${forbidden} should be forbidden_field`);
  }
});

test('the row cap is enforced at exactly 200', () => {
  const make = (count) =>
    request({
      rows: Array.from({ length: count }, (_, index) => ({
        rowNumber: index + 1,
        brand: 'B',
        sku: `S-${index}`,
        model: 'M',
        productName: 'N',
        category: null,
      })),
    });
  assert.equal(parseProductImportRequest(make(200)).ok, true);
  assert.equal(parseProductImportRequest(make(201)).failure, 'too_many_rows');
  assert.equal(PRODUCT_IMPORT_LIMITS.maxRows, 200);
});

test('rowNumber must be a strictly ascending positive integer', () => {
  assert.equal(parseProductImportRequest(request({ rows: [{ rowNumber: 0, brand: 'B', sku: null, model: 'M', productName: 'N', category: null }] })).failure, 'invalid_row_number');
  const outOfOrder = request({
    rows: [
      { rowNumber: 3, brand: 'B', sku: 'A', model: 'M', productName: 'N', category: null },
      { rowNumber: 2, brand: 'B', sku: 'C', model: 'M', productName: 'N', category: null },
    ],
  });
  assert.equal(parseProductImportRequest(outOfOrder).failure, 'invalid_row_number');
});

test('required fields cannot be blank after trimming', () => {
  const body = request();
  body.rows[0].productName = '   ';
  assert.equal(parseProductImportRequest(body).failure, 'blank_required_field');
});

test('control characters are rejected in text fields', () => {
  const body = request();
  body.rows[0].productName = 'bad\nvalue';
  assert.equal(parseProductImportRequest(body).failure, 'unsafe_value');
});

test('formula-style values are rejected on every sigil', () => {
  for (const sigil of ['=', '+', '-', '@']) {
    const body = request();
    body.rows[0].productName = `${sigil}CMD()`;
    assert.equal(parseProductImportRequest(body).failure, 'unsafe_value', `${sigil} should be rejected`);
  }
});

test('length limits are measured in CODE POINTS, not UTF-16 units', () => {
  const body = request();
  // 100 astral-plane emoji = 100 code points but 200 UTF-16 units. The brand
  // cap is 80 code points, so this must fail as a length problem.
  body.rows[0].brand = '😀'.repeat(100);
  assert.equal(parseProductImportRequest(body).failure, 'invalid_field');

  // 80 emoji is exactly at the cap and must be accepted, proving the limit
  // is not silently counting surrogate pairs as two.
  const atCap = request();
  atCap.rows[0].brand = '😀'.repeat(80);
  assert.equal(parseProductImportRequest(atCap).ok, true);
});

test('the catalog fingerprint field must be a SHA-256 hex digest', () => {
  assert.equal(parseProductImportRequest(request({ catalogFingerprint: 'nope' })).failure, 'invalid_field');
  assert.equal(parseProductImportRequest(request({ catalogFingerprint: 'A'.repeat(64) })).failure, 'invalid_field');
});

test('an unsupported version is rejected', () => {
  assert.equal(parseProductImportRequest(request({ version: 2 })).failure, 'unsupported_version');
});

test('the canonical request string is positional and order-sensitive', () => {
  const a = parseProductImportRequest(request()).value;
  const reordered = parseProductImportRequest(
    request({
      rows: [
        { rowNumber: 1, brand: 'BRUNO', sku: 'A', model: 'M', productName: 'N', category: null },
        { rowNumber: 2, brand: 'BRUNO', sku: 'B', model: 'M', productName: 'N', category: null },
      ],
    })
  ).value;
  assert.notEqual(buildCanonicalRequestString(a), buildCanonicalRequestString(reordered));
  assert.doesNotMatch(buildCanonicalRequestString(a), /"productName"/);
});

// --- classification -----------------------------------------------------------

function classifyRow(overrides = {}) {
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

test('classification: unmatched row is new', () => {
  const result = classifyProductImport([classifyRow()], []);
  assert.equal(result.rows[0].status, 'new');
  assert.equal(result.created, 1);
  assert.equal(result.hasErrors, false);
});

test('classification: identical row is skipped', () => {
  const result = classifyProductImport([classifyRow()], [product()]);
  assert.equal(result.rows[0].status, 'skipped');
  assert.equal(result.skipped, 1);
});

test('classification: changed row is updated and reports its write mask', () => {
  const result = classifyProductImport([classifyRow({ productName: 'Renamed' })], [product()]);
  assert.equal(result.rows[0].status, 'updated');
  assert.deepEqual(result.rows[0].changedFields, ['productName']);
  assert.equal(result.rows[0].productId, 'p1');
});

test('classification: an unrecognized category warns but does not error', () => {
  const result = classifyProductImport([classifyRow({ category: 'Nope' })], []);
  assert.equal(result.rows[0].status, 'new');
  assert.equal(result.rows[0].warnings.length, 1);
  assert.equal(result.hasErrors, false);
  assert.equal(result.rows[0].categoryId, null);
});

test('classification: duplicate request identities are errors on EVERY implicated row', () => {
  const result = classifyProductImport(
    [classifyRow({ rowNumber: 1, sku: 'DUP' }), classifyRow({ rowNumber: 2, sku: 'dup' })],
    []
  );
  assert.equal(result.rows[0].status, 'error');
  assert.equal(result.rows[1].status, 'error');
  assert.equal(result.hasErrors, true);
});

test('classification: two rows resolving to the same existing product are both errors', () => {
  const legacy = product({ id: 'target', sku: null, model: 'ABC' });
  const result = classifyProductImport(
    [
      classifyRow({ rowNumber: 1, sku: 'ABC', model: 'ABC' }),
      classifyRow({ rowNumber: 2, sku: null, model: 'ABC' }),
    ],
    [legacy]
  );
  assert.equal(result.hasErrors, true);
  assert.equal(result.rows.filter((row) => row.status === 'error').length, 2);
});

test('classification: an ambiguous catalog identity is an error', () => {
  const result = classifyProductImport(
    [classifyRow()],
    [product({ id: 'a' }), product({ id: 'b', sku: 'abc-123' })]
  );
  assert.equal(result.rows[0].status, 'error');
  assert.equal(result.rows[0].errors[0].code, 'product_identity_conflict');
});

test('classification: one error row does not suppress classification of the others', () => {
  const result = classifyProductImport(
    [
      classifyRow({ rowNumber: 1, sku: 'FINE' }),
      classifyRow({ rowNumber: 2, sku: 'DUP' }),
      classifyRow({ rowNumber: 3, sku: 'dup' }),
    ],
    []
  );
  assert.equal(result.rows[0].status, 'new');
  assert.equal(result.hasErrors, true);
});

// --- categories ----------------------------------------------------------------

test('category resolution accepts either the canonical id or the display name, case-insensitively', () => {
  assert.equal(resolveProductCategoryId('hot-plate'), 'hot-plate');
  assert.equal(resolveProductCategoryId('Hot Plate'), 'hot-plate');
  assert.equal(resolveProductCategoryId('  HOT PLATE  '), 'hot-plate');
  assert.equal(resolveProductCategoryId('Nope'), null);
  assert.equal(resolveProductCategoryId(null), null);
  assert.equal(resolveProductCategoryId(''), null);
});

test('the shared category list is the same object the mock fixture re-exports', async () => {
  const shared = await vite.ssrLoadModule('/src/services/productCategories.ts');
  const fixture = await vite.ssrLoadModule('/src/repositories/mockData/productMaster.mock.ts');
  assert.equal(fixture.productCategories, shared.productCategories);
});
