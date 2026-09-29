import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

const { searchActiveProductCatalog } = await vite.ssrLoadModule(
  '/src/services/productCatalogSearch.ts'
);
const { parseProductCatalogUpdateRequest } = await vite.ssrLoadModule(
  '/src/services/productCatalogManagement.ts'
);
const { canManageProductCatalogForBackend } = await vite.ssrLoadModule(
  '/src/services/productCatalogAccess.ts'
);

function product(id, overrides = {}) {
  return {
    id,
    brand: 'BRUNO',
    categoryId: 'kitchen',
    name: `Product ${id}`,
    model: `MODEL-${id}`,
    sku: `SKU-${id}`,
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [],
    commonProblemIds: [],
    ...overrides,
  };
}

test('catalog search offers only Active products and matches model/SKU/name/brand', () => {
  const products = [
    product('1', { model: 'BOE127', sku: 'RICE-IV', name: 'Mini Rice Cooker' }),
    product('2', { model: 'BOE123', sku: 'HOT-123', name: 'Digital Hot Plate' }),
    product('3', { model: 'OLD', sku: 'BOE127-OLD', status: 'Legacy' }),
    product('4', { brand: 'LUX ACE', model: 'BDE052', name: '10W Qi Charger' }),
  ];

  assert.deepEqual(
    searchActiveProductCatalog(products, 'boe12').map((entry) => entry.id),
    ['2', '1']
  );
  assert.deepEqual(
    searchActiveProductCatalog(products, 'rice').map((entry) => entry.id),
    ['1']
  );
  assert.deepEqual(
    searchActiveProductCatalog(products, 'lux ace').map((entry) => entry.id),
    ['4']
  );
  assert.equal(searchActiveProductCatalog(products, 'boe127-old').length, 0);
});

test('catalog search is bounded for large Product Master lists', () => {
  const products = Array.from({ length: 100 }, (_, index) => product(String(index)));
  assert.equal(searchActiveProductCatalog(products, '').length, 20);
});

test('product update contract is exact, normalized, and status-bounded', () => {
  const parsed = parseProductCatalogUpdateRequest({
    version: 1,
    brand: ' BRUNO ',
    categoryId: ' kitchen ',
    model: ' BOE127 ',
    sku: ' BOE127-IV ',
    productName: ' Mini Rice Cooker ',
    warrantyMonths: 12,
    status: 'Legacy',
  });
  assert.deepEqual(parsed, {
    version: 1,
    brand: 'BRUNO',
    categoryId: 'kitchen',
    model: 'BOE127',
    sku: 'BOE127-IV',
    productName: 'Mini Rice Cooker',
    warrantyMonths: 12,
    status: 'Legacy',
  });
  assert.equal(parseProductCatalogUpdateRequest({ ...parsed, unexpected: true }), null);
  assert.equal(parseProductCatalogUpdateRequest({ ...parsed, status: 'Deleted' }), null);
  assert.equal(
    parseProductCatalogUpdateRequest({ ...parsed, productName: '=HYPERLINK("x")' }),
    null
  );
  assert.equal(parseProductCatalogUpdateRequest({ ...parsed, sku: null })?.sku, null);
});

test('production Product edit capability is distinct from legacy direct mutation gate', () => {
  assert.equal(canManageProductCatalogForBackend('mock', false), true);
  assert.equal(canManageProductCatalogForBackend('firestore', false), false);
  assert.equal(canManageProductCatalogForBackend('firestore', true), true);
  assert.equal(canManageProductCatalogForBackend(null, true), false);
});

test('Product Master defaults to Active so retired Legacy rows do not clutter normal use', async () => {
  const source = await readFile(
    new URL(
      '../src/features/master-data/products/pages/ProductsPage.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /useState<StatusFilter>\('Active'\)/);
});

test('New Service Job uses searchable combobox instead of native catalog select', async () => {
  const source = await readFile(
    new URL('../src/shared/components/product/RegisterProductForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /ProductCatalogCombobox/);
  assert.doesNotMatch(source, /<select[\s>]/);
});
