import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { buildServiceJobUpdate } = await vite.ssrLoadModule(
  '/src/services/serviceJobUpdate.ts'
);
const { needsTrustedClosedAt } = await vite.ssrLoadModule(
  '/src/services/serviceJobClosure.ts'
);
const { fromFirestoreData } = await vite.ssrLoadModule(
  '/src/repositories/firestore/serviceJobMapping.ts'
);
const { serviceJobsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceJobsRepository.ts'
);
const { commitServiceJobMutation } = await vite.ssrLoadModule(
  '/src/repositories/firestoreServiceJobRepository.ts'
);

const openJob = {
  id: 'BRN-2026-009999',
  brandId: 'bruno-thailand',
  customerName: 'QA Customer',
  customerPhone: '0000000000',
  customerEmail: '',
  product: 'QA Product',
  productCategory: 'QA',
  serialNumber: 'QA-1',
  issue: 'QA issue',
  description: 'QA description',
  status: 'Diagnosing',
  priority: 'Normal',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  publicTrackingTokenHash: null,
  technician: 'Unassigned',
  estimatedCompletion: '—',
  warranty: false,
  photos: [],
  timeline: [],
  notes: [],
};

test('non-terminal edits preserve a null closure anchor', () => {
  const patch = buildServiceJobUpdate(
    { status: 'In Repair', technician: 'Tech', notes: [] },
    openJob,
    'mock'
  );

  assert.equal(patch.closedAt, null);
  assert.equal(needsTrustedClosedAt(openJob.status, null, 'In Repair'), false);
});

test('an omitted technician edit cannot enter the persistence patch', () => {
  const patch = buildServiceJobUpdate(
    { status: 'In Repair', notes: [] },
    openJob,
    'firestore'
  );

  assert.equal(Object.hasOwn(patch, 'technician'), false);
  assert.equal(patch.status, 'In Repair');
  assert.deepEqual(patch.notes, []);
});

test('Firestore mode drops an explicitly supplied mock technician edit', () => {
  const patch = buildServiceJobUpdate(
    { status: 'In Repair', technician: 'Daniel Okafor', notes: [] },
    openJob,
    'firestore'
  );

  assert.equal(Object.hasOwn(patch, 'technician'), false);
});

test('only a first non-terminal-to-terminal transition requests trusted closure time', () => {
  assert.equal(needsTrustedClosedAt('Diagnosing', null, 'Completed'), true);
  assert.equal(needsTrustedClosedAt('Completed', null, 'Completed'), false);
  assert.equal(
    needsTrustedClosedAt('Diagnosing', '2026-08-09T00:00:00.000Z', 'Completed'),
    false
  );
  assert.equal(needsTrustedClosedAt('Completed', undefined, 'Completed'), false);
});

test('domain update never substitutes browser time for a trusted closure anchor', () => {
  const patch = buildServiceJobUpdate(
    { status: 'Completed', technician: 'Tech', notes: [] },
    openJob,
    'mock'
  );

  assert.equal(patch.closedAt, null);
});

test('existing closure anchors survive terminal and unrelated updates', () => {
  const closedJob = {
    ...openJob,
    status: 'Completed',
    closedAt: '2026-08-01T02:03:04.000Z',
  };
  const patch = buildServiceJobUpdate(
    { status: 'Completed', technician: 'Different Tech', notes: [] },
    closedJob,
    'mock'
  );

  assert.equal(patch.closedAt, closedJob.closedAt);
});

test('legacy string closure timestamps remain readable and malformed values fail closed', () => {
  const valid = fromFirestoreData('legacy-valid', {
    ...openJob,
    closedAt: '2026-08-01T02:03:04Z',
  });
  const malformed = fromFirestoreData('legacy-malformed', {
    ...openJob,
    status: 'Completed',
    closedAt: 'not-a-date',
  });

  assert.equal(valid.closedAt, '2026-08-01T02:03:04Z');
  assert.equal(malformed.closedAt, null);
  assert.equal(needsTrustedClosedAt(malformed.status, 'not-a-date', 'Completed'), false);
});

test('Firestore server timestamps remain readable through the domain mapping', () => {
  const mapped = fromFirestoreData('server-timestamp', {
    ...openJob,
    status: 'Completed',
    closedAt: Timestamp.fromDate(new Date('2026-08-01T02:03:04.000Z')),
  });

  assert.equal(mapped.closedAt, '2026-08-01T02:03:04.000Z');
});

test('the Mock repository satisfies the acknowledged mutation contract', async () => {
  const created = await serviceJobsRepository.create(openJob);
  const updated = await serviceJobsRepository.update(created.id, { technician: 'Tech' });

  assert.equal(updated.technician, 'Tech');
  assert.equal(serviceJobsRepository.getById(created.id)?.technician, 'Tech');
});

test('a failed Firestore mutation rejects without updating the local cache', async () => {
  let cacheUpdated = false;

  await assert.rejects(
    () =>
      commitServiceJobMutation(
        async () => {
          throw new Error('write failed');
        },
        () => {
          cacheUpdated = true;
        }
      ),
    /write failed/
  );

  assert.equal(cacheUpdated, false);
});
