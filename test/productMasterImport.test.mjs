import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// Product Master Import — Phase PI-1. This file proves the existing Sprint
// P2/P3 Import Framework (src/imports/shared, src/imports/products) and its
// wizard/commit wiring (ImportProductsWizard.tsx, useProductMaster.ts)
// behave correctly for local/dev testing in Mock mode. It does NOT test any
// production write path — none exists; Firestore product writes remain
// denied at three independent layers (Rules, repository, UI gate), per
// DECISIONS.md #030, unchanged by this phase.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { parseCsv } = await vite.ssrLoadModule('/src/utils/csv.ts');
const { parseRows, getField, isBlankRow } = await vite.ssrLoadModule(
  '/src/imports/shared/parser.ts'
);
const { normalizeProductRow } = await vite.ssrLoadModule(
  '/src/imports/products/productNormalizer.ts'
);
const { validateProductImport } = await vite.ssrLoadModule(
  '/src/imports/products/productValidator.ts'
);
const { runProductImport } = await vite.ssrLoadModule(
  '/src/imports/products/productImporter.ts'
);
const { productMasterRepository } = await vite.ssrLoadModule(
  '/src/repositories/productMasterRepository.ts'
);
const { buildProductFromImportRecord, buildProductUpdatePatch } = await vite.ssrLoadModule(
  '/src/services/productMasterAdmin.ts'
);
const { canMutateProductCatalogForBackend, canImportProductCatalogForBackend } =
  await vite.ssrLoadModule('/src/services/productCatalogAccess.ts');
const { rejectClientProductMutation } = await vite.ssrLoadModule(
  '/src/repositories/firestoreProductMasterRepository.ts'
);
const { parseCanImportProducts } = await vite.ssrLoadModule('/src/auth/staffProfile.ts');
const {
  discard,
  mintIdempotencyKey,
  retainForRetry,
  startAttempt,
  persistAttempt,
  readPersistedAttempt,
  clearPersistedAttempt,
} = await vite.ssrLoadModule('/src/services/productImportPendingAttempt.ts');
const { ProductImportError } = await vite.ssrLoadModule('/src/repositories/types.ts');
const { createMockProductImportRepository } = await vite.ssrLoadModule(
  '/src/repositories/mockProductImportRepository.ts'
);
const { reduce: reduceWizardState, submitImport } = await vite.ssrLoadModule(
  '/src/features/master-data/products/components/import/importWizardController.ts'
);
const { buildCanonicalRequestString, parseProductImportRequest, sanitizeImportFileName } =
  await vite.ssrLoadModule('/src/services/productImportRequest.ts');
const { normalizeDisplayValue } = await vite.ssrLoadModule('/src/services/productIdentity.ts');

// A minimal in-memory Storage implementation for testing
// productImportPendingAttempt.ts's sessionStorage-backed functions without
// jsdom/a browser — the module only ever calls getItem/setItem/removeItem.
// `_map` is exposed for tests only (not part of the Storage interface) so a
// test can corrupt exactly the key the module itself wrote, without
// hardcoding the module's private storage key string.
// Strips // line comments and /* */ block comments so a source-scan
// assertion can check actual CODE for a forbidden identifier without
// tripping over the same word appearing in an explanatory comment (e.g. a
// module documenting "never a token/credential" in prose).
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function createFakeStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const KNOWN_CATEGORIES = [
  { id: 'hot-plate', name: 'Hot Plate' },
  { id: 'blender', name: 'Blender' },
];

function toCsvText(rows) {
  return rows.map((r) => r.join(',')).join('\r\n');
}

// --- CSV contract: template/export headers (established, must not drift) ---

test('CSV template and export headers match the established Product Master contract', async () => {
  const source = await readSource('src/services/productMasterExport.ts');
  const normalized = source.replace(/\s+/g, ' ');
  assert.match(
    normalized,
    /const EXPORT_HEADERS = \[ ?'Brand', 'SKU', 'Model', 'Product Name', 'Category', 'Warranty Months', 'Status', ?\];/
  );
  assert.match(
    normalized,
    /const TEMPLATE_HEADERS = \['Brand', 'SKU', 'Model', 'Product Name', 'Category'\];/
  );
});

// --- CSV parsing edge cases -----------------------------------------------

test('parseCsv handles a UTF-8 BOM on the first header without corrupting the first column name', () => {
  const withBom = '﻿Brand,SKU,Model,Product Name,Category\r\nBRUNO,ABC-123,ABC,Test,Hot Plate';
  const rows = parseCsv(withBom);
  assert.equal(rows[0][0], '﻿Brand');
  // getField/parseRows trims each header cell, and JS trim() strips U+FEFF
  // as whitespace, so the BOM must not survive into the parsed field key.
  const parsed = parseRows({ kind: 'matrix', header: rows[0], rows: rows.slice(1) });
  assert.equal(getField(parsed[0].fields, 'Brand'), 'BRUNO');
});

test('parseCsv skips truly blank lines and isBlankRow correctly identifies an all-empty row', () => {
  const text = toCsvText([
    ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
    ['BRUNO', 'ABC-123', 'ABC', 'Test Product', 'Hot Plate'],
    ['', '', '', '', ''],
    ['BRUNO', 'DEF-456', 'DEF', 'Test Product 2', 'Blender'],
  ]);
  const [header, ...dataRows] = parseCsv(text);
  const parsed = parseRows({ kind: 'matrix', header, rows: dataRows });
  assert.equal(parsed.length, 3);
  assert.equal(isBlankRow(parsed[1]), true);
  assert.equal(isBlankRow(parsed[0]), false);
});

test('runProductImport filters blank rows out of the preview entirely (not shown as errors)', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
    rows: [
      ['BRUNO', 'ABC-123', 'ABC', 'Test Product', 'Hot Plate'],
      ['', '', '', '', ''],
    ],
  });
  assert.equal(preview.summary.totalRows, 1);
});

test('getField is case-insensitive and whitespace-tolerant on header aliases', () => {
  const parsed = parseRows({
    kind: 'matrix',
    header: [' sku ', 'BRAND'],
    rows: [['ABC-123', 'BRUNO']],
  });
  assert.equal(getField(parsed[0].fields, 'SKU'), 'ABC-123');
  assert.equal(getField(parsed[0].fields, 'Brand'), 'BRUNO');
});

// --- Invalid/missing headers -----------------------------------------------

test('a row missing every recognizable column normalizes to an empty record and fails validation as MALFORMED_ROW', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Unrelated Column A', 'Unrelated Column B'],
    rows: [['foo', 'bar']],
  });
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].status, 'error');
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'MALFORMED_ROW'));
});

test('a row with SKU but no derivable Model and no explicit Model column still parses SKU as the model fallback (single-token SKU)', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Product Name'],
    rows: [['BRUNO', 'ABC123', 'Test Product']],
  });
  // No '-' separator in "ABC123" -> whole SKU becomes the model, no MISSING_MODEL.
  assert.equal(preview.rows[0].record.model, 'ABC123');
  assert.doesNotMatch(
    JSON.stringify(preview.rows[0].issues),
    /MISSING_MODEL/
  );
});

// --- Duplicate rows in the same CSV -----------------------------------------

test('duplicate SKU rows within one CSV are both flagged as errors (DUPLICATE_SKU) and blocked from import', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
    rows: [
      ['BRUNO', 'ABC-123', 'ABC', 'Test Product', 'Hot Plate'],
      ['BRUNO', 'ABC-123', 'ABC', 'Test Product Duplicate', 'Hot Plate'],
    ],
  });
  assert.equal(preview.rows[0].status, 'error');
  assert.equal(preview.rows[1].status, 'error');
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'DUPLICATE_SKU'));
  assert.ok(preview.rows[1].issues.some((i) => i.code === 'DUPLICATE_SKU'));
});

test('duplicate SKU detection is case-insensitive, matching matchStateFor\'s existing-product comparison policy', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
    rows: [
      ['BRUNO', 'ABC-123', 'ABC', 'Test Product', 'Hot Plate'],
      ['BRUNO', 'abc-123', 'ABC', 'Test Product', 'Hot Plate'],
    ],
  });
  assert.equal(preview.rows[0].status, 'error');
  assert.equal(preview.rows[1].status, 'error');
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'DUPLICATE_SKU'));
  // Each row's own original casing must still appear in its own message,
  // not a lossy normalized one.
  const msg0 = preview.rows[0].issues.find((i) => i.code === 'DUPLICATE_SKU').message;
  const msg1 = preview.rows[1].issues.find((i) => i.code === 'DUPLICATE_SKU').message;
  assert.match(msg0, /SKU "ABC-123"/);
  assert.match(msg1, /SKU "abc-123"/);
});

test('duplicate Model+Variant rows are a warning only, not blocked', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
    rows: [
      ['BRUNO', 'ABC-WH', 'ABC', 'Test Product White', 'Hot Plate'],
      ['BRUNO', 'ABC-BK', 'ABC', 'Test Product Black', 'Hot Plate'],
    ],
  });
  assert.equal(preview.rows[0].status, 'new');
  assert.equal(preview.rows[1].status, 'new');
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'DUPLICATE_MODEL' && i.severity === 'warning'));
});

// --- NEW / UPDATE / SKIP / ERROR classification -----------------------------

test('NEW: a SKU with no matching existing product classifies as new', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', 'NEW-001', 'NEW', 'Brand New Product', 'Hot Plate']],
    },
    { existingProducts: [], knownCategories: KNOWN_CATEGORIES }
  );
  assert.equal(preview.rows[0].status, 'new');
});

