import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  findAvailableServiceJobTrackingNumber,
  formatServiceRequestNumber,
  nextServiceJobSequence,
  serviceJobNumberingYear,
} = await vite.ssrLoadModule('/src/repositories/firestore/serviceJobAllocation.ts');
const { resolveBackendConfiguration } = await vite.ssrLoadModule(
  '/src/config/backend.ts'
);
const { BackendConfigurationGate } = await vite.ssrLoadModule(
  '/src/app/BackendConfigurationGate.tsx'
);
const { canMutateProductCatalogForBackend } = await vite.ssrLoadModule(
  '/src/services/productCatalogAccess.ts'
);
const { rejectClientProductMutation } = await vite.ssrLoadModule(
  '/src/repositories/firestoreProductMasterRepository.ts'
);

test('Service Job allocation skips an occupied legacy target without touching it', async () => {
  const occupied = new Set(['BRN-2026-000001']);
  const checked = [];
  const allocation = await findAvailableServiceJobTrackingNumber(
    'bruno-thailand',
    2026,
    1,
    async (id) => {
      checked.push(id);
      return occupied.has(id);
    }
  );

  assert.deepEqual(checked, ['BRN-2026-000001', 'BRN-2026-000002']);
  assert.equal(allocation.trackingNumber, 'BRN-2026-000002');
  assert.equal(allocation.sequence, 2);
  assert.equal(occupied.has('BRN-2026-000001'), true);
});

test('Service Job collision scanning is bounded and fails closed', async () => {
  await assert.rejects(
    () =>
      findAvailableServiceJobTrackingNumber('bruno-thailand', 2026, 1, async () => true),
    /occupied candidates/
  );
});

test('atomic allocation model gives concurrent callers distinct committed identifiers', async () => {
  const committed = new Set();
  let currentValue = 0;
  let lock = Promise.resolve();
  const create = async () => {
    const prior = lock;
    let release;
    lock = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const allocation = await findAvailableServiceJobTrackingNumber(
        'bruno-thailand',
        2026,
        nextServiceJobSequence(currentValue),
        async (id) => committed.has(id)
      );
      committed.add(allocation.trackingNumber);
      currentValue = allocation.sequence;
      return allocation.trackingNumber;
    } finally {
      release();
    }
  };

  const [first, second] = await Promise.all([create(), create()]);
  assert.notEqual(first, second);
  assert.deepEqual([...committed].sort(), ['BRN-2026-000001', 'BRN-2026-000002']);
  assert.equal(formatServiceRequestNumber(2026, 1), 'SR-2026-000001');
  assert.equal(serviceJobNumberingYear('2026-08-11'), 2026);
});

test('backend configuration accepts local Mock but production fails closed', () => {
  assert.deepEqual(resolveBackendConfiguration(undefined, false), {
    valid: true,
    kind: 'mock',
    error: null,
  });
  assert.deepEqual(resolveBackendConfiguration('firestore', true), {
    valid: true,
    kind: 'firestore',
    error: null,
  });
  for (const value of [undefined, 'mock', 'typo']) {
    assert.equal(resolveBackendConfiguration(value, true).valid, false);
  }
});

test('production misconfiguration does not mount its child Staff route tree', () => {
  const invalid = resolveBackendConfiguration(undefined, true);
  const markup = renderToStaticMarkup(
    createElement(
      BackendConfigurationGate,
      { configuration: invalid },
      createElement('section', { 'data-staff-route': 'mounted' }, 'Staff console')
    )
  );
  assert.match(markup, /Application configuration unavailable/);
  assert.doesNotMatch(markup, /data-staff-route/);
  assert.doesNotMatch(markup, /Staff console/);
});

test('Product Master is writable only in Mock and rejects Firestore client mutation', () => {
  assert.equal(canMutateProductCatalogForBackend('mock'), true);
  assert.equal(canMutateProductCatalogForBackend('firestore'), false);
  assert.equal(canMutateProductCatalogForBackend(null), false);
  assert.throws(() => rejectClientProductMutation(), /privileged catalog workflow/);
});
