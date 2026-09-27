import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const WORKER_NAME = 'service-tech-files-worker';
const PREVIEW_DOMAIN = 'sacool-spizy.workers.dev';
const REQUIRED_MODE = 'compatibility';
const PROBE_JOB_ID = 'BRN-2026-000003';
const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultRunWrangler(args) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return execFileSync('wrangler', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function requireVersionId(versionId) {
  if (!VERSION_ID_PATTERN.test(versionId)) {
    throw new Error('Worker version ID must be a UUID');
  }
}

function bindingsOf(version) {
  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) {
    throw new Error('Worker version metadata is missing resources.bindings');
  }
  return bindings;
}

export function assertProductionBindings(version, expectedVersionId) {
  if (version?.id !== expectedVersionId) {
    throw new Error('Wrangler returned metadata for a different Worker version');
  }
  if (version?.metadata?.has_preview !== true) {
    throw new Error('Candidate has no preview URL; refusing production promotion');
  }

  const bindings = bindingsOf(version);
  const mode = bindings.find((binding) => binding?.name === 'SERVICE_REPORT_V2_MODE');
  if (mode?.type !== 'plain_text' || mode?.text !== REQUIRED_MODE) {
    throw new Error(
      'SERVICE_REPORT_V2_MODE must be the plain-text value "compatibility" on the exact candidate version'
    );
  }

  const publicTracking = bindings.find(
    (binding) => binding?.name === 'PUBLIC_TRACKING_ENABLED'
  );
  if (
    publicTracking &&
    !(publicTracking.type === 'plain_text' && publicTracking.text === 'false')
  ) {
    throw new Error(
      'PUBLIC_TRACKING_ENABLED must be absent or the visible plain-text value "false"; opaque secrets are unverifiable'
    );
  }
}

async function expectStatus(fetchImpl, label, url, expectedStatus, init) {
  const response = await fetchImpl(url, init);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} expected HTTP ${expectedStatus}, received ${response.status}`
    );
  }
}

export async function probeCandidate(versionId, fetchImpl = fetch) {
  const base = `https://${versionId}-${WORKER_NAME}.${PREVIEW_DOMAIN}`;

  await expectStatus(fetchImpl, 'health probe', `${base}/health`, 200);
  await expectStatus(
    fetchImpl,
    'unauthenticated D24 probe',
    `${base}/service-jobs/${PROBE_JOB_ID}/service-reports`,
    401
  );
  await expectStatus(
    fetchImpl,
    'unauthenticated D25 probe',
    `${base}/service-reports/approval-queue`,
    401
  );
  await expectStatus(
    fetchImpl,
    'legacy Public Tracking probe',
    `${base}/public/tracking/${PROBE_JOB_ID}`,
    404,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'x' }),
    }
  );
  await expectStatus(
    fetchImpl,
    'manual-code Public Tracking probe',
    `${base}/public/tracking`,
    404,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x' }),
    }
  );
}

export async function verifyProductionCandidate(
  versionId,
  { runWrangler = defaultRunWrangler, fetchImpl = fetch } = {}
) {
  requireVersionId(versionId);
  const raw = runWrangler(['versions', 'view', versionId, '--json']);
  let version;
  try {
    version = JSON.parse(raw);
  } catch {
    throw new Error('Unable to parse wrangler versions view JSON');
  }

  assertProductionBindings(version, versionId);
  await probeCandidate(versionId, fetchImpl);
  return version;
}

export async function main(
  argv = process.argv.slice(2),
  { runWrangler = defaultRunWrangler, fetchImpl = fetch, log = console.log } = {}
) {
  const [versionId, ...flags] = argv;
  const promote =
    flags.length === 1 && flags[0] === '--promote';
  if (
    !versionId ||
    (flags.length !== 0 && !promote)
  ) {
    throw new Error(
      'Usage: npm run guard:production-version -- <version-id> [--promote]'
    );
  }

  await verifyProductionCandidate(versionId, { runWrangler, fetchImpl });
  log(`Production candidate guard PASS: ${versionId}`);

  if (!promote) {
    log('No traffic changed. Re-run with --promote only after this preflight passes.');
    return;
  }

  runWrangler([
    'versions',
    'deploy',
    `${versionId}@100`,
    '--message',
    'Guarded production promotion',
    '--yes',
  ]);
  log(`Production promotion command completed for ${versionId}@100`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