test('UPDATE: a SKU matching an existing product with a changed field classifies as updated', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', 'EXIST-001', 'EXIST', 'Renamed Product', 'Hot Plate']],
    },
    {
      existingProducts: [
        {
          sku: 'EXIST-001',
          brand: 'BRUNO',
          model: 'EXIST',
          productName: 'Old Name',
          categoryId: 'hot-plate',
        },
      ],
      knownCategories: KNOWN_CATEGORIES,
    }
  );
  assert.equal(preview.rows[0].status, 'updated');
});

test('SKIP: a SKU matching an existing product with identical fields classifies as skipped', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', 'EXIST-002', 'EXIST2', 'Same Name', 'Hot Plate']],
    },
    {
      existingProducts: [
        {
          sku: 'EXIST-002',
          brand: 'BRUNO',
          model: 'EXIST2',
          productName: 'Same Name',
          categoryId: 'hot-plate',
        },
      ],
      knownCategories: KNOWN_CATEGORIES,
    }
  );
  assert.equal(preview.rows[0].status, 'skipped');
});

test('ERROR: a row with a validation error is never new/updated/skipped, even if it would otherwise match', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', 'EXIST-003', 'EXIST3', '', 'Hot Plate']],
    },
    {
      existingProducts: [
        {
          sku: 'EXIST-003',
          brand: 'BRUNO',
          model: 'EXIST3',
          productName: 'Something',
          categoryId: 'hot-plate',
        },
      ],
      knownCategories: KNOWN_CATEGORIES,
    }
  );
  assert.equal(preview.rows[0].status, 'error');
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'EMPTY_PRODUCT_NAME'));
});

test('blank optional identifier: a row with no SKU always classifies as new (never matched against existing products)', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', '', 'SOME-MODEL', 'Product Without SKU', 'Hot Plate']],
    },
    {
      existingProducts: [
        {
          sku: 'SOME-MODEL',
          brand: 'BRUNO',
          model: 'SOME-MODEL',
          productName: 'Product Without SKU',
          categoryId: 'hot-plate',
        },
      ],
      knownCategories: KNOWN_CATEGORIES,
    }
  );
  assert.equal(preview.rows[0].status, 'new');
});

test('unrecognized category is a warning (INVALID_CATEGORY), not a blocking error, and the row still imports without a categoryId', () => {
  const preview = runProductImport(
    {
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Category'],
      rows: [['BRUNO', 'CAT-001', 'CAT', 'Test Product', 'Nonexistent Category']],
    },
    { existingProducts: [], knownCategories: KNOWN_CATEGORIES }
  );
  assert.equal(preview.rows[0].status, 'new');
  assert.equal(preview.rows[0].record.categoryId, undefined);
  assert.ok(preview.rows[0].issues.some((i) => i.code === 'INVALID_CATEGORY' && i.severity === 'warning'));
});

// --- Commit blocked while errors exist (wizard-level, structural) ----------
//
// PI-3 Slice 2 — commitImportRows is now async and delegates to the
// ProductImportRepository seam, so it no longer loops/skips rows itself;
// the skip-error/skipped-row behavior moved to the repository's
// classification pass (mockProductImportRepository.ts / the Worker's
// classifyProductImport), and "ANY ERROR blocks the whole import" is now
// enforced by importWizardController.ts's reducer, not the raw button
// attribute alone. See the reducer/controller tests below.

test('the wizard disables the import button while no importable rows exist or the preview has errors', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(
    source,
    /disabled=\{importableCount === 0 \|\| state\.preview\.summary\.errorCount > 0\}/
  );
});

test('importableCount only ever counts new+updated rows — error and skipped rows can never be included in a commit', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(
    source,
    /const importableCount =\s*\n\s*state\.step === 'validation' \|\| state\.step === 'submitting'\s*\n\s*\? state\.preview\.summary\.newCount \+ state\.preview\.summary\.updatedCount\s*\n\s*: 0;/
  );
});

test('mockProductImportRepository: a skipped row (already up to date) performs no write but is still reported in the committed rows, matching worker/src/productImport.ts', async () => {
  const repo = createMockProductImportRepository();
  const sku = `SKIPBEHAVIOR-${Date.now()}`;

  // First commit creates the product.
  const fingerprint1 = await buildFingerprintForCurrentCatalog();
  const createResult = await repo.commit(
    {
      version: 1,
      fileName: null,
      catalogFingerprint: fingerprint1,
      rows: [
        {
          rowNumber: 1,
          brand: 'SKIPBEHAVIOR',
          sku,
          model: 'SB',
          productName: 'Skip Behavior Test Product',
          category: null,
        },
      ],
    },
    `skip-behavior-create-${Date.now()}`
  );
  assert.equal(createResult.rows[0].status, 'new');
  const countAfterCreate = productMasterRepository.getProducts().length;

  // Second commit resubmits the IDENTICAL row (same brand/model/sku/name) —
  // classifies as 'skipped', must write nothing, but must still appear in
  // the response rows with status 'skipped' and the existing product's id.
  const fingerprint2 = await buildFingerprintForCurrentCatalog();
  const skipResult = await repo.commit(
    {
      version: 1,
      fileName: null,
      catalogFingerprint: fingerprint2,
      rows: [
        {
          rowNumber: 1,
          brand: 'SKIPBEHAVIOR',
          sku,
          model: 'SB',
          productName: 'Skip Behavior Test Product',
          category: null,
        },
      ],
    },
    `skip-behavior-skip-${Date.now()}`
  );

  assert.equal(productMasterRepository.getProducts().length, countAfterCreate, 'a skipped row must write nothing');
  assert.equal(skipResult.rows.length, 1);
  assert.equal(skipResult.rows[0].status, 'skipped');
  assert.equal(skipResult.rows[0].productId, createResult.rows[0].productId);
});

test('mockProductImportRepository: a request with any error row (duplicate identity) writes nothing — ANY ERROR blocks the whole import', async () => {
  const repo = createMockProductImportRepository();
  const countBefore = productMasterRepository.getProducts().length;
  const fingerprint = await buildFingerprintForCurrentCatalog();
  const sharedSku = `ANYERROR-DUP-${Date.now()}`;

  await assert.rejects(
    () =>
      repo.commit(
        {
          version: 1,
          fileName: null,
          catalogFingerprint: fingerprint,
          rows: [
            { rowNumber: 1, brand: 'ANYERROR', sku: sharedSku, model: 'AE1', productName: 'A', category: null },
            { rowNumber: 2, brand: 'ANYERROR', sku: sharedSku, model: 'AE2', productName: 'B', category: null },
          ],
        },
        `any-error-key-${Date.now()}`
      ),
    (error) => error instanceof ProductImportError && error.code === 'validation_failed'
  );
  assert.equal(productMasterRepository.getProducts().length, countBefore, 'no row may be written when any row in the request errors');
});

// --- Double submit -----------------------------------------------------------
//
// PI-3 Slice 2 — commitImportRows is now async, so a useState flag can no
// longer fail closed synchronously across two rapid clicks (the second
// click's handler can run before React re-renders the disabled button).
// The guard is now a useRef admission latch, checked and set BEFORE any
// dispatch/await in the click handler — see PI-3 Slice 2 handoff #9. The
// reducer itself is a second, independent line of defense: it can never
// re-enter 'submitting' from 'submitting' on a 'submit' action.

test('the wizard\'s import handler uses a synchronous useRef admission latch, checked and set before any dispatch/await', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(source, /const admissionLatch = useRef\(false\);/);
  const handlerMatch = source.match(/const handleImport = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.notEqual(handlerMatch, null);
  const guardIndex = handlerMatch[0].indexOf('if (admissionLatch.current) return;');
  const setTrueIndex = handlerMatch[0].indexOf('admissionLatch.current = true;');
  const dispatchIndex = handlerMatch[0].indexOf("dispatch({ type: 'submit' });");
  const runSubmitIndex = handlerMatch[0].indexOf('void runSubmit(');
  assert.ok(guardIndex >= 0 && guardIndex < setTrueIndex);
  assert.ok(setTrueIndex < dispatchIndex);
  assert.ok(dispatchIndex < runSubmitIndex);
});

test('importWizardController never re-enters submitting from submitting on a submit action (defense in depth independent of the ref)', () => {
  const submittingState = {
    step: 'submitting',
    file: { fileName: 'f.csv', header: [], rows: [] },
    preview: {
      summary: {
        totalRows: 1,
        newCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        warningCount: 0,
      },
      rows: [],
    },
    retryMessage: null,
  };
  const next = reduceWizardState(submittingState, { type: 'submit' });
  assert.equal(next, submittingState);
});

test('demonstrates why the UI guard is necessary: commitImportRows on the raw mock repository is not itself idempotent — calling it twice with the same NEW row creates two products', () => {
  // Uses the mock repository directly (not the React hook, which cannot be
  // mounted in this test environment) to prove the underlying write is not
  // safe to double-fire — this is exactly the race the wizard-level guard
  // above exists to prevent.
  const existingIds = new Set(productMasterRepository.getProducts().map((p) => p.id));
  const record = {
    brand: 'DOUBLESUBMIT',
    model: 'DS-1',
    sku: 'DS-1-TEST',
    productName: 'Double Submit Test Product',
  };
  const entry = buildProductFromImportRecord(record, existingIds);
  productMasterRepository.createProduct(entry);
  // Simulate a second, distinct id being generated for the same logical
  // record (as would happen if handleImport ran a second time before any
  // state update reflected the first commit).
  const existingIdsAfterFirst = new Set(
    productMasterRepository.getProducts().map((p) => p.id)
  );
  const secondEntry = buildProductFromImportRecord(record, existingIdsAfterFirst);
  productMasterRepository.createProduct(secondEntry);

  const matches = productMasterRepository
    .getProducts()
    .filter((p) => p.sku === 'DS-1-TEST');
  assert.equal(matches.length, 2, 'without the UI guard, two products would exist for one row');
  assert.notEqual(entry.id, secondEntry.id);
});

