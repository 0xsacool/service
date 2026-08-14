import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  createPublicTrackingGateway,
  getPublicTrackingGateway,
  parsePublicTrackingDto,
  resolvePublicTrackingWorkerUrl,
} = await vite.ssrLoadModule('/src/features/tracking/publicTracking.ts');
const { capturePublicTrackingToken } = await vite.ssrLoadModule(
  '/src/features/tracking/publicTrackingFragment.ts'
);

const token = 'A'.repeat(43);
const record = {
  trackingReference: 'BRN-2026-000123',
  status: 'In Repair',
  productName: 'Service Tech Vacuum',
  productModelOrSku: 'ST-100',
  maskedSerial: '••••1234',
  publicTimeline: [{ status: 'Received', occurredAt: '2026-08-01T09:00:00.000Z' }],
  lastUpdatedAt: '2026-08-09T10:00:00.000Z',
};

test('fragment capture returns a valid token, removes it from history, and ignores query tokens', () => {
  const calls = [];
  const captured = capturePublicTrackingToken(
    {
      pathname: '/track/BRN-2026-000123',
      search: '?token=query-token&view=compact',
      hash: `#${token}`,
    },
    {
      state: { source: 'test' },
      replaceState(state, unused, url) {
        calls.push({ state, unused, url });
      },
    }
  );

  assert.equal(captured, token);
  assert.deepEqual(calls, [
    {
      state: { source: 'test' },
      unused: '',
      url: '/track/BRN-2026-000123?view=compact',
    },
  ]);
  assert.equal(
    capturePublicTrackingToken(
      { pathname: '/track/BRN-2026-000123', search: '?token=query-token', hash: '' },
      { state: null, replaceState() {} }
    ),
    null
  );
});

test('public API client posts only the fragment token and parses the approved DTO', async () => {
  const requests = [];
  const gateway = createPublicTrackingGateway({
    baseUrl: 'https://worker.example/',
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(
        JSON.stringify({ ...record, customerName: 'must not be retained' }),
        {
          status: 200,
          headers: { 'Content-Length': '500' },
        }
      );
    },
  });

  const result = await gateway.lookup(record.trackingReference, token);
  assert.deepEqual(result, { kind: 'found', record });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    'https://worker.example/public/tracking/BRN-2026-000123'
  );
  assert.deepEqual(requests[0].init, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.doesNotMatch(JSON.stringify(result), /must not be retained/);
});

test('malformed DTOs and generic backend failures fail closed alike', async () => {
  const malformed = createPublicTrackingGateway({
    baseUrl: 'https://worker.example',
    fetch: async () =>
      new Response(JSON.stringify({ trackingReference: record.trackingReference }), {
        status: 200,
      }),
  });
  const denied = createPublicTrackingGateway({
    baseUrl: 'https://worker.example',
    fetch: async () =>
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
  });
  assert.deepEqual(await malformed.lookup(record.trackingReference, token), {
    kind: 'unavailable',
  });
  assert.deepEqual(await denied.lookup(record.trackingReference, token), {
    kind: 'unavailable',
  });
  assert.equal(
    parsePublicTrackingDto({ ...record, publicTimeline: [{ status: 'In Repair' }] }),
    null
  );
  assert.deepEqual(
    await getPublicTrackingGateway().lookup(record.trackingReference, token),
    {
      kind: 'unavailable',
    }
  );
});

test('staff-only production public tracking has no implicit local Worker fallback', () => {
  assert.equal(resolvePublicTrackingWorkerUrl(undefined, true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('', true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('http://127.0.0.1:8787', true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('https://localhost:8787', true), null);
});

test('public tracking accepts an explicit local URL only in development', () => {
  assert.equal(
    resolvePublicTrackingWorkerUrl('http://127.0.0.1:8787/', false),
    'http://127.0.0.1:8787'
  );
  assert.equal(resolvePublicTrackingWorkerUrl(undefined, false), null);
});

test('public tracking production configuration requires a valid non-local HTTPS origin', () => {
  assert.equal(resolvePublicTrackingWorkerUrl('not a url', true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('http://tracking.example.com', true), null);
  assert.equal(
    resolvePublicTrackingWorkerUrl('https://tracking.example.com/', true),
    'https://tracking.example.com'
  );
});

test('public browser source does not use Firestore, storage, or staff/file transport', async () => {
  const sources = await Promise.all(
    [
      'src/features/tracking/publicTracking.ts',
      'src/features/tracking/publicTrackingFragment.ts',
      'src/features/tracking/usePublicTracking.ts',
      'src/features/tracking/pages/TrackResult.tsx',
    ].map(async (path) => await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  );
  const source = sources.join('\n');
  assert.doesNotMatch(
    source,
    /firestore|localStorage|sessionStorage|fetchWithWorkerToken|attachments|customerPhone|customerEmail|customerName|brandId/
  );
  assert.match(source, /public\/tracking/);
  assert.doesNotMatch(source, /configured\s*\|\|\s*['"]http:\/\//);
});
