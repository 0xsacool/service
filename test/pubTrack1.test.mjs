import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { createPublicTrackingGateway, parsePublicTrackingDto } = await vite.ssrLoadModule(
  '/src/features/tracking/publicTracking.ts'
);
const { capturePublicTrackingCredential } = await vite.ssrLoadModule(
  '/src/features/tracking/publicTrackingFragment.ts'
);

const record = {
  trackingReference: 'BRN-2026-000123',
  status: 'In Repair',
  productName: 'Service Tech Vacuum',
  productModelOrSku: 'ST-100',
  maskedSerial: '••••1234',
  publicTimeline: [{ status: 'Received', occurredAt: '2026-08-01T09:00:00.000Z' }],
  lastUpdatedAt: '2026-08-09T10:00:00.000Z',
};
const code = 'SRV-2026-0810-K7M2QX';

test('manual code lookup posts only the normalized code to the narrow endpoint', async () => {
  const requests = [];
  const gateway = createPublicTrackingGateway({
    baseUrl: 'https://worker.example/',
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify(record), { status: 200 });
    },
  });
  const found = await gateway.lookupByCode(code.toLowerCase());
  assert.deepEqual(found, { kind: 'found', record });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://worker.example/public/tracking');
  assert.deepEqual(requests[0].init, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
});

test('manual code fragment is accepted and removed from browser history', () => {
  const calls = [];
  const credential = capturePublicTrackingCredential(
    { pathname: '/track', search: '?code=should-not-be-used', hash: `#${code}` },
    {
      state: { source: 'manual' },
      replaceState(state, unused, url) {
        calls.push({ state, unused, url });
      },
    }
  );
  assert.deepEqual(credential, { kind: 'manual-code', value: code });
  assert.deepEqual(calls, [{ state: { source: 'manual' }, unused: '', url: '/track' }]);
});

test('manual lookup failures and DTO parsing remain generic and minimal', async () => {
  const gateway = createPublicTrackingGateway({
    baseUrl: 'https://worker.example',
    fetch: async () =>
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
  });
  assert.deepEqual(await gateway.lookupByCode(code), { kind: 'unavailable' });
  assert.deepEqual(
    parsePublicTrackingDto({ ...record, publicTrackingCodeHash: 'must-not-be-retained' }),
    record
  );
});

test('landing UI exposes the four-language manual form and does not use ordinary query credentials', async () => {
  const [home, locale, result, routes] = await Promise.all(
    [
      'src/features/tracking/pages/TrackHome.tsx',
      'src/features/tracking/publicTrackingLocale.ts',
      'src/features/tracking/pages/TrackResult.tsx',
      'src/constants/routes.ts',
    ].map(async (path) => [
      path,
      await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
    ])
  ).then((items) => items.map(([, source]) => source));
  for (const label of [
    'กรอกรหัสติดตามงานบริการ',
    'ตรวจสอบสถานะ',
    'Enter your service tracking code',
    'Check status',
    'サービス追跡コードを入力',
    '状況を確認',
    '输入服务查询码',
    '查询状态',
  ]) {
    assert.match(locale, new RegExp(label));
  }
  assert.match(home, /normalizePublicTrackingCodeInput/);
  assert.match(home, /ROUTES\.trackLookup/);
  assert.match(home, /autoComplete="one-time-code"/);
  assert.match(result, /usePublicTracking/);
  assert.match(routes, /trackLookup: '\/track'/);
  assert.doesNotMatch(home, /\?code=/);
});

test('public DTO, Delivery Note, and Share message keep code/hash boundaries narrow', async () => {
  const [dto, delivery, share] = await Promise.all(
    [
      'src/features/tracking/publicTracking.ts',
      'src/features/service-jobs/components/DeliveryNotePrintPreview.tsx',
      'src/services/customerNotificationShare.ts',
    ].map(async (path) => await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  );
  assert.doesNotMatch(dto, /publicTrackingCodeHash/);
  assert.match(delivery, /publicTrackingCode\?/);
  assert.match(delivery, /รหัสติดตามงานบริการ/);
  assert.match(share, /publicTrackingCode\?/);
  assert.match(share, /รหัสติดตาม:/);
  assert.doesNotMatch(delivery, /publicTrackingCodeHash|https:\/\/|QRCode|R2/);
  assert.doesNotMatch(share, /publicTrackingCodeHash|publicTrackingTokenHash|https:\/\//);
});
