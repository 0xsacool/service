import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const firebaseConfig = JSON.parse(
  await readFile(new URL('../firebase.json', import.meta.url), 'utf8')
);
const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());
const { ROUTES, ROUTE_PATTERNS } = await vite.ssrLoadModule('/src/constants/routes.ts');

test('Firebase Hosting publishes only dist with a catch-all SPA rewrite', () => {
  assert.equal(firebaseConfig.hosting.public, 'dist');
  assert.deepEqual(firebaseConfig.hosting.rewrites, [
    { source: '**', destination: '/index.html' },
  ]);
  assert.ok(firebaseConfig.hosting.ignore.includes('firebase.json'));
  assert.ok(firebaseConfig.hosting.ignore.includes('**/.*'));
  assert.ok(firebaseConfig.hosting.ignore.includes('**/node_modules/**'));
});

test('the approved rollout routes are represented by the BrowserRouter route table', () => {
  assert.equal(ROUTE_PATTERNS.home, '/');
  assert.equal(ROUTE_PATTERNS.login, '/login');
  assert.equal(ROUTE_PATTERNS.dashboard, '/dashboard');
  assert.equal(ROUTE_PATTERNS.serviceJobs, '/service-jobs');
  assert.equal(ROUTE_PATTERNS.newServiceJob, '/service-jobs/new');
  assert.equal(ROUTE_PATTERNS.track, '/track/:trackingNumber');
  assert.equal(ROUTES.track('example'), '/track/example');
});
