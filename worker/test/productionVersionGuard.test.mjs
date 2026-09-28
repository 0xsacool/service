import assert from 'node:assert/strict';
import {
  assertProductionBindings,
  main,
  productionPreviewBase,
  verifyProductionCandidate,
} from '../scripts/productionVersionGuard.mjs';

const VERSION_ID = 'b2534996-977d-45d3-96f7-641599d66f1c';
const OTHER_VERSION_ID = '11111111-2222-4333-8444-555555555555';

function baseBindings(publicTracking = { name: 'PUBLIC_TRACKING_ENABLED', type: 'plain_text', text: 'false' }) {
  return [
    { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: 'https://luxace-service.web.app' },
    { name: 'FIRESTORE_PROJECT_ID', type: 'plain_text', text: 'luxace-service' },
    ...(publicTracking ? [publicTracking] : []),
    { name: 'SERVICE_REPORT_V2_MODE', type: 'plain_text', text: 'compatibility' },
  ];
}

function version(bindings = baseBindings(), overrides = {}) {
  return {
    id: VERSION_ID,
    metadata: { has_preview: true },
    resources: { bindings },
    ...overrides,
  };
}

function routeKind(url) {
  const path = new URL(url).pathname;
  if (path === '/health') return 'health';
  if (path === '/service-reports/approval-queue') return 'd25';
  if (path === '/public/tracking') return 'public-code';
  if (path.startsWith('/public/tracking/')) return 'public-token';
  if (path.startsWith('/service-jobs/') && path.endsWith('/service-reports')) return 'd24';
  return 'unknown';
}

function successfulFetch(url) {
  const kind = routeKind(url);
  if (kind === 'health') return Promise.resolve(new Response('', { status: 200 }));
  if (kind === 'd24' || kind === 'd25') {
    return Promise.resolve(new Response('', { status: 401 }));
  }
  if (kind === 'public-token' || kind === 'public-code') {
    return Promise.resolve(new Response('', { status: 404 }));
  }
  return Promise.resolve(new Response('', { status: 500 }));
}

function fetchWithMismatch(kind, status) {
  return async (url) => {
    if (routeKind(url) === kind) return new Response('', { status });
    return successfulFetch(url);
  };
}

async function expectPromotionBlocked(
  label,
  {
    versionMetadata = version(),
    rawVersion,
    fetchImpl = successfulFetch,
    argv = [VERSION_ID, '--promote'],
  },
  pattern
) {
  const calls = [];
  const runWrangler = (args) => {
    calls.push(args);
    if (args[0] === 'versions' && args[1] === 'view') {
      return rawVersion ?? JSON.stringify(versionMetadata);
    }
    return '';
  };

  await assert.rejects(
    () => main(argv, { runWrangler, fetchImpl, log: () => {} }),
    pattern,
    label
  );
  assert.equal(
    calls.some((args) => args[0] === 'versions' && args[1] === 'deploy'),
    false,
    `${label}: deploy must not be dispatched`
  );
  console.log(`  PASS  ${label}`);
}

console.log('Running production Worker version guard regression test');

assert.equal(
  productionPreviewBase(VERSION_ID),
  'https://b2534996-service-tech-files-worker.sacool-spizy.workers.dev'
);
console.log('  PASS  production preview URL uses Wrangler short version prefix');

assert.doesNotThrow(() =>
  assertProductionBindings(version(baseBindings()), VERSION_ID)
);
console.log('  PASS  visible Public Tracking false binding is accepted');

assert.doesNotThrow(() =>
  assertProductionBindings(version(baseBindings(null)), VERSION_ID)
);
console.log('  PASS  absent Public Tracking binding is accepted');

await expectPromotionBlocked(
  'opaque Public Tracking secret is rejected and cannot promote',
  {
    versionMetadata: version(
      baseBindings({ name: 'PUBLIC_TRACKING_ENABLED', type: 'secret_text' })
    ),
  },
  /opaque secrets are unverifiable/
);

await expectPromotionBlocked(
  'explicit Public Tracking true is rejected and cannot promote',
  {
    versionMetadata: version(
      baseBindings({ name: 'PUBLIC_TRACKING_ENABLED', type: 'plain_text', text: 'true' })
    ),
  },
  /PUBLIC_TRACKING_ENABLED/
);

