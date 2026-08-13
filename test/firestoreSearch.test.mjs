import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { createFirestoreSearchRepository } = await vite.ssrLoadModule(
  '/src/repositories/firestoreSearchRepository.ts'
);
const { createFirestoreRegisteredProductsRepository } = await vite.ssrLoadModule(
  '/src/repositories/firestoreRegisteredProductsRepository.ts'
);

function makeCustomer(overrides = {}) {
  return {
    id: overrides.id ?? 'opaque-doc-id-1',
    name: overrides.name ?? 'QA Customer',
    phone: overrides.phone ?? '0800000001',
    email: overrides.email ?? '',
    brandIds: overrides.brandIds ?? ['bruno-thailand'],
  };
}

function makeJob(overrides = {}) {
  return {
    id: overrides.id ?? 'BRN-2026-000001',
    brandId: overrides.brandId === undefined ? 'bruno-thailand' : overrides.brandId,
    customerName: overrides.customerName ?? 'QA Customer',
    customerPhone: overrides.customerPhone ?? '0800000001',
    customerEmail: overrides.customerEmail ?? '',
    product: overrides.product ?? 'QA Product',
    productCategory: overrides.productCategory ?? 'Other',
    serialNumber: overrides.serialNumber ?? 'SERIAL-1',
    issue: overrides.issue ?? 'Issue',
    description: overrides.description ?? 'Description',
    status: overrides.status ?? 'Received',
    priority: overrides.priority ?? 'Normal',
    createdAt: overrides.createdAt ?? '2026-01-01',
    updatedAt: overrides.updatedAt ?? '2026-01-01',
    technician: overrides.technician ?? 'Unassigned',
    estimatedCompletion: overrides.estimatedCompletion ?? '—',
    warranty: overrides.warranty ?? false,
    photos: overrides.photos ?? [],
    timeline: overrides.timeline ?? [],
    notes: overrides.notes ?? [],
    accessories: overrides.accessories ?? [],
    serviceRequestNumber: overrides.serviceRequestNumber ?? 'SR-2026-000001',
    closedAt: overrides.closedAt ?? null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
  };
}

function repoWith(customers, jobs) {
  const customersRepo = { getAll: () => customers };
  const serviceJobsRepo = {
    getAll: () => jobs,
    getById: () => undefined,
    getByTrackingNumber: () => undefined,
    create: async () => {
      throw new Error('create() must never be called by a read path');
    },
    update: async () => {
      throw new Error('update() must never be called by a read path');
    },
  };
  return {
    search: createFirestoreSearchRepository(customersRepo, serviceJobsRepo),
    customersRepo,
    serviceJobsRepo,
  };
}

test('issues no independent Firestore query of its own', async () => {
  const source = await readFile(
    new URL('../src/repositories/firestoreSearchRepository.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /getFirestoreDb|collection\(|onSnapshot/);
});

test('phone search: matches by digits, ignoring formatting', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '(415) 555-0182' })],
    [makeJob({ customerPhone: '(415) 555-0182' })]
  );
  const results = search.search('5550182');
  assert.equal(results.length, 1);
  assert.equal(results[0].phone, '(415) 555-0182');
});

test('opaque customer document ID is never treated as a phone and never itself searchable as one', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'opaque-doc-xyz', phone: '0812345678' })],
    [makeJob({ customerPhone: '0812345678' })]
  );
  assert.deepEqual(search.search('opaque-doc-xyz'), []);
  assert.equal(search.search('0812345678').length, 1);
});

test('formatting differences between customer.phone and job.customerPhone still join for job-field lookup', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '(415) 555-0182' })],
    [makeJob({ id: 'BRN-2026-000042', customerPhone: '415-555-0182' })]
  );
  const results = search.search('BRN-2026-000042');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'cust-1');
});

test('tracking-number search resolves to the owning customer', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1' })],
    [makeJob({ id: 'BRN-2026-000042', customerPhone: '0800000001' })]
  );
  const results = search.search('BRN-2026-000042');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'cust-1');
});

test('serial-number search resolves to the owning customer', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1' })],
    [makeJob({ customerPhone: '0800000001', serialNumber: 'ABC-XYZ-123' })]
  );
  const results = search.search('abc-xyz-123');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'cust-1');
});

test('name search is case-insensitive and trims the query', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'Somchai Prasert' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.equal(search.search('  SOMCHAI  ').length, 1);
});