// --- Authorization / write boundary (existing three-layer deny, unchanged) --

// PI-3 — this assertion is UNCHANGED in substance and deliberately so.
// Adding privileged import must not loosen direct client mutation by even a
// little: Add Product / Edit Product remain unavailable in production, and
// the Firestore repository still refuses a direct write. The new capability
// is a separate predicate (canImportProductCatalog), not a relaxation of
// this one.
test('direct Product Master mutation is STILL Mock-only, and Firestore client mutation is still rejected, even with privileged import implemented', () => {
  assert.equal(canMutateProductCatalogForBackend('mock'), true);
  assert.equal(canMutateProductCatalogForBackend('firestore'), false);
  assert.equal(canMutateProductCatalogForBackend(null), false);
  assert.throws(() => rejectClientProductMutation(), /privileged catalog workflow/);
});

test('Firestore Rules still deny every client write to products/{productId} unconditionally', async () => {
  const rules = await readSource('firestore.rules');
  assert.match(
    rules,
    /match \/products\/\{productId\} \{\s*\n\s*allow get, list: if validStaff\(\);\s*\n\s*allow create, update, delete: if false;\s*\n\s*\}/
  );
});

// PI-3 — this test previously asserted the OPPOSITE (that no Worker product
// route existed). That was correct for PI-1, when no privileged workflow had
// been approved. PI-2 approved it and PI-3 implements it, so the assertion is
// inverted rather than deleted: the point being protected is still that
// exactly ONE product write path exists and it is the privileged Worker one.
test('the privileged Worker product-import route exists and is the only product write path', async () => {
  const source = await readSource('worker/src/index.ts');
  assert.match(source, /const PRODUCTS_IMPORT_PATH = '\/products\/import';/);
  assert.match(source, /url\.pathname === PRODUCTS_IMPORT_PATH/);

  // Import is the only product route. Asserted by counting product path
  // CONSTANTS and their dispatch sites — the dispatch chain references the
  // constant, never a bare '/products' literal, so matching on the literal
  // would silently match nothing and prove nothing.
  const productPathConstants = source.match(/^const PRODUCTS?_\w*PATH\b/gm) ?? [];
  assert.equal(productPathConstants.length, 1);
  const dispatchSites = source.match(/url\.pathname === PRODUCTS_IMPORT_PATH/g) ?? [];
  assert.equal(dispatchSites.length, 1);
  assert.doesNotMatch(source, /handleProductDelete|handleProductUpdate|handleProductList/);
});

test('the Worker import route is gated on the dedicated canImportProducts permission, not merely on being staff', async () => {
  const source = await readSource('worker/src/index.ts');
  assert.match(source, /authorizeProductImport/);
  assert.match(source, /!profile\.canImportProducts/);
  // It must not reuse authorizeStaffCreation, which grants any valid staff
  // member and collapses 401 into 403.
  const handler = source.match(
    /async function handleProductImport\([\s\S]*?\n\}/
  );
  assert.notEqual(handler, null);
  assert.doesNotMatch(handler[0], /authorizeStaffCreation/);
});

test('the Worker never accepts client-supplied product identity or admin fields', async () => {
  const source = await readSource('src/services/productImportRequest.ts');
  for (const forbidden of [
    'id',
    'productId',
    'status',
    'warrantyMonths',
    'createdAt',
    'updatedAt',
    'actorUid',
    'accessoryIds',
  ]) {
    assert.match(source, new RegExp(`'${forbidden}'`));
  }
});

test('CSV import never assigns a trusted server-side identity — the product id is always freshly generated, never taken from the CSV', async () => {
  const source = await readSource('src/services/productMasterAdmin.ts');
  assert.match(
    source,
    /id: generateProductId\(record\.brand, record\.model, existingIds\),/
  );
  assert.doesNotMatch(source, /createdBy|updatedBy|serverTimestamp/);
});

test('Products are a global reference catalog (DECISIONS.md #030), not brand-authorized — cross-brand rejection does not apply to Product Master import', async () => {
  const decisions = await readSource('DECISIONS.md');
  assert.match(
    decisions,
    /Products are a global reference catalog, not a brand-authorized resource/
  );
});

// --- Historical Service Job safety ------------------------------------------

test('Service Job creation snapshots product fields at intake time rather than referencing Product Master live — updating a product cannot retroactively rewrite an existing Service Job', async () => {
  const source = await readSource('src/services/serviceJobCreation.ts');
  // The Service Job's product/model/category fields are written once from
  // the intake input at creation time; nothing in this file reads back
  // from repositories.productMaster to keep them "live".
  assert.doesNotMatch(source, /repositories\.productMaster/);
});

// --- Reload after commit / read behavior unchanged --------------------------

test('createProduct/updateProduct on the mock repository are immediately visible via getProducts (what commitImportRows/addProduct reload from)', () => {
  const before = productMasterRepository.getProducts().length;
  const existingIds = new Set(productMasterRepository.getProducts().map((p) => p.id));
  const entry = buildProductFromImportRecord(
    { brand: 'RELOAD', model: 'RL-1', sku: 'RL-1-TEST', productName: 'Reload Test' },
    existingIds
  );
  productMasterRepository.createProduct(entry);
  const after = productMasterRepository.getProducts();
  assert.equal(after.length, before + 1);
  assert.ok(after.some((p) => p.id === entry.id));

  const patch = buildProductUpdatePatch({
    brand: 'RELOAD',
    model: 'RL-1',
    sku: 'RL-1-TEST',
    productName: 'Reload Test Renamed',
  });
  productMasterRepository.updateProduct(entry.id, patch);
  const updated = productMasterRepository.getProductById(entry.id);
  assert.equal(updated.name, 'Reload Test Renamed');
});

test('useProductMaster reloads from the repository (not local mutation only) after both addProduct and commitImportRows', async () => {
  const source = await readSource('src/hooks/useProductMaster.ts');
  const setProductsCalls = source.match(/setProducts\(repositories\.productMaster\.getProducts\(\)\)/g) ?? [];
  assert.equal(setProductsCalls.length, 2, 'expected one reload in addProduct and one in commitImportRows');
});

test('old Product Master read behavior (getCategories/getProductById) is unaffected by this phase', () => {
  const categories = productMasterRepository.getCategories();
  assert.ok(Array.isArray(categories));
  const products = productMasterRepository.getProducts();
  if (products.length > 0) {
    const found = productMasterRepository.getProductById(products[0].id);
    assert.equal(found?.id, products[0].id);
  }
});

// --- UI wiring: import action present alongside template/export ------------

