import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { fromFirestoreData, toFirestoreFields } = await vite.ssrLoadModule(
  '/src/repositories/firestore/customerMapping.ts'
);
const { buildNewDurableServiceJob } = await vite.ssrLoadModule(
  '/src/services/serviceJobCreation.ts'
);
const { toFirestoreFields: toServiceJobFirestoreFields, toFirestoreUpdateFields } =
  await vite.ssrLoadModule('/src/repositories/firestore/serviceJobMapping.ts');

test('customer mapping retains only explicit canonical brand memberships', () => {
  assert.deepEqual(
    fromFirestoreData('customer-opaque-id', {
      name: 'QA Customer',
      phone: '0000000000',
      email: 'qa@example.test',
      brandIds: ['bruno-thailand', 'join-lux-club'],
    }),
    {
      id: 'customer-opaque-id',
      name: 'QA Customer',
      phone: '0000000000',
      email: 'qa@example.test',
      brandIds: ['bruno-thailand', 'join-lux-club'],
    }
  );
  assert.equal(
    fromFirestoreData('legacy-customer', {
      name: 'Legacy Customer',
      phone: '0000000000',
      email: '',
    }),
    null
  );
  assert.equal(
    fromFirestoreData('malformed-customer', {
      name: 'Malformed Customer',
      phone: '0000000000',
      email: '',
      brandIds: ['BRN'],
    }),
    null
  );
  assert.deepEqual(
    toFirestoreFields({
      id: 'customer-opaque-id',
      name: 'QA Customer',
      phone: '0000000000',
      email: 'qa@example.test',
      brandIds: ['bruno-thailand'],
    }).brandIds,
    ['bruno-thailand']
  );
});

test('new Service Jobs persist a null public token hash and ordinary updates omit it', () => {
  const job = {
    ...buildNewDurableServiceJob({
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
        problemDescription: 'QA issue',
        problemChips: [],
        accessories: [],
        internalNotes: '',
        photos: [],
        // F5d-69 — matches createEmptyServiceIntake()'s own defaults.
        contactChannel: null,
        contactChannelIdentity: '',
        orderNumber: '',
        purchaseDate: '',
        orderDeliveredDate: '',
        externalEvidenceUrl: '',
        externalEvidenceNote: '',
      },
    }),
    id: 'BRN-2026-000001',
    serviceRequestNumber: 'SR-2026-000001',
  };
  assert.equal(job.publicTrackingTokenHash, null);
  assert.equal(toServiceJobFirestoreFields(job).publicTrackingTokenHash, null);
  assert.equal('publicTrackingTokenHash' in toFirestoreUpdateFields(job), false);
});

test('the staff customer listener is explicitly membership-scoped', () => {
  const source = readFileSync(
    new URL('../src/repositories/firestoreCustomersRepository.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /where\('brandIds', 'array-contains', staffBrandId\)/);
  assert.doesNotMatch(
    source,
    /onSnapshot\(\s*collection\(firestore, CUSTOMERS_COLLECTION\)/
  );
});

test('the legacy mock tracker cannot authorize lookup from a tracking reference alone', async () => {
  const { getPublicTrackingGateway } = await vite.ssrLoadModule(
    '/src/features/tracking/publicTracking.ts'
  );
  assert.deepEqual(await getPublicTrackingGateway().lookup('SRV-2026-0481'), {
    kind: 'unavailable',
  });
});
