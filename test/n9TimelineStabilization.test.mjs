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

const {
  appendServiceJobStatusTimelineEvent,
  authoritativeTimelineCurrentIndex,
  serviceJobProgressState,
} = await vite.ssrLoadModule('/src/services/serviceJobTimeline.ts');
const { buildServiceJobUpdate } = await vite.ssrLoadModule(
  '/src/services/serviceJobUpdate.ts'
);

function baseServiceJob(overrides = {}) {
  return {
    id: 'BRN-2026-000013',
    brandId: 'bruno-thailand',
    customerName: 'N9 Synthetic',
    customerPhone: '0000000000',
    customerEmail: '',
    product: 'Synthetic Device',
    productCategory: 'Test',
    serialNumber: 'N9-TEST',
    issue: 'N9 test',
    description: 'N9 test',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-09-28',
    updatedAt: '2026-09-28',
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: true,
    photos: [],
    timeline: [
      {
        status: 'Received',
        title: 'Claim received',
        description: 'received',
        date: '2026-09-28',
        time: '21:50',
        done: true,
        current: true,
      },
    ],
    notes: [],
    serviceRequestNumber: 'SR-2026-000012',
    returnFormNumber: null,
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: null,
    purchaseDate: null,
    orderDeliveredDate: null,
    externalEvidenceUrl: null,
    externalEvidenceNote: null,
    ...overrides,
  };
}

test('authoritative status ignores a stale persisted current flag', () => {
  const job = baseServiceJob({ status: 'Completed' });
  assert.equal(authoritativeTimelineCurrentIndex(job.timeline, job.status), -1);
  assert.equal(job.timeline[0].current, true);
});

test('status-based progress is independent from sparse historical timeline length', () => {
  assert.deepEqual(serviceJobProgressState('Received'), {
    completed: 1,
    total: 7,
    progress: 14,
    terminalException: false,
  });
  assert.deepEqual(serviceJobProgressState('Completed'), {
    completed: 7,
    total: 7,
    progress: 100,
    terminalException: false,
  });
  assert.deepEqual(serviceJobProgressState('Cancelled'), {
    completed: 7,
    total: 7,
    progress: 100,
    terminalException: true,
  });
});

test('timeline append preserves every historical event and adds one new immutable event', () => {
  const original = baseServiceJob().timeline;
  const before = structuredClone(original);
  const appended = appendServiceJobStatusTimelineEvent(
    original,
    'Diagnosing',
    new Date('2026-09-28T18:30:00.000Z')
  );

  assert.deepEqual(original, before);
  assert.equal(appended.length, original.length + 1);
  assert.deepEqual(appended.slice(0, -1), original);
  assert.deepEqual(
    {
      status: appended.at(-1).status,
      title: appended.at(-1).title,
      date: appended.at(-1).date,
      done: appended.at(-1).done,
      hasCurrent: Object.hasOwn(appended.at(-1), 'current'),
    },
    {
      status: 'Diagnosing',
      title: 'Diagnosis pending',
      date: '2026-09-29',
      done: true,
      hasCurrent: false,
    }
  );
});

test('ordinary status save appends exactly one event while same-status save does not rewrite timeline', () => {
  const current = baseServiceJob();
  const now = new Date('2026-09-28T18:30:00.000Z');
  const changed = buildServiceJobUpdate(
    { status: 'Diagnosing' },
    current,
    'firestore',
    now
  );
  assert.equal(changed.status, 'Diagnosing');
  assert.equal(changed.timeline.length, 2);
  assert.deepEqual(changed.timeline[0], current.timeline[0]);
  assert.equal(changed.timeline[1].status, 'Diagnosing');

  const unchanged = buildServiceJobUpdate(
    { status: 'Received' },
    current,
    'firestore',
    now
  );
  assert.equal('timeline' in unchanged, false);
});

test('Service Job details wires progress/current-step presentation to authoritative claim.status', async () => {
  const source = await readFile(
    new URL('../src/features/service-jobs/pages/ServiceJobDetails.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /<ProgressBar status=\{claim\.status\} \/>/);
  assert.match(
    source,
    /ขั้นตอนปัจจุบัน:[\s\S]*statusLabel\(claim\.status\)[\s\S]*<Timeline events=\{claim\.timeline\} currentStatus=\{claim\.status\} \/>/
  );
});