await expectPromotionBlocked(
  'missing SERVICE_REPORT_V2_MODE is rejected and cannot promote',
  {
    versionMetadata: version(
      baseBindings().filter((binding) => binding.name !== 'SERVICE_REPORT_V2_MODE')
    ),
  },
  /SERVICE_REPORT_V2_MODE/
);

await expectPromotionBlocked(
  'wrong SERVICE_REPORT_V2_MODE value is rejected and cannot promote',
  {
    versionMetadata: version(
      baseBindings().map((binding) =>
        binding.name === 'SERVICE_REPORT_V2_MODE'
          ? { ...binding, text: 'disabled' }
          : binding
      )
    ),
  },
  /SERVICE_REPORT_V2_MODE/
);

await expectPromotionBlocked(
  'non-plain SERVICE_REPORT_V2_MODE is rejected and cannot promote',
  {
    versionMetadata: version(
      baseBindings().map((binding) =>
        binding.name === 'SERVICE_REPORT_V2_MODE'
          ? { name: 'SERVICE_REPORT_V2_MODE', type: 'secret_text' }
          : binding
      )
    ),
  },
  /SERVICE_REPORT_V2_MODE/
);

await expectPromotionBlocked(
  'wrong candidate ID is rejected and cannot promote',
  { versionMetadata: version(baseBindings(), { id: OTHER_VERSION_ID }) },
  /different Worker version/
);

await expectPromotionBlocked(
  'missing candidate bindings metadata is rejected and cannot promote',
  {
    versionMetadata: {
      id: VERSION_ID,
      metadata: { has_preview: true },
      resources: {},
    },
  },
  /resources\.bindings/
);

await expectPromotionBlocked(
  'candidate without preview is rejected and cannot promote',
  {
    versionMetadata: version(baseBindings(), {
      metadata: { has_preview: false },
    }),
  },
  /no preview URL/
);

await expectPromotionBlocked(
  'malformed versions view JSON is rejected and cannot promote',
  { rawVersion: '{not-json' },
  /Unable to parse/
);

for (const [kind, status, pattern] of [
  ['health', 503, /health probe expected HTTP 200/],
  ['d24', 200, /unauthenticated D24 probe expected HTTP 401/],
  ['d25', 200, /unauthenticated D25 probe expected HTTP 401/],
  ['public-token', 200, /legacy Public Tracking probe expected HTTP 404/],
  ['public-code', 200, /manual-code Public Tracking probe expected HTTP 404/],
]) {
  await expectPromotionBlocked(
    `${kind} preview mismatch blocks promotion`,
    { fetchImpl: fetchWithMismatch(kind, status) },
    pattern
  );
}

await expectPromotionBlocked(
  'preview fetch failure blocks promotion',
  {
    fetchImpl: async () => {
      throw new Error('preview network unavailable');
    },
  },
  /preview network unavailable/
);

{
  const calls = [];
  const runWrangler = (args) => {
    calls.push(args);
    if (args[0] === 'versions' && args[1] === 'view') {
      return JSON.stringify(version());
    }
    return '';
  };

  await verifyProductionCandidate(VERSION_ID, {
    runWrangler,
    fetchImpl: successfulFetch,
  });
  assert.deepEqual(calls, [['versions', 'view', VERSION_ID, '--json']]);
  console.log('  PASS  preflight-only path inspects exact version and never deploys');
}

{
  const calls = [];
  const logs = [];
  const runWrangler = (args) => {
    calls.push(args);
    if (args[0] === 'versions' && args[1] === 'view') {
      return JSON.stringify(version());
    }
    return '';
  };

  await main([VERSION_ID, '--promote'], {
    runWrangler,
    fetchImpl: successfulFetch,
    log: (line) => logs.push(line),
  });

  assert.deepEqual(calls, [
    ['versions', 'view', VERSION_ID, '--json'],
    [
      'versions',
      'deploy',
      `${VERSION_ID}@100`,
      '--message',
      'Guarded production promotion',
      '--yes',
    ],
  ]);
  assert.match(logs.at(-1), /@100/);
  console.log('  PASS  --promote dispatches only after every guard check passes');
}

console.log('Production Worker version guard regression test passed');
