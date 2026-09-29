import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { searchActiveProductCatalog } from '../src/services/productCatalogSearch.ts';
import {
  parseProductCatalogCreateRequest,
  parseProductCatalogStatusRequest,
  parseProductCatalogUpdateRequest,
} from '../src/services/productCatalogManagement.ts';

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

test('direct-create contract requires a real SKU and keeps the exact bounded field set', () => {
  const parsed = parseProductCatalogCreateRequest({
    version: 1,
    brand: ' BRUNO ',
    categoryId: ' hot-plate ',
    model: ' BOE021 ',
    sku: ' BOE021-SHPK ',
    productName: ' Compact Hot Plate ',
    warrantyMonths: 12,
    status: 'Active',
  });
  assert.deepEqual(parsed, {
    version: 1,
    brand: 'BRUNO',
    categoryId: 'hot-plate',
    model: 'BOE021',
    sku: 'BOE021-SHPK',
    productName: 'Compact Hot Plate',
    warrantyMonths: 12,
    status: 'Active',
  });
  assert.equal(parseProductCatalogCreateRequest({ ...parsed, sku: '' }), null);
  assert.equal(parseProductCatalogCreateRequest({ ...parsed, sku: null }), null);
  assert.equal(parseProductCatalogCreateRequest({ ...parsed, extra: true }), null);
});

test('quick status contract accepts only exact Active/Legacy requests', () => {
  assert.deepEqual(parseProductCatalogStatusRequest({ version: 1, status: 'Legacy' }), {
    version: 1,
    status: 'Legacy',
  });
  assert.equal(parseProductCatalogStatusRequest({ version: 1, status: 'Deleted' }), null);
  assert.equal(
    parseProductCatalogStatusRequest({ version: 1, status: 'Active', extra: true }),
    null
  );
});

test('production Product management remains capability-gated instead of opening direct client mutation', async () => {
  const source = await readFile(
    new URL('../src/services/productCatalogAccess.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /kind === 'firestore' && canManageProducts/);
  assert.match(source, /canMutateProductCatalogForBackend/);
  assert.match(source, /return kind === 'mock'/);
});

test('Product Master direct add uses privileged management capability and Worker repository seam', async () => {
  const hookSource = await readFile(
    new URL('../src/hooks/useProductMaster.ts', import.meta.url),
    'utf8'
  );
  const pageSource = await readFile(
    new URL(
      '../src/features/master-data/products/pages/ProductsPage.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(hookSource, /const canEdit = canManageProducts/);
  assert.match(hookSource, /productCatalogManagement\.createProduct/);
  assert.match(hookSource, /refreshFromServer\(\[productId\]\)/);
  assert.match(pageSource, /await addProduct\(input\)/);
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

test('Product pages expose quick status confirmation and gate hard delete to reference-tracked Legacy rows', async () => {
  const listSource = await readFile(
    new URL(
      '../src/features/master-data/products/pages/ProductsPage.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const detailSource = await readFile(
    new URL(
      '../src/features/master-data/products/pages/ProductDetail.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(listSource, /requestStatusChange\(p\)/);
  assert.match(listSource, /ProductActionConfirmModal/);
  assert.match(detailSource, /referenceTrackingVersion === 1/);
  assert.match(detailSource, /ลบสินค้าถาวร/);
  assert.match(detailSource, /ProductActionConfirmModal/);
});

test('New Service Job uses searchable combobox instead of native catalog select', async () => {
  const source = await readFile(
    new URL('../src/shared/components/product/RegisterProductForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /ProductCatalogCombobox/);
  assert.doesNotMatch(source, /<select[\s>]/);
});