test('the Product Master page still renders นำเข้าสินค้า alongside แม่แบบ/ส่งออก, now gated by canImportProductCatalog rather than canEdit', async () => {
  const source = await readSource('src/features/master-data/products/pages/ProductsPage.tsx');
  assert.match(source, /นำเข้าสินค้า/);
  assert.match(source, /canImportProductCatalog && \(/);
  assert.match(source, /<ImportProductsWizard/);
  // canEdit and canImportProductCatalog are independently computed and used
  // — Add/Edit staying unavailable in production must never be a side
  // effect of wiring Import's own gate (PI-3 Slice 2 #16/#17).
  assert.match(source, /canEdit,\s*\n\s*canImportProductCatalog,/);
});

// =============================================================================
// PI-3 Slice 2 — Production Import browser integration
// =============================================================================

// --- canImportProductCatalog: a separate predicate from canMutateProductCatalog

test('canImportProductCatalogForBackend: mock is always import-capable, Firestore reflects the staff flag, anything else is denied', () => {
  assert.equal(canImportProductCatalogForBackend('mock', false), true);
  assert.equal(canImportProductCatalogForBackend('mock', true), true);
  assert.equal(canImportProductCatalogForBackend('firestore', true), true);
  assert.equal(canImportProductCatalogForBackend('firestore', false), false);
  assert.equal(canImportProductCatalogForBackend(null, true), false);
});

test('parseCanImportProducts fails closed on anything but a literal boolean true', () => {
  assert.equal(parseCanImportProducts(true), true);
  assert.equal(parseCanImportProducts(false), false);
  assert.equal(parseCanImportProducts(undefined), false);
  assert.equal(parseCanImportProducts('true'), false);
  assert.equal(parseCanImportProducts(1), false);
});

// --- importWizardController: pure state machine ----------------------------

const baseFile = { fileName: 'products.csv', header: [], rows: [] };
const previewWithErrors = {
  summary: { totalRows: 2, newCount: 1, updatedCount: 0, skippedCount: 0, errorCount: 1, warningCount: 0 },
  rows: [],
};
const cleanPreview = {
  summary: { totalRows: 1, newCount: 1, updatedCount: 0, skippedCount: 0, errorCount: 0, warningCount: 0 },
  rows: [],
};

test('importWizardController blocks submit -> submitting while the preview has any error row (PI-3 Slice 2 #10)', () => {
  const state = { step: 'validation', file: baseFile, preview: previewWithErrors };
  const next = reduceWizardState(state, { type: 'submit' });
  assert.equal(next, state, 'a preview with errorCount > 0 must never reach submitting');
});

test('importWizardController allows submit -> submitting once the preview is error-free', () => {
  const state = { step: 'validation', file: baseFile, preview: cleanPreview };
  const next = reduceWizardState(state, { type: 'submit' });
  assert.equal(next.step, 'submitting');
  assert.equal(next.retryMessage, null);
});

test('importWizardController: ambiguous failure stays in submitting with a retryMessage (same-key retry eligible)', () => {
  const submitting = { step: 'submitting', file: baseFile, preview: cleanPreview, retryMessage: null };
  const next = reduceWizardState(submitting, {
    type: 'commitFailedAmbiguous',
    message: 'network error',
  });
  assert.equal(next.step, 'submitting');
  assert.equal(next.retryMessage, 'network error');
});

test('importWizardController: stale_catalog transitions to staleCatalog, never auto-resubmits', () => {
  const submitting = { step: 'submitting', file: baseFile, preview: cleanPreview, retryMessage: null };
  const next = reduceWizardState(submitting, { type: 'commitFailedStale' });
  assert.equal(next.step, 'staleCatalog');
  assert.equal(next.file, baseFile);
});

test('importWizardController: a conclusive failure transitions to a hard-stop error state', () => {
  const submitting = { step: 'submitting', file: baseFile, preview: cleanPreview, retryMessage: null };
  const next = reduceWizardState(submitting, {
    type: 'commitFailedConclusive',
    message: 'validation failed',
  });
  assert.equal(next.step, 'error');
  assert.equal(next.message, 'validation failed');
});

test('importWizardController: success carries the preview summary through to the result step', () => {
  const submitting = { step: 'submitting', file: baseFile, preview: cleanPreview, retryMessage: null };
  const next = reduceWizardState(submitting, {
    type: 'commitSucceeded',
    result: { created: 1, updated: 0 },
  });
  assert.equal(next.step, 'result');
  assert.equal(next.summary, cleanPreview.summary);
});

test('submitImport maps a stale_catalog ProductImportError to commitFailedStale', async () => {
  const action = await submitImport(async () => {
    throw new ProductImportError('stale', 409, 'stale_catalog');
  }, 'key-1');
  assert.equal(action.type, 'commitFailedStale');
});

test('submitImport maps a conclusive (4xx) ProductImportError to commitFailedConclusive', async () => {
  const action = await submitImport(async () => {
    throw new ProductImportError('bad request', 400, 'validation_failed');
  }, 'key-1');
  assert.equal(action.type, 'commitFailedConclusive');
});

test('submitImport maps a 5xx/no-status ProductImportError, and a raw thrown error, to commitFailedAmbiguous', async () => {
  const fromServerError = await submitImport(async () => {
    throw new ProductImportError('down', 503, 'dependency_unavailable');
  }, 'key-1');
  assert.equal(fromServerError.type, 'commitFailedAmbiguous');

  const fromNetworkError = await submitImport(async () => {
    throw new Error('fetch failed');
  }, 'key-1');
  assert.equal(fromNetworkError.type, 'commitFailedAmbiguous');
});

test('submitImport maps a successful commit to commitSucceeded', async () => {
  const action = await submitImport(async () => ({ created: 2, updated: 1 }), 'key-1');
  assert.deepEqual(action, { type: 'commitSucceeded', result: { created: 2, updated: 1 } });
});

// --- productImportPendingAttempt --------------------------------------------

test('productImportPendingAttempt: discard() always returns idle', () => {
  assert.deepEqual(discard(), { kind: 'idle' });
});

test('productImportPendingAttempt: retainForRetry returns the same active state unchanged (same-key retry marker)', () => {
  const active = startAttempt('abc-123');
  assert.equal(retainForRetry(active), active);
});

test('productImportPendingAttempt: mintIdempotencyKey returns distinct non-empty strings', () => {
  const first = mintIdempotencyKey();
  const second = mintIdempotencyKey();
  assert.ok(typeof first === 'string' && first.length > 0);
  assert.notEqual(first, second);
});

// --- mockProductImportRepository --------------------------------------------

function currentCatalog() {
  return productMasterRepository.getProducts().map((product) => ({
    id: product.id,
    sku: product.sku ?? null,
    brand: product.brand,
    model: product.model,
    productName: product.name,
    categoryId: product.categoryId || null,
  }));
}

async function buildFingerprintForCurrentCatalog() {
  const { computeCatalogFingerprint } = await vite.ssrLoadModule(
    '/src/services/productCatalogFingerprint.ts'
  );
  return computeCatalogFingerprint(currentCatalog());
}

test('mockProductImportRepository: a fingerprint mismatch throws stale_catalog before writing anything', async () => {
  const repo = createMockProductImportRepository();
  const countBefore = productMasterRepository.getProducts().length;
  await assert.rejects(
    () =>
      repo.commit(
        {
          version: 1,
          fileName: null,
          catalogFingerprint: '0'.repeat(64),
          rows: [
            {
              rowNumber: 1,
              brand: 'STALECHECK',
              sku: 'STALE-1',
              model: 'STALE',
              productName: 'Stale Test Product',
              category: null,
            },
          ],
        },
        `stale-key-${Date.now()}`
      ),
    (error) => error instanceof ProductImportError && error.code === 'stale_catalog'
  );
  assert.equal(productMasterRepository.getProducts().length, countBefore);
});

test('mockProductImportRepository: replaying the same idempotency key with the same request returns replayed:true and performs no additional writes', async () => {
  const repo = createMockProductImportRepository();
  const key = `replay-key-${Date.now()}`;
  const buildRequest = async () => ({
    version: 1,
    fileName: null,
    catalogFingerprint: await buildFingerprintForCurrentCatalog(),
    rows: [
      {
        rowNumber: 1,
        brand: 'REPLAYCHECK',
        sku: `REPLAY-${Date.now()}`,
        model: 'REPLAY',
        productName: 'Replay Test Product',
        category: null,
      },
    ],
  });

  const request = await buildRequest();
  const first = await repo.commit(request, key);
  assert.equal(first.replayed, false);
  const countAfterFirst = productMasterRepository.getProducts().length;

  const second = await repo.commit(request, key);
  assert.equal(second.replayed, true);
  assert.equal(productMasterRepository.getProducts().length, countAfterFirst);
});

test('mockProductImportRepository: reusing an idempotency key with a different request throws idempotency_mismatch', async () => {
  const repo = createMockProductImportRepository();
  const key = `mismatch-key-${Date.now()}`;
  const fingerprint = await buildFingerprintForCurrentCatalog();
  await repo.commit(
    {
      version: 1,
      fileName: null,
      catalogFingerprint: fingerprint,
      rows: [
        {
          rowNumber: 1,
          brand: 'MISMATCH-A',
          sku: `MISMATCH-A-${Date.now()}`,
          model: 'MA',
          productName: 'Mismatch A',
          category: null,
        },
      ],
    },
    key
  );

  await assert.rejects(
    () =>
      repo.commit(
        {
          version: 1,
          fileName: null,
          catalogFingerprint: fingerprint,
          rows: [
            {
              rowNumber: 1,
              brand: 'MISMATCH-B',
              sku: `MISMATCH-B-${Date.now()}`,
              model: 'MB',
              productName: 'Mismatch B',
              category: null,
            },
          ],
        },
        key
      ),
    (error) => error instanceof ProductImportError && error.code === 'idempotency_mismatch'
  );
});

// --- Modal preventClose ------------------------------------------------------

test('Modal routes overlay-click, the X button, and Escape all through one handleClose that checks preventClose', async () => {
  const source = await readSource('src/shared/components/Modal.tsx');
  assert.match(source, /preventClose\?: boolean;/);
  assert.match(source, /const handleClose = \(\) => \{\s*\n\s*if \(!preventClose\) onClose\(\);/);
  assert.match(source, /onClick=\{handleClose\}/g);
  const overlayAndButtonClicks = source.match(/onClick=\{handleClose\}/g) ?? [];
  assert.equal(overlayAndButtonClicks.length, 2, 'both the overlay and the X button must use handleClose');
  assert.match(source, /if \(!preventCloseRef\.current\) onCloseRef\.current\(\);/);
});

// =============================================================================
// PI-3 Slice 2 reconciliation — canonical refresh, stale_catalog refresh,
// session-persisted ambiguous retry (Phase A/B/C of the reconciliation pass)
// =============================================================================

// --- #A1 / #1 / #2 — canonical Product refresh after commit/replay ---------

test('ProductMasterRepository.refreshFromServer exists and is called unconditionally after every successful commitImportRows outcome (fresh AND replayed alike)', async () => {
  const typesSource = await readSource('src/repositories/types.ts');
  assert.match(typesSource, /refreshFromServer\(productIds\?: readonly string\[\]\): Promise<void>;/);

  const hookSource = await readSource('src/hooks/useProductMaster.ts');
  assert.match(
    hookSource,
    /await repositories\.productMaster\.refreshFromServer\(\s*\n\s*result\.rows\.map\(\(row\) => row\.productId\)\s*\n\s*\);/
  );
  // No branch on result.replayed before the refresh call — one code path
  // covers both a fresh commit and a safe replay by construction, not by
  // two call sites that could drift apart.
  assert.doesNotMatch(hookSource, /if \(result\.replayed\)/);
});

test('firestoreProductMasterRepository.refreshFromServer forces a genuine Firestore SERVER round-trip (getDocFromServer/getDocsFromServer), never a cache-only read', async () => {
  const source = await readSource('src/repositories/firestoreProductMasterRepository.ts');
  assert.match(source, /getDocFromServer,/);
  assert.match(source, /getDocsFromServer,/);
  assert.match(source, /getDocFromServer\(doc\(firestore, PRODUCTS_COLLECTION, id\)\)/);
  assert.match(source, /getDocsFromServer\(collection\(firestore, PRODUCTS_COLLECTION\)\)/);
});

test('the mock ProductMasterRepository.refreshFromServer is a documented no-op — its Map is already synchronously authoritative for every writer, including mockProductImportRepository', async () => {
  const source = await readSource('src/repositories/productMasterRepository.ts');
  assert.match(source, /async refreshFromServer\(\) \{\}/);
});

test('the unavailable RepositoryProvider stub wires refreshFromServer through the same reject() every other unimplemented mutation uses', async () => {
  const source = await readSource('src/repositories/repositoryProvider.ts');
  assert.match(source, /refreshFromServer: reject,/);
});

// --- #A1 wire-shape correctness — ProductImportCommitResult.rows must match
// the ACTUAL Worker response, not the classification-time row shape --------

test('ProductImportCommitResult.rows matches worker/src/productImport.ts\'s CompletedProductImportRow exactly (rowNumber/status/productId/warnings — never the full classification row)', async () => {
  const typesSource = await readSource('src/repositories/types.ts');
  assert.match(
    typesSource,
    /export interface ProductImportCommittedRow \{\s*\n\s*rowNumber: number;\s*\n\s*status: 'new' \| 'updated' \| 'skipped';\s*\n\s*productId: string;\s*\n\s*warnings: string\[\];\s*\n\s*\}/
  );
  assert.match(typesSource, /rows: ProductImportCommittedRow\[\];/);

  const workerSource = await readSource('worker/src/productImport.ts');
  assert.match(
    workerSource,
    /export interface CompletedProductImportRow \{[\s\S]*?rowNumber: number;[\s\S]*?status: 'new' \| 'updated' \| 'skipped';[\s\S]*?productId: string;[\s\S]*?warnings: string\[\];[\s\S]*?\}/
  );
});

test('ProductImportError.rowErrors matches the Worker\'s validation_failed body exactly ({rowNumber, errors}[]), never the full classification row', async () => {
  const typesSource = await readSource('src/repositories/types.ts');
  assert.match(
    typesSource,
    /export interface ProductImportRowError \{\s*\n\s*rowNumber: number;\s*\n\s*errors: ProductImportRowIssue\[\];\s*\n\s*\}/
  );

  const workerSource = await readSource('worker/src/index.ts');
  assert.match(
    workerSource,
    /rows: error\.rows\s*\n\s*\.filter\(\(row\) => row\.errors\.length > 0\)\s*\n\s*\.map\(\(row\) => \(\{ rowNumber: row\.rowNumber, errors: row\.errors \}\)\)/
  );

  const mockSource = await readSource('src/repositories/mockProductImportRepository.ts');
  assert.match(
    mockSource,
    /classification\.rows\s*\n\s*\.filter\(\(row\) => row\.errors\.length > 0\)\s*\n\s*\.map\(\(row\) => \(\{ rowNumber: row\.rowNumber, errors: row\.errors \}\)\)/
  );
});

test('mockProductImportRepository.commit returns rows in the corrected CompletedProductImportRow-equivalent shape for a real create', async () => {
  const repo = createMockProductImportRepository();
  const fingerprint = await buildFingerprintForCurrentCatalog();
  const result = await repo.commit(
    {
      version: 1,
      fileName: null,
      catalogFingerprint: fingerprint,
      rows: [
        {
          rowNumber: 1,
          brand: 'WIRESHAPE',
          sku: `WIRESHAPE-${Date.now()}`,
          model: 'WS',
          productName: 'Wire Shape Test',
          category: null,
        },
      ],
    },
    `wire-shape-key-${Date.now()}`
  );
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(typeof row.rowNumber, 'number');
  assert.equal(row.status, 'new');
  assert.equal(typeof row.productId, 'string');
  assert.ok(row.productId.length > 0);
  assert.ok(Array.isArray(row.warnings));
  assert.equal('changedFields' in row, false, 'the committed-row shape must NOT carry classification-only fields');
  assert.equal('categoryId' in row, false, 'the committed-row shape must NOT carry classification-only fields');
  assert.equal('errors' in row, false, 'the committed-row shape must NOT carry classification-only fields');
});

// --- #A2 / #3 / #4 / #5 — stale_catalog: refresh before re-preview, never
// auto-commit, always mint a NEW key -----------------------------------------

test('stale_catalog recovery refreshes canonical Products BEFORE rebuilding the preview, and burns the old key first (never auto-committed with a stale key)', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  const handlerMatch = source.match(
    /const handleRefreshAfterStale = async \(\) => \{[\s\S]*?\n {2}\};/
  );
  assert.notEqual(handlerMatch, null);
  const discardIndex = handlerMatch[0].indexOf('setPending(discard());');
  const refreshIndex = handlerMatch[0].indexOf('await refreshAndRebuildImportContext();');
  const runPreviewIndex = handlerMatch[0].indexOf('runPreview(file, context);');
  assert.ok(discardIndex >= 0 && discardIndex < refreshIndex, 'the stale key must be discarded before refreshing');
  assert.ok(refreshIndex < runPreviewIndex, 'the refresh must complete BEFORE the preview is rebuilt — never re-preview against the same stale list');
});

test('the wizard never calls the plain synchronous buildImportContext() for stale_catalog recovery — only refreshAndRebuildImportContext', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  const handlerMatch = source.match(
    /const handleRefreshAfterStale = async \(\) => \{[\s\S]*?\n {2}\};/
  );
  assert.notEqual(handlerMatch, null);
  // \b, not a bare substring match: "refreshAndRebuildImportContext()" itself
  // contains "buildImportContext" as a substring (…Re + buildImportContext…),
  // so an unanchored check would false-positive on the very call this test
  // exists to require.
  assert.doesNotMatch(handlerMatch[0], /\bbuildImportContext\(\)/);
});

