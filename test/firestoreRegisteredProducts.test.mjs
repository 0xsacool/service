import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { createFirestoreRegisteredProductsRepository } = await vite.ssrLoadModule(
  '/src/repositories/firestoreRegisteredProductsRepository.ts'
);
const { isServiceIntakeComplete } = await vite.ssrLoadModule(
  '/src/validation/serviceIntakeValidation.ts'
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
    serialNumber:
      overrides.serialNumber === undefined ? 'SERIAL-1' : overrides.serialNumber,
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
  return createFirestoreRegisteredProductsRepository(customersRepo, serviceJobsRepo);
}

test('derives entries from real Service Job history only, no other collection touched', async () => {
  const source = await readFile(
    new URL(
      '../src/repositories/firestoreRegisteredProductsRepository.ts',
      import.meta.url
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /getFirestoreDb|onSnapshot/);
});

test('opaque customer document ID is never treated as a phone number', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'opaque-doc-xyz', phone: '0812345678' })],
    [makeJob({ customerPhone: '0812345678', serialNumber: 'S1' })]
  );
  // Looking up by the raw phone string (as if it were a doc ID) must not
  // accidentally work — only the real customer.id resolves anything.
  assert.deepEqual(repo.getForCustomer('0812345678'), []);
  const products = repo.getForCustomer('opaque-doc-xyz');
  assert.equal(products.length, 1);
  assert.equal(products[0].serialNumber, 'S1');
});

test('formatting differences between customer.phone and job.customerPhone still join', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '(415) 555-0182' })],
    [makeJob({ customerPhone: '415-555-0182', serialNumber: 'S1' })]
  );
  const products = repo.getForCustomer('cust-1');
  assert.equal(products.length, 1);
  assert.equal(products[0].serialNumber, 'S1');
});

test('a customer with a missing/blank phone yields no products, never a crash', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '   ' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.deepEqual(repo.getForCustomer('cust-1'), []);
});

test('a Service Job with a missing/blank customerPhone never joins to anyone', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '', serialNumber: 'S1' })]
  );
  assert.deepEqual(repo.getForCustomer('cust-1'), []);
});

test('duplicate canonical phone values fail closed for every colliding customer', () => {
  const repo = repoWith(
    [
      makeCustomer({ id: 'cust-1', phone: '0812345678' }),
      makeCustomer({ id: 'cust-2', phone: '081-234-5678' }),
    ],
    [makeJob({ customerPhone: '0812345678', serialNumber: 'S1' })]
  );
  assert.deepEqual(repo.getForCustomer('cust-1'), []);
  assert.deepEqual(repo.getForCustomer('cust-2'), []);
});

test("cross-customer isolation: another customer's phone never leaks history", () => {
  const repo = repoWith(
    [
      makeCustomer({ id: 'cust-1', phone: '0800000001' }),
      makeCustomer({ id: 'cust-2', phone: '0800000002' }),
    ],
    [
      makeJob({ customerPhone: '0800000001', serialNumber: 'S1' }),
      makeJob({ customerPhone: '0800000002', serialNumber: 'S2' }),
    ]
  );
  const forCust1 = repo.getForCustomer('cust-1');
  assert.equal(forCust1.length, 1);
  assert.equal(forCust1[0].serialNumber, 'S1');
});

test('brand isolation: a job without a canonical brandId is excluded even if the phone matches', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [
      makeJob({ customerPhone: '0800000001', serialNumber: 'S1', brandId: null }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'S2',
        brandId: 'bruno-thailand',
      }),
    ]
  );
  const products = repo.getForCustomer('cust-1');
  assert.equal(products.length, 1);
  assert.equal(products[0].serialNumber, 'S2');
});

test('a blank serial number never becomes a selectable product', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '0800000001', serialNumber: '' })]
  );
  assert.deepEqual(repo.getForCustomer('cust-1'), []);
});

test('a whitespace-only serial number never becomes a selectable product', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '0800000001', serialNumber: '   ' })]
  );
  assert.deepEqual(repo.getForCustomer('cust-1'), []);
});

test('a blank-serial job is ignored while a valid-serial job for the same customer still appears', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [
      makeJob({ customerPhone: '0800000001', serialNumber: '  ', id: 'BRN-2026-000001' }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'REAL-1',
        id: 'BRN-2026-000002',
      }),
    ]
  );
  const products = repo.getForCustomer('cust-1');
  assert.equal(products.length, 1);
  assert.equal(products[0].serialNumber, 'REAL-1');
});

test('service-history derivation: repeat visits on the same serial accumulate count and track the latest visit', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'S1',
        updatedAt: '2026-01-01',
        warranty: true,
      }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'S1',
        updatedAt: '2026-03-01',
        warranty: false,
      }),
    ]
  );
  const [entry] = repo.getForCustomer('cust-1');
  assert.equal(entry.previousServiceCount, 2);
  assert.equal(entry.lastServiceDate, '2026-03-01');
  assert.equal(entry.warrantyStatus, 'out_of_warranty');
});

test('ordering: most recently serviced first, ties broken by service frequency', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'OLD',
        updatedAt: '2026-01-01',
      }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'NEW',
        updatedAt: '2026-06-01',
      }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'TIE-1',
        updatedAt: '2026-06-01',
      }),
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'TIE-1',
        updatedAt: '2026-06-01',
      }),
    ]
  );
  const serials = repo.getForCustomer('cust-1').map((p) => p.serialNumber);
  assert.deepEqual(serials, ['TIE-1', 'NEW', 'OLD']);
});

test('missing customer: an unknown customer id yields an empty list, never a fabricated entry', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  assert.deepEqual(repo.getForCustomer('no-such-customer'), []);
});

test('no purchase record is invented: purchaseDate/warrantyMonths/warrantyExpiresAt stay absent', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [makeJob({ customerPhone: '0800000001' })]
  );
  const [entry] = repo.getForCustomer('cust-1');
  assert.equal('purchaseDate' in entry, false);
  assert.equal('warrantyMonths' in entry, false);
  assert.equal('warrantyExpiresAt' in entry, false);
});

test('the repository exposes only a read method, no mutation surface', () => {
  const repo = repoWith([], []);
  assert.deepEqual(Object.keys(repo), ['getForCustomer']);
});

test('New Service Job reaches its Save & Print gate once a real customer, real product, and complete intake are present', () => {
  const repo = repoWith(
    [makeCustomer({ id: 'cust-1', phone: '0800000001' })],
    [
      makeJob({
        customerPhone: '0800000001',
        serialNumber: 'S1',
        updatedAt: '2026-05-01',
      }),
    ]
  );
  const selectedCustomer = { id: 'cust-1' };
  const products = repo.getForCustomer(selectedCustomer.id);
  assert.equal(products.length, 1);
  const selectedProduct = products[0];

  const intake = {
    problemDescription: 'Screen does not turn on',
    problemChips: [],
    accessories: [],
    internalNotes: '',
    photos: [],
  };
  const intakeComplete = isServiceIntakeComplete(intake);

  // Mirrors NewServiceJob.tsx's exact gate:
  // `selectedCustomer && selectedProduct && intakeComplete`.
  assert.ok(Boolean(selectedCustomer) && Boolean(selectedProduct) && intakeComplete);
});
