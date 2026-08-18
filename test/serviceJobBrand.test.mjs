import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { buildNewDurableServiceJob } = await vite.ssrLoadModule(
  '/src/services/serviceJobCreation.ts'
);
const { fromFirestoreData, toFirestoreFields } = await vite.ssrLoadModule(
  '/src/repositories/firestore/serviceJobMapping.ts'
);
const { isCanonicalBrandId } = await vite.ssrLoadModule('/src/types/brand.ts');
const { serviceJobsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceJobsRepository.ts'
);

const input = {
  brandId: 'bruno-thailand',
  customer: { id: 'customer-1', name: 'QA Customer', phone: '0000000000', email: '' },
  product: {
    id: 'product-1',
    customerId: 'customer-1',
    productName: 'QA Product',
    model: 'QA-1',
    category: 'QA',
    serialNumber: 'SERIAL-1',
    warrantyStatus: 'out_of_warranty',
  },
  intake: {
    problemChips: [],
    problemDescription: 'QA issue',
    accessories: [],
    photos: [],
    internalNotes: '',
    // F5d-69 — matches createEmptyServiceIntake()'s own defaults.
    contactChannel: null,
    contactChannelIdentity: '',
    orderNumber: '',
    purchaseDate: '',
    orderDeliveredDate: '',
    externalEvidenceUrl: '',
    externalEvidenceNote: '',
  },
};

test('canonical brand IDs validate and unrelated values do not', () => {
  assert.equal(isCanonicalBrandId('bruno-thailand'), true);
  assert.equal(isCanonicalBrandId('join-lux-club'), true);
  assert.equal(isCanonicalBrandId('BRN'), false);
});

test('new Service Jobs require an explicit canonical brandId', () => {
  const created = buildNewDurableServiceJob(input);
  assert.equal(created.brandId, 'bruno-thailand');
  assert.throws(
    () => buildNewDurableServiceJob({ ...input, brandId: undefined }),
    /canonical brandId/
  );
});

test('tracking prefixes do not become implicit authorization scope', () => {
  const created = buildNewDurableServiceJob(input);
  const legacy = fromFirestoreData('BRN-2026-000001', {
    ...created,
    id: 'BRN-2026-000001',
    serviceRequestNumber: 'SR-2026-000001',
  });
  delete legacy.brandId;
  const mappedLegacy = fromFirestoreData('BRN-2026-000001', legacy);
  assert.equal(mappedLegacy.brandId, null);
});

test('Firestore writes reject legacy or malformed brand scope', () => {
  const created = {
    ...buildNewDurableServiceJob(input),
    id: 'BRN-2026-000001',
    serviceRequestNumber: 'SR-2026-000001',
  };
  assert.equal(toFirestoreFields(created).brandId, 'bruno-thailand');
  assert.throws(
    () => toFirestoreFields({ ...created, brandId: null }),
    /canonical brandId/
  );
});

test('ordinary repository updates cannot change a Service Job brandId', async () => {
  const created = await serviceJobsRepository.create(buildNewDurableServiceJob(input));
  await assert.rejects(
    () => serviceJobsRepository.update(created.id, { brandId: 'join-lux-club' }),
    /Cannot change Service Job ownership or public tracking capability/
  );
});

test('new Service Jobs default to no public tracking capability', () => {
  assert.equal(buildNewDurableServiceJob(input).publicTrackingTokenHash, null);
});