test('after stale_catalog discard(), the wizard\'s own key-selection logic can only mint a NEW key — idle state never supplies one to reuse', async () => {
  const afterDiscard = discard();
  assert.equal(afterDiscard.kind, 'idle');

  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(
    source,
    /const key = pending\.kind === 'active' \? pending\.idempotencyKey : mintIdempotencyKey\(\);/
  );
});

test('importWizardController: stale_catalog is treated as CONCLUSIVE by submitImport (never retried automatically like an ambiguous failure)', async () => {
  const action = await submitImport(async () => {
    throw new ProductImportError('stale', 409, 'stale_catalog');
  }, 'key-stale-conclusive');
  assert.equal(action.type, 'commitFailedStale');
  // Distinct from the ambiguous path — proven separately below — confirming
  // the two never collapse into the same recovery behavior.
});

// --- #A3 / #6 / #7 / #8 / #9 / #10 / #11 — session-persisted ambiguous
// retry: survives remount/refresh, strict parsing, never stores secrets ----

test('commitImportRows treats an ambiguous ProductImportError (or a raw thrown error) as retaining the persisted attempt, and every conclusive outcome (including stale_catalog) as clearing it (#6/#7)', async () => {
  const source = await readSource('src/hooks/useProductMaster.ts');
  const catchMatch = source.match(/\} catch \(error\) \{[\s\S]*?\n {4}\}\n {2}\};/);
  assert.notEqual(catchMatch, null);
  assert.match(
    catchMatch[0],
    /const isAmbiguous = !\(error instanceof ProductImportError\) \|\| !error\.isConclusive;/
  );
  assert.match(catchMatch[0], /if \(!isAmbiguous\) \{\s*\n\s*clearPersistedAttempt\(\);\s*\n\s*\}/);
  assert.match(catchMatch[0], /throw error;/);
  // clearPersistedAttempt is unconditional on the success path too.
  assert.match(source, /clearPersistedAttempt\(\);\s*\n\s*await repositories\.productMaster\.refreshFromServer/);
});

test('commitImportRows reuses the persisted idempotency key only when the about-to-submit request canonically matches the persisted one (#8/#9)', async () => {
  const source = await readSource('src/hooks/useProductMaster.ts');
  assert.match(
    source,
    /const matchesPersisted =\s*\n\s*persisted !== null &&\s*\n\s*buildCanonicalRequestString\(persisted\.request\) === canonicalRequest;/
  );
  assert.match(source, /const effectiveKey = matchesPersisted \? persisted\.idempotencyKey : idempotencyKey;/);
  assert.match(source, /if \(!matchesPersisted\) \{\s*\n\s*persistAttempt\(effectiveKey, request\);\s*\n\s*\}/);
});

test('two independently-built ProductImportRequest objects with identical content produce the same canonical string; a genuinely different one does not (the mechanism session recovery relies on)', () => {
  const requestA = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'a'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const requestB = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'a'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  assert.equal(buildCanonicalRequestString(requestA), buildCanonicalRequestString(requestB));

  const requestC = { ...requestB, catalogFingerprint: 'b'.repeat(64) };
  assert.notEqual(buildCanonicalRequestString(requestA), buildCanonicalRequestString(requestC));
});

