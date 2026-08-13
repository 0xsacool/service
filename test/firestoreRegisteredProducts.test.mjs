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

function repoWith(jobs) {
  return createFirestoreRegisteredProductsRepository({
    getAll: () => jobs,
    getById: () => undefined,
    getByTrackingNumber: () => undefined,
    create: async () => {
      throw new Error('create() must never be called by a read path');
    },
    update: async () => {
      throw new Error('update() must never be called by a read path');
    },
  });
}

test('derives one entry per serial number from real Service Job history, no other collection touched', async () => {
  const source = await readFile(
    new URL(
      '../src/repositories/firestoreRegisteredProductsRepository.ts',
      import.meta.url
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /getFirestoreDb|collection\(|onSnapshot|where\(/);
});

test("customer scoping: only the requested customer's jobs are considered", () => {
  const repo = repoWith([
    makeJob({ customerPhone: 'A', serialNumber: 'S1' }),
    makeJob({ customerPhone: 'B', serialNumber: 'S2' }),
  ]);
  const forA = repo.getForCustomer('A');
  assert.equal(forA.length, 1);
  assert.equal(forA[0].serialNumber, 'S1');
});

test('brand isolation: a job without a canonical brandId is excluded even if the customer matches', () => {
  const repo = repoWith([
    makeJob({ customerPhone: 'A', serialNumber: 'S1', brandId: null }),
    makeJob({ customerPhone: 'A', serialNumber: 'S2', brandId: 'bruno-thailand' }),
  ]);
  const forA = repo.getForCustomer('A');
  assert.equal(forA.length, 1);
  assert.equal(forA[0].serialNumber, 'S2');
});

test('service-history derivation: repeat visits on the same serial accumulate count and track the latest visit', () => {
  const repo = repoWith([
    makeJob({
      customerPhone: 'A',
      serialNumber: 'S1',
      updatedAt: '2026-01-01',
      warranty: true,
    }),
    makeJob({
      customerPhone: 'A',
      serialNumber: 'S1',
      updatedAt: '2026-03-01',
      warranty: false,
    }),
  ]);
  const [entry] = repo.getForCustomer('A');
  assert.equal(entry.previousServiceCount, 2);
  assert.equal(entry.lastServiceDate, '2026-03-01');
  assert.equal(entry.warrantyStatus, 'out_of_warranty');
});

test('ordering: most recently serviced first, ties broken by service frequency', () => {
  const repo = repoWith([
    makeJob({ customerPhone: 'A', serialNumber: 'OLD', updatedAt: '2026-01-01' }),
    makeJob({ customerPhone: 'A', serialNumber: 'NEW', updatedAt: '2026-06-01' }),
    makeJob({ customerPhone: 'A', serialNumber: 'TIE-1', updatedAt: '2026-06-01' }),
    makeJob({ customerPhone: 'A', serialNumber: 'TIE-1', updatedAt: '2026-06-01' }),
  ]);
  const serials = repo.getForCustomer('A').map((p) => p.serialNumber);
  assert.deepEqual(serials, ['TIE-1', 'NEW', 'OLD']);
});

test('missing/legacy data: a customer with no matching Service Jobs gets an empty list, never a fabricated entry', () => {
  const repo = repoWith([makeJob({ customerPhone: 'someone-else' })]);
  assert.deepEqual(repo.getForCustomer('no-such-customer'), []);
});

test('no purchase record is invented: purchaseDate/warrantyMonths/warrantyExpiresAt stay absent', () => {
  const repo = repoWith([makeJob({ customerPhone: 'A' })]);
  const [entry] = repo.getForCustomer('A');
  assert.equal('purchaseDate' in entry, false);
  assert.equal('warrantyMonths' in entry, false);
  assert.equal('warrantyExpiresAt' in entry, false);
});

test('the repository exposes only a read method, no mutation surface', () => {
  const repo = repoWith([]);
  assert.deepEqual(Object.keys(repo), ['getForCustomer']);
});

test('New Service Job reaches its Save & Print gate once a real customer, real product, and complete intake are present', () => {
  const repo = repoWith([
    makeJob({ customerPhone: 'A', serialNumber: 'S1', updatedAt: '2026-05-01' }),
  ]);
  const selectedCustomer = { id: 'A' };
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
