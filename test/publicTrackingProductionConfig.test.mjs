import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-69G Phase 4B-FIX — the frontend Public Tracking gateway was silently
// disabled in production because VITE_PUBLIC_TRACKING_WORKER_URL was never
// supplied at build time (a config gap, not an application-logic defect —
// resolvePublicTrackingWorkerUrl()/getPublicTrackingGateway() already fail
// closed correctly on a missing value, and must keep doing so). This test
// proves the supplied configuration itself, not the already-correct runtime
// guard around it.

const repoRoot = new URL('..', import.meta.url);
const EXPECTED_PRODUCTION_WORKER_URL =
  'https://service-tech-files-worker.sacool-spizy.workers.dev';

function gitCheckIgnore(relativePath) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', relativePath], { cwd: repoRoot });
    return true; // exit 0: ignored
  } catch (error) {
    if (error.status === 1) return false; // exit 1: not ignored
    throw error; // exit 128 or other: a real error, not a yes/no answer
  }
}

const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
const envProduction = await readFile(new URL('../.env.production', import.meta.url), 'utf8');

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());
const { resolvePublicTrackingWorkerUrl } = await vite.ssrLoadModule(
  '/src/features/tracking/publicTracking.ts'
);

// --- A: .gitignore explicitly allows .env.production, nothing broader -----

test('.gitignore carries a narrow, explicit exception for .env.production only', () => {
  assert.match(gitignore, /^!\.env\.production$/m);
  // The blanket rules it sits next to must still be present and unweakened.
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
});

test('.env.production is genuinely trackable by Git; every other .env variant remains ignored', () => {
  assert.equal(gitCheckIgnore('.env.production'), false);
  assert.equal(gitCheckIgnore('.env'), true);
  assert.equal(gitCheckIgnore('.env.local'), true);
  // A synthetic name proves the exception is scoped to this one filename,
  // not a general loosening of the .env.* pattern.
  assert.equal(gitCheckIgnore('.env.secret'), true);
  assert.equal(gitCheckIgnore('.env.example'), false); // pre-existing, unaffected
});

// --- B/C: exact, minimal .env.production content ---------------------------

test('.env.production contains exactly one line: the production Public Tracking Worker URL', () => {
  const lines = envProduction.split('\n').filter((line) => line.length > 0);
  assert.deepEqual(lines, [
    `VITE_PUBLIC_TRACKING_WORKER_URL=${EXPECTED_PRODUCTION_WORKER_URL}`,
  ]);
});

test('.env.production contains no comments, no other key, and no secret-shaped value', () => {
  assert.doesNotMatch(envProduction, /^#/m);
  assert.doesNotMatch(envProduction, /VITE_FIREBASE_API_KEY/);
  assert.doesNotMatch(envProduction, /VITE_FILES_WORKER_URL/);
  assert.doesNotMatch(envProduction, /VITE_FIREBASE_PROJECT_ID/);
  assert.doesNotMatch(envProduction, /PUBLIC_TRACKING_ENABLED/);
  assert.doesNotMatch(envProduction, /SERVICE_ACCOUNT/);
});

// --- D/E/F: the existing runtime guard is unchanged and still fails closed -

test('resolvePublicTrackingWorkerUrl still returns null for a missing configuration value (unchanged behavior)', () => {
  assert.equal(resolvePublicTrackingWorkerUrl(undefined, true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('', true), null);
});

test('resolvePublicTrackingWorkerUrl still rejects a localhost/loopback value in production (unchanged behavior)', () => {
  assert.equal(resolvePublicTrackingWorkerUrl('http://127.0.0.1:8787', true), null);
  assert.equal(resolvePublicTrackingWorkerUrl('http://localhost:8787', true), null);
});

test('resolvePublicTrackingWorkerUrl accepts the exact value supplied by .env.production', () => {
  const lines = envProduction.split('\n').filter((line) => line.length > 0);
  const [, configuredValue] = lines[0].split('=');
  assert.equal(configuredValue, EXPECTED_PRODUCTION_WORKER_URL);
  assert.equal(
    resolvePublicTrackingWorkerUrl(configuredValue, true),
    EXPECTED_PRODUCTION_WORKER_URL
  );
  // HTTPS, not the rejected loopback/HTTP shape.
  assert.ok(configuredValue.startsWith('https://'));
});