test('productImportPendingAttempt: persistAttempt + readPersistedAttempt round-trips a valid request across a simulated remount/refresh (#9)', () => {
  const storage = createFakeStorage();
  const request = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'c'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'REMOUNT', sku: 'RM-1', model: 'RM', productName: 'Remount Test', category: null }],
  };

  const key = mintIdempotencyKey();
  persistAttempt(key, request, storage);

  // Simulated remount: nothing but the storage handle survives — a brand
  // new call, not the same in-memory closure — exactly the gap #9 requires
  // recovery across.
  const recovered = readPersistedAttempt(storage);
  assert.notEqual(recovered, null);
  assert.equal(recovered.schemaVersion, 1);
  assert.equal(recovered.idempotencyKey, key);
  assert.deepEqual(recovered.request, request);

  // An identical rebuilt request matches; a genuinely different one (e.g.
  // the catalog changed) does not — the exact discriminator
  // useProductMaster.commitImportRows applies before reusing the key.
  const rebuiltIdentical = { ...request };
  assert.equal(
    buildCanonicalRequestString(recovered.request),
    buildCanonicalRequestString(rebuiltIdentical)
  );
  const genuinelyDifferent = { ...request, catalogFingerprint: 'd'.repeat(64) };
  assert.notEqual(
    buildCanonicalRequestString(recovered.request),
    buildCanonicalRequestString(genuinelyDifferent)
  );
});

test('productImportPendingAttempt: clearPersistedAttempt removes any stored attempt', () => {
  const storage = createFakeStorage();
  const request = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'e'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  persistAttempt(mintIdempotencyKey(), request, storage);
  assert.notEqual(readPersistedAttempt(storage), null);
  clearPersistedAttempt(storage);
  assert.equal(readPersistedAttempt(storage), null);
});

const VALID_UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';

test('productImportPendingAttempt: readPersistedAttempt strictly parses malformed/unsupported stored state AND actually removes it from storage, not merely ignores it (#10)', () => {
  const storage = createFakeStorage();
  const validRequest = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'f'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  const [storageKey] = storage._map.keys();
  assert.equal(typeof storageKey, 'string');

  const assertRejectedAndRemoved = (rawValue) => {
    storage._map.set(storageKey, rawValue);
    assert.equal(readPersistedAttempt(storage), null);
    // Not merely ignored — actually removed, so a later read (or a naive
    // caller that reads the raw storage entry directly) can never
    // re-encounter it.
    assert.equal(storage._map.has(storageKey), false);
  };

  // Garbage JSON.
  assertRejectedAndRemoved('not json {{{');

  // Oversized raw value — rejected (and removed) BEFORE JSON.parse is ever
  // attempted, so an arbitrarily large stored string can never linger.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  const oversized = JSON.stringify({
    schemaVersion: 1,
    idempotencyKey: VALID_UUID_V4,
    request: { ...validRequest, fileName: 'x'.repeat(600_000) },
  });
  assertRejectedAndRemoved(oversized);

  // Wrong schema version.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({ schemaVersion: 2, idempotencyKey: VALID_UUID_V4, request: validRequest })
  );

  // Extra outer key beyond {schemaVersion, idempotencyKey, request} — the
  // outer shape is an exact allowlist, not merely "at least these three."
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({
      schemaVersion: 1,
      idempotencyKey: VALID_UUID_V4,
      request: validRequest,
      extra: 'unexpected',
    })
  );

  // Missing/empty idempotency key.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({ schemaVersion: 1, idempotencyKey: '', request: validRequest })
  );

  // Idempotency key that is a non-empty string but not a valid UUIDv4 —
  // must be rejected just as strictly as an empty one.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({
      schemaVersion: 1,
      idempotencyKey: 'not-a-real-uuid',
      request: validRequest,
    })
  );

  // A request that fails the SAME authoritative parser the Worker uses
  // (here: an invalid catalog fingerprint format) must be discarded, not
  // trusted at face value.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({
      schemaVersion: 1,
      idempotencyKey: VALID_UUID_V4,
      request: { ...validRequest, catalogFingerprint: 'not-a-valid-hash' },
    })
  );

  // A request carrying a forbidden field (e.g. an attempted token/auth
  // smuggling field) must be discarded — parseProductImportRequest already
  // rejects it outright.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assertRejectedAndRemoved(
    JSON.stringify({
      schemaVersion: 1,
      idempotencyKey: VALID_UUID_V4,
      request: { ...validRequest, authorization: 'Bearer fake' },
    })
  );

  // A genuinely valid record still round-trips after all the above.
  storage._map.set(
    storageKey,
    JSON.stringify({ schemaVersion: 1, idempotencyKey: VALID_UUID_V4, request: validRequest })
  );
  assert.notEqual(readPersistedAttempt(storage), null);
});

test('productImportPendingAttempt: persistAttempt itself refuses to write an invalid idempotency key or an unvalidated request — the enforcement point is the actual persistence boundary, not caller discipline', () => {
  const storage = createFakeStorage();
  const validRequest = {
    version: 1,
    fileName: null,
    catalogFingerprint: 'a'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };

  // Not a UUIDv4 — nothing is written.
  persistAttempt('human-readable-key', validRequest, storage);
  assert.equal(storage._map.size, 0);

  // An unvalidated/malformed request (bad fingerprint format) — nothing is
  // written even though the idempotency key itself is valid.
  persistAttempt(VALID_UUID_V4, { ...validRequest, catalogFingerprint: 'bad' }, storage);
  assert.equal(storage._map.size, 0);

  // A request carrying a forbidden field — persistAttempt must not persist
  // it even transiently; the authoritative parser rejects it before any
  // sessionStorage write occurs.
  persistAttempt(VALID_UUID_V4, { ...validRequest, authorization: 'Bearer x' }, storage);
  assert.equal(storage._map.size, 0);

  // A genuinely valid pair succeeds.
  persistAttempt(VALID_UUID_V4, validRequest, storage);
  assert.equal(storage._map.size, 1);
});

test('productImportPendingAttempt: the persisted schema can never carry a token/credential — no such field exists, and forbidden auth fields are rejected by the authoritative request parser (#11)', async () => {
  const pendingSource = await readSource('src/services/productImportPendingAttempt.ts');
  // Scan CODE only — the module's own comments legitimately discuss why
  // tokens/credentials are excluded, which would otherwise self-trip this
  // check.
  assert.doesNotMatch(stripComments(pendingSource), /token|credential|password|bearer|idToken/i);

  const requestSource = await readSource('src/services/productImportRequest.ts');
  for (const forbidden of ['authorization', 'actorUid', 'canImportProducts']) {
    assert.match(requestSource, new RegExp(`'${forbidden}'`));
  }
});

test('the wizard\'s Modal is also prevented from closing during the stale_catalog server refresh, not only during commit', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(
    source,
    /const preventModalClose = state\.step === 'submitting' \|\| isRefreshingStale;/
  );
  assert.match(source, /preventClose=\{preventModalClose\}/);
});

// --- #12/#13/#14/#15 — re-confirm nothing regressed on the previously
// covered invariants (still enforced after the reconciliation edits) -------

test('reconciliation regression check: double-submit is still blocked synchronously, ANY ERROR still blocks submit, Add/Edit still unavailable, and Import still requires canImportProducts', async () => {
  // Double-submit: the useRef admission latch is still checked+set before
  // any dispatch/await (already exercised end-to-end above; here just a
  // presence check that the reconciliation pass didn't remove it).
  const wizardSource = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(wizardSource, /const admissionLatch = useRef\(false\);/);
  assert.match(wizardSource, /if \(admissionLatch\.current\) return;/);

  // ANY ERROR blocks submit (reducer-level).
  const blockedState = {
    step: 'validation',
    file: { fileName: 'f.csv', header: [], rows: [] },
    preview: {
      summary: { totalRows: 1, newCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 1, warningCount: 0 },
      rows: [],
    },
  };
  assert.equal(reduceWizardState(blockedState, { type: 'submit' }), blockedState);

  // Add/Edit still unavailable in Firestore/production.
  assert.equal(canMutateProductCatalogForBackend('firestore'), false);
  assert.throws(() => rejectClientProductMutation(), /privileged catalog workflow/);

  // Import still requires canImportProducts in Firestore/production.
  assert.equal(canImportProductCatalogForBackend('firestore', false), false);
  assert.equal(canImportProductCatalogForBackend('firestore', true), true);
  const workerSource = await readSource('worker/src/index.ts');
  assert.match(workerSource, /!profile\.canImportProducts/);
});

// =============================================================================
// PI-3C — PI-4 corrective fixes (7 SHOULD FIX findings)
// =============================================================================

// --- Fix 1: authoritative NFC display normalization ------------------------