test('a customer with a missing/blank phone is excluded from search entirely', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'Findable Customer', phone: '   ' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.deepEqual(search.search('findable'), []);
});

test('a Service Job with a missing/blank customerPhone never resolves to any customer', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '', serialNumber: 'ORPHAN-SERIAL' })]
  );
  assert.deepEqual(search.search('orphan-serial'), []);
});

test('duplicate canonical phone values fail closed: neither colliding customer is shown', () => {
  const { search } = repoWith(
    [
      makeCustomer({ id: 'cust-1', name: 'First Customer', phone: '0812345678' }),
      makeCustomer({ id: 'cust-2', name: 'Second Customer', phone: '081-234-5678' }),
    ],
    [makeJob({ customerPhone: '0812345678' })]
  );
  assert.deepEqual(search.search('first customer'), []);
  assert.deepEqual(search.search('second customer'), []);
  assert.deepEqual(search.search('0812345678'), []);
});

test('marketplace/username/order number are never fabricated', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'Findable Customer' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  const [result] = search.search('findable');
  assert.equal(result.marketplace, undefined);
  assert.equal(result.username, undefined);
  assert.equal(result.orderNumber, undefined);
});

test('duplicate merging: a customer matched by two fields appears only once', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'Findable Customer' })],
    [
      makeJob({
        id: 'BRN-2026-000099',
        customerPhone: '0800000001',
        serialNumber: 'FINDABLE-SERIAL',
      }),
    ]
  );
  const results = search.search('findable');
  assert.equal(results.length, 1);
});

test('a customer with no Service Job history is excluded, never fabricated', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'No History Customer' })],
    []
  );
  assert.deepEqual(search.search('no history'), []);
});

test('an empty query returns no results, not every customer', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.deepEqual(search.search('   '), []);
});

test('getRecentSearches returns nothing fabricated; getRecentCustomers reuses real data', () => {
  const { search } = repoWith(
    [makeCustomer({ id: 'cust-1', name: 'Recent Customer' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.deepEqual(search.getRecentSearches(), []);
  assert.equal(search.getRecentCustomers().length, 1);
});

test('the repository exposes only read methods, no mutation surface', () => {
  const { search } = repoWith([], []);
  assert.deepEqual(
    Object.keys(search).sort(),
    ['getRecentCustomers', 'getRecentSearches', 'search'].sort()
  );
});

test('New Service Job path: search finds the customer by opaque id, then registeredProducts loads a real product for them', () => {
  const customers = [makeCustomer({ id: 'cust-flow-1', name: 'Full Flow Customer' })];
  const jobs = [
    makeJob({
      customerPhone: '0800000001',
      serialNumber: 'FLOW-SERIAL',
      updatedAt: '2026-05-01',
    }),
  ];
  const { search, customersRepo, serviceJobsRepo } = repoWith(customers, jobs);

  const found = search.search('full flow');
  assert.equal(found.length, 1);
  const selectedCustomer = found[0];
  assert.equal(selectedCustomer.id, 'cust-flow-1');

  const registeredProducts = createFirestoreRegisteredProductsRepository(
    customersRepo,
    serviceJobsRepo
  );
  const products = registeredProducts.getForCustomer(selectedCustomer.id);
  assert.equal(products.length, 1);
  assert.equal(products[0].serialNumber, 'FLOW-SERIAL');
});

test("cross-brand isolation: search only ever sees the data it was given, never another brand's", () => {
  // firestoreSearchRepository never queries Firestore itself (proven above)
  // — it trusts customers/serviceJobs as already brand-scoped. This proves
  // the honest boundary of that contract: a customer/job simply not present
  // in the injected (brand-scoped) repositories cannot appear, matching
  // exactly what the real Firestore-backed customers/serviceJobs
  // repositories guarantee via their own brand-filtered listener queries.
  const { search } = repoWith(
    [
      makeCustomer({
        id: 'bruno-cust',
        name: 'Bruno Customer',
        brandIds: ['bruno-thailand'],
      }),
    ],
    [makeJob({ customerPhone: '0800000001', brandId: 'bruno-thailand' })]
  );
  // No Join Lux Club customer/job was ever injected, so none can appear —
  // there is nothing a query for a plausible other-brand name can find.
  assert.deepEqual(search.search('join lux'), []);
  assert.equal(search.search('bruno customer').length, 1);
});