test('parseProductImportRequest normalizes display text to NFC — canonically-equivalent composed/decomposed input produces IDENTICAL persisted values', () => {
  // "café" — é as one composed codepoint (NFC) vs "e" + a combining acute
  // accent (NFD). Visually and semantically identical; byte-for-byte
  // different strings until normalized.
  const nfcCafe = 'Caf\u00e9';
  const nfdCafe = 'Cafe\u0301';
  assert.notEqual(nfcCafe, nfdCafe, 'sanity: the two source strings are genuinely byte-different');
  assert.equal(
    nfcCafe.normalize('NFC'),
    nfdCafe.normalize('NFC'),
    'sanity: they are canonically equivalent'
  );

  // Hangul syllable "한" (a single precomposed codepoint) vs its canonical
  // decomposition into three conjoining jamo — a non-Latin example of the
  // same canonical-equivalence property, so the fix isn't Latin-only.
  const nfcHan = '\uD55C';
  const nfdHan = '\u1112\u1161\u11AB';
  assert.notEqual(nfcHan, nfdHan);
  assert.equal(nfcHan.normalize('NFC'), nfdHan.normalize('NFC'));

  const buildRequest = (productName) => ({
    version: 1,
    fileName: null,
    catalogFingerprint: '0'.repeat(64),
    rows: [
      { rowNumber: 1, brand: 'BRUNO', sku: 'SKU-1', model: 'M1', productName, category: null },
    ],
  });

  const fromNfc = parseProductImportRequest(buildRequest(nfcCafe));
  const fromNfd = parseProductImportRequest(buildRequest(nfdCafe));
  assert.equal(fromNfc.ok, true);
  assert.equal(fromNfd.ok, true);
  // Different canonical representations in => the SAME persisted value out
  // — identity is unified across the forgeable NFD form — and that unified
  // value is the NFC form specifically.
  assert.equal(fromNfc.value.rows[0].productName, fromNfd.value.rows[0].productName);
  assert.equal(fromNfd.value.rows[0].productName, nfcCafe);

  const fromNfcHan = parseProductImportRequest(buildRequest(nfcHan));
  const fromNfdHan = parseProductImportRequest(buildRequest(nfdHan));
  assert.equal(fromNfcHan.ok, true);
  assert.equal(fromNfdHan.ok, true);
  assert.equal(fromNfcHan.value.rows[0].productName, fromNfdHan.value.rows[0].productName);
  assert.equal(fromNfdHan.value.rows[0].productName, nfcHan);
});

test('parseProductImportRequest never lowercases display text — NFC only, never the NFKC+fold identity normalization', () => {
  const request = {
    version: 1,
    fileName: null,
    catalogFingerprint: '0'.repeat(64),
    rows: [
      {
        rowNumber: 1,
        brand: 'BRUNO Thailand',
        sku: 'ABC-123',
        model: 'M1',
        productName: 'Mixed CASE Name',
        category: null,
      },
    ],
  };
  const result = parseProductImportRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows[0].brand, 'BRUNO Thailand');
  assert.equal(result.value.rows[0].productName, 'Mixed CASE Name');
});

test('a Thai display value survives parseProductImportRequest unmangled', () => {
  const thaiName = 'เครื่องทำน้ำอุ่น';
  const request = {
    version: 1,
    fileName: null,
    catalogFingerprint: '0'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'BRUNO', sku: 'TH-1', model: 'TH', productName: thaiName, category: null }],
  };
  const result = parseProductImportRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows[0].productName, thaiName.normalize('NFC'));
});

test('boundedText normalizes to NFC before the control-character/formula/length checks, not after — a forged NFD value cannot slip a noncanonical string past validation', async () => {
  const source = await readSource('src/services/productImportRequest.ts');
  // Scoped to boundedText's own function body — sanitizeImportFileName
  // (Fix 2) also contains lines matching the same substrings
  // ("hasControlCharacters(normalized)", "looksLikeFormula(normalized)"),
  // so an unscoped source.indexOf would find THAT occurrence instead once
  // it was moved earlier in the file.
  const boundedTextMatch = source.match(/function boundedText\(([\s\S]*?)\n\}\n/);
  assert.notEqual(boundedTextMatch, null);
  const body = boundedTextMatch[0];
  const normalizedIndex = body.indexOf("const normalized = raw.normalize('NFC');");
  const controlCheckIndex = body.indexOf('if (hasControlCharacters(normalized))');
  const formulaCheckIndex = body.indexOf('if (looksLikeFormula(normalized))');
  const trimIndex = body.indexOf('const trimmed = normalized.trim();');
  assert.ok(normalizedIndex >= 0);
  assert.ok(normalizedIndex < controlCheckIndex);
  assert.ok(controlCheckIndex < formulaCheckIndex);
  assert.ok(formulaCheckIndex < trimIndex);
  // Identity normalization (NFKC + fold + lowercase) stays a separate,
  // downstream concern — never applied inside this parser.
  assert.doesNotMatch(source, /normalize\('NFKC'\)/);
});

// --- Fix 3: variant/color silent data loss -----------------------------------

test('productValidator: an explicit Variant/Variant Name/Color column with a nonblank value blocks the row with UNSUPPORTED_VARIANT', () => {
  for (const header of ['Variant', 'Variant Name', 'Color']) {
    const preview = runProductImport({
      kind: 'matrix',
      header: ['Brand', 'SKU', 'Model', 'Product Name', header],
      rows: [['BRUNO', `VARTEST-${header}`, 'VT', 'Variant Test Product', 'Red']],
    });
    assert.equal(preview.rows[0].status, 'error', `expected a blocking error for header "${header}"`);
    assert.ok(
      preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT' && i.severity === 'error'),
      `expected UNSUPPORTED_VARIANT for header "${header}"`
    );
  }
});

test('productValidator: an ordinary hyphenated SKU with NO explicit Variant/Color column is NOT blocked — legacy internal derivation stays harmless', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Product Name', 'Category'],
    rows: [['BRUNO', 'BOE021-WH', 'Test Product', 'Hot Plate']],
  });
  assert.notEqual(preview.rows[0].status, 'error');
  assert.ok(!preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
});

test('productValidator: a blank Variant/Color cell does not block the row', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Color'],
    rows: [['BRUNO', 'ABC-999', 'ABC', 'Test Product', '']],
  });
  assert.notEqual(preview.rows[0].status, 'error');
  assert.ok(!preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
});

test('the Production wire contract still forbids variant entirely — Fix 3 blocks the row instead of expanding the contract to accept it', async () => {
  const source = await readSource('src/services/productImportRequest.ts');
  assert.match(source, /'variant',/);
  const rowKeysMatch = source.match(/const ROW_KEYS = \[([\s\S]*?)\] as const;/);
  assert.notEqual(rowKeysMatch, null);
  assert.doesNotMatch(rowKeysMatch[1], /'variant'/);
});

// --- Fix 4: sanitized source filename ---------------------------------------

test('sanitizeImportFileName: a normal filename passes through, NFC-normalized and trimmed', () => {
  assert.equal(sanitizeImportFileName('products.csv'), 'products.csv');
  assert.equal(sanitizeImportFileName('  products.csv  '), 'products.csv');
});

test('sanitizeImportFileName: a path-like value is reduced to its basename only, regardless of separator style', () => {
  assert.equal(sanitizeImportFileName('C:\\Users\\staff\\Desktop\\products.csv'), 'products.csv');
  assert.equal(sanitizeImportFileName('/home/staff/products.csv'), 'products.csv');
  assert.equal(sanitizeImportFileName('../../etc/passwd'), 'passwd');
});

test('sanitizeImportFileName: control characters are rejected outright (null, never propagated)', () => {
  assert.equal(sanitizeImportFileName('products\r\n.csv'), null);
  assert.equal(sanitizeImportFileName('products\u0000.csv'), null);
});

test('sanitizeImportFileName: a formula-injection-looking name is rejected', () => {
  assert.equal(sanitizeImportFileName('=cmd|calc.csv'), null);
});

test('sanitizeImportFileName: an oversized filename is rejected (null) rather than failing the whole import over a cosmetic field', () => {
  assert.equal(sanitizeImportFileName(`${'a'.repeat(300)}.csv`), null);
});

test('sanitizeImportFileName: empty or whitespace-only input is null', () => {
  assert.equal(sanitizeImportFileName(''), null);
  assert.equal(sanitizeImportFileName('   '), null);
});

test('a sanitized filename can never itself fail parseProductImportRequest — the whole point of sanitizing client-side before submission', () => {
  const candidates = [
    'products.csv',
    'C:\\Users\\staff\\products.csv',
    '=evil.csv',
    '\u0000bad.csv',
    'x'.repeat(1000),
  ];
  for (const candidate of candidates) {
    const fileName = sanitizeImportFileName(candidate);
    const request = {
      version: 1,
      fileName,
      catalogFingerprint: '0'.repeat(64),
      rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
    };
    const result = parseProductImportRequest(request);
    assert.equal(result.ok, true, `sanitized fileName from "${candidate}" must never fail the request parser`);
  }
});

// =============================================================================
// PI-3D — PI-4R narrow corrective follow-up (3 SHOULD FIX findings)
// =============================================================================

// --- Fix 1: variant/color alias masking -------------------------------------

test('productValidator: an earlier BLANK variant alias never masks a later MEANINGFUL one — cases 1-4, 6', () => {
  const cases = [
    // 1: Variant="" + Color="Red"
    {
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant', 'Color'],
      values: ['BRUNO', 'AL-1', 'AL1', 'Alias Test', '', 'Red'],
    },
    // 2: Variant Name="" + Color="Blue"
    {
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant Name', 'Color'],
      values: ['BRUNO', 'AL-2', 'AL2', 'Alias Test', '', 'Blue'],
    },
    // 3: Variant="Black" + Color=""
    {
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant', 'Color'],
      values: ['BRUNO', 'AL-3', 'AL3', 'Alias Test', 'Black', ''],
    },
    // 4: Variant="Black" + Color="Red"
    {
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant', 'Color'],
      values: ['BRUNO', 'AL-4', 'AL4', 'Alias Test', 'Black', 'Red'],
    },
    // 6: only Color nonblank
    {
      header: ['Brand', 'SKU', 'Model', 'Product Name', 'Color'],
      values: ['BRUNO', 'AL-6', 'AL6', 'Alias Test', 'Red'],
    },
  ];
  for (const { header, values } of cases) {
    const preview = runProductImport({ kind: 'matrix', header, rows: [values] });
    assert.equal(
      preview.rows[0].status,
      'error',
      `expected ERROR for header=${JSON.stringify(header)} values=${JSON.stringify(values)}`
    );
    assert.ok(preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
  }
});

test('productValidator: all three variant aliases blank produces no UNSUPPORTED_VARIANT — case 5', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant', 'Variant Name', 'Color'],
    rows: [['BRUNO', 'AL-5', 'AL5', 'Alias Test', '', '', '']],
  });
  assert.notEqual(preview.rows[0].status, 'error');
  assert.ok(!preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
});

test('productValidator: an ordinary SKU-derived variant with no explicit alias column present at all is never blocked — case 7', () => {
  const preview = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Product Name', 'Category'],
    rows: [['BRUNO', 'BOE099-BK', 'Alias Test Product', 'Hot Plate']],
  });
  assert.notEqual(preview.rows[0].status, 'error');
  assert.ok(!preview.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
});

test('productValidator: alias COLUMN ORDER in the CSV never changes whether the row is blocked — case 8', () => {
  const orderA = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Variant', 'Color'],
    rows: [['BRUNO', 'ORD-1', 'ORD1', 'Order Test', '', 'Green']],
  });
  const orderB = runProductImport({
    kind: 'matrix',
    header: ['Brand', 'SKU', 'Model', 'Product Name', 'Color', 'Variant'],
    rows: [['BRUNO', 'ORD-2', 'ORD2', 'Order Test', 'Green', '']],
  });
  assert.equal(orderA.rows[0].status, 'error');
  assert.equal(orderB.rows[0].status, 'error');
  assert.ok(orderA.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
  assert.ok(orderB.rows[0].issues.some((i) => i.code === 'UNSUPPORTED_VARIANT'));
});

test('productNormalizer inspects every variant alias independently rather than short-circuiting on the first EXISTING header (root-cause proof)', async () => {
  const source = await readSource('src/imports/products/productNormalizer.ts');
  assert.match(source, /function collectExplicitVariantValues/);
  assert.doesNotMatch(source, /getField\(row\.fields, 'Variant', 'Variant Name', 'Color'\)/);
});

// --- Fix 2: authoritative filename sanitization -----------------------------

test('sanitizeImportFileName: an NFD basename is normalized to NFC — case 9', () => {
  const nfdName = 'Cafe\u0301.csv';
  const result = sanitizeImportFileName(nfdName);
  assert.equal(result, 'Caf\u00e9.csv');
  assert.equal(result, nfdName.normalize('NFC'));
});

test('sanitizeImportFileName: a genuinely mixed-separator path reduces to its basename — case 4', () => {
  assert.equal(sanitizeImportFileName('C:/staff\\mixed/separators\\products.csv'), 'products.csv');
});

test('parseProductImportRequest is now the AUTHORITATIVE filename sanitizer — a forged direct request carrying a path-bearing fileName can never be accepted with that path intact (case 12, critical)', () => {
  const forgedPaths = [
    'C:\\Users\\staff\\private\\products.csv',
    '/etc/passwd',
    'C:/mixed\\separators/products.csv',
    '../../secret/products.csv',
  ];
  for (const forged of forgedPaths) {
    // Simulates a request sent DIRECTLY to the Worker, bypassing the
    // browser's own sanitizeImportFileName call entirely.
    const request = {
      version: 1,
      fileName: forged,
      catalogFingerprint: '0'.repeat(64),
      rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
    };
    const result = parseProductImportRequest(request);
    assert.equal(result.ok, true, `a path-bearing fileName must not fail the whole request: "${forged}"`);
    assert.notEqual(result.value.fileName, forged, 'the raw forged path must never be accepted as-is');
    assert.ok(
      result.value.fileName === null || !/[/\\]/.test(result.value.fileName),
      `accepted fileName must never contain a path separator: got ${JSON.stringify(result.value.fileName)}`
    );
  }
});

test('parseProductImportRequest applies the exact same canonicalization as sanitizeImportFileName — one shared contract, not two independently-maintained rules', () => {
  const cases = [
    'products.csv',
    'C:\\Users\\staff\\Desktop\\products.csv',
    '/home/staff/products.csv',
    'Cafe\u0301.csv',
  ];
  for (const rawFileName of cases) {
    const expected = sanitizeImportFileName(rawFileName);
    const request = {
      version: 1,
      fileName: rawFileName,
      catalogFingerprint: '0'.repeat(64),
      rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
    };
    const result = parseProductImportRequest(request);
    assert.equal(result.ok, true);
    assert.equal(result.value.fileName, expected);
  }
});

test('parseProductImportRequest: control characters in fileName degrade the field to null (cosmetic-field policy), never fail the whole request — case 6', () => {
  const request = {
    version: 1,
    fileName: 'products\r\n.csv',
    catalogFingerprint: '0'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const result = parseProductImportRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.value.fileName, null);
});

test('parseProductImportRequest: formula-prefix and oversized fileName values degrade to null, never fail the whole request — cases 7-8', () => {
  const formulaRequest = {
    version: 1,
    fileName: '=cmd|calc.csv',
    catalogFingerprint: '0'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const oversizedRequest = {
    ...formulaRequest,
    fileName: `${'a'.repeat(300)}.csv`,
  };
  const formulaResult = parseProductImportRequest(formulaRequest);
  const oversizedResult = parseProductImportRequest(oversizedRequest);
  assert.equal(formulaResult.ok, true);
  assert.equal(formulaResult.value.fileName, null);
  assert.equal(oversizedResult.ok, true);
  assert.equal(oversizedResult.value.fileName, null);
});

test('parseProductImportRequest: a blank fileName is null — case 5', () => {
  const request = {
    version: 1,
    fileName: '   ',
    catalogFingerprint: '0'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const result = parseProductImportRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.value.fileName, null);
});

test('parseProductImportRequest: a non-string fileName is still a hard parse failure — a genuine type violation, not a cosmetic sanitization case', () => {
  const request = {
    version: 1,
    fileName: 12345,
    catalogFingerprint: '0'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const result = parseProductImportRequest(request);
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'invalid_field');
});

test('session persistence round-trips the canonical (already-sanitized) filename, never a raw/forged one — case 10', () => {
  const storage = createFakeStorage();
  const key = mintIdempotencyKey();
  const request = {
    version: 1,
    fileName: 'C:\\Users\\staff\\products.csv',
    catalogFingerprint: 'a'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  persistAttempt(key, request, storage);
  const recovered = readPersistedAttempt(storage);
  assert.notEqual(recovered, null);
  assert.equal(recovered.request.fileName, 'products.csv');
});

test('the canonical request string (what the idempotency fingerprint hashes) is built over the CANONICAL filename, not a raw/forged one — case 11', () => {
  const canonicalRequest = {
    version: 1,
    fileName: 'products.csv',
    catalogFingerprint: 'b'.repeat(64),
    rows: [{ rowNumber: 1, brand: 'B', sku: 'S', model: 'M', productName: 'P', category: null }],
  };
  const forgedPathRequest = { ...canonicalRequest, fileName: 'C:\\Users\\staff\\products.csv' };
  const parsedCanonical = parseProductImportRequest(canonicalRequest);
  const parsedForged = parseProductImportRequest(forgedPathRequest);
  assert.equal(parsedCanonical.ok, true);
  assert.equal(parsedForged.ok, true);
  // Both resolve to the SAME canonical filename, so their canonical request
  // strings are identical too — a forged path never produces a different
  // fingerprint than the legitimate basename it reduces to.
  assert.equal(
    buildCanonicalRequestString(parsedCanonical.value),
    buildCanonicalRequestString(parsedForged.value)
  );
});

test('useProductMaster sends the actual sanitized fileName, never a bare null', async () => {
  const source = await readSource('src/hooks/useProductMaster.ts');
  assert.doesNotMatch(source, /fileName: null,\s*\n\s*catalogFingerprint/);
  assert.match(source, /fileName: fileName \? sanitizeImportFileName\(fileName\) : null,/);
});

test('the wizard threads the identical fileName through every retry path — same key, same rows, same fileName, never re-derived', async () => {
  const source = await readSource(
    'src/features/master-data/products/components/import/ImportProductsWizard.tsx'
  );
  assert.match(source, /void runSubmit\(idempotencyKey, rows, fileName\);/);
  assert.match(source, /void runSubmit\(key, state\.preview\.rows, state\.file\.fileName\);/);
  assert.match(
    source,
    /void runSubmit\(pending\.idempotencyKey, state\.preview\.rows, state\.file\.fileName\);/
  );
});

// --- Fix 5: Modal Escape timing race ----------------------------------------

test('Modal syncs onCloseRef/preventCloseRef via useLayoutEffect, not useEffect — closes the Escape-vs-committed-render race', async () => {
  const source = await readSource('src/shared/components/Modal.tsx');
  assert.match(source, /import \{ useEffect, useId, useLayoutEffect, useRef \} from 'react';/);
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*\n\s*onCloseRef\.current = onClose;\s*\n\s*\}, \[onClose\]\);/
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*\n\s*preventCloseRef\.current = preventClose;\s*\n\s*\}, \[preventClose\]\);/
  );
  // X and backdrop read `preventClose` directly from the render closure —
  // never stale by construction, unaffected by this fix, re-confirmed here.
  assert.match(source, /const handleClose = \(\) => \{\s*\n\s*if \(!preventClose\) onClose\(\);\s*\n\s*\};/);
  // Escape is the only path that ever needed the ref (it's registered once
  // in a stable-callback `useEffect(..., [])` outside the render closure).
  assert.match(source, /if \(!preventCloseRef\.current\) onCloseRef\.current\(\);/);
});
