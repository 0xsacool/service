import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const loadDiagnostics = async () =>
  await vite.ssrLoadModule('/src/config/runtimeDiagnostics.ts');

// F5d-54. Root cause: Gate 7.1's manual rehearsal produced a real-looking
// BRN-2026-000001/SR-2026-000001 while actually running the Mock create
// path, because the operator had no way to see the active runtime backend.
// These tests prove the diagnostic module every UI indicator and the
// create-path assertion are built on, exercised directly (mirroring
// backend.ts's resolveBackendConfiguration(raw, isProduction) pure-function
// testing pattern) rather than depending on whatever is in the local .env
// at test time.

test('computeRuntimeDiagnostics reports Mock cleanly, with no Firestore project leaking through', async () => {
  const { computeRuntimeDiagnostics } = await loadDiagnostics();
  const diagnostics = computeRuntimeDiagnostics({
    backendValid: true,
    backendKind: 'mock',
    filesBackendValid: true,
    filesBackendKind: 'mock',
    workerUrl: undefined,
    firebaseProjectId: 'luxace-service',
  });
  assert.deepEqual(diagnostics, {
    backendKind: 'mock',
    filesBackend: 'mock',
    workerConfigured: false,
    firebaseProject: null,
  });
});

test('computeRuntimeDiagnostics reports a fully configured Firestore + Worker runtime', async () => {
  const { computeRuntimeDiagnostics } = await loadDiagnostics();
  const diagnostics = computeRuntimeDiagnostics({
    backendValid: true,
    backendKind: 'firestore',
    filesBackendValid: true,
    filesBackendKind: 'worker',
    workerUrl: 'https://files.example.workers.dev',
    firebaseProjectId: 'luxace-service',
  });
  assert.deepEqual(diagnostics, {
    backendKind: 'firestore',
    filesBackend: 'worker',
    workerConfigured: true,
    firebaseProject: 'luxace-service',
  });
});

test('computeRuntimeDiagnostics never reports a Firestore project ID while backendKind is not firestore', async () => {
  const { computeRuntimeDiagnostics } = await loadDiagnostics();
  const diagnostics = computeRuntimeDiagnostics({
    backendValid: true,
    backendKind: 'mock',
    filesBackendValid: true,
    filesBackendKind: 'worker',
    workerUrl: 'https://files.example.workers.dev',
    firebaseProjectId: 'luxace-service',
  });
  assert.equal(diagnostics.firebaseProject, null);
});

test('computeRuntimeDiagnostics reports null backendKind/filesBackend for an invalid configuration rather than guessing', async () => {
  const { computeRuntimeDiagnostics } = await loadDiagnostics();
  const diagnostics = computeRuntimeDiagnostics({
    backendValid: false,
    backendKind: null,
    filesBackendValid: false,
    filesBackendKind: null,
    workerUrl: undefined,
    firebaseProjectId: undefined,
  });
  assert.equal(diagnostics.backendKind, null);
  assert.equal(diagnostics.filesBackend, null);
});

test('the diagnostics object never carries a key beyond the four documented, non-sensitive fields', async () => {
  const { computeRuntimeDiagnostics } = await loadDiagnostics();
  const diagnostics = computeRuntimeDiagnostics({
    backendValid: true,
    backendKind: 'firestore',
    filesBackendValid: true,
    filesBackendKind: 'worker',
    workerUrl: 'https://files.example.workers.dev',
    firebaseProjectId: 'luxace-service',
  });
  assert.deepEqual(Object.keys(diagnostics).sort(), [
    'backendKind',
    'filesBackend',
    'firebaseProject',
    'workerConfigured',
  ]);
});

test('computeCreatePathAssertion: Mock is reported as "mock", not as a failed Firestore attempt', async () => {
  const { computeCreatePathAssertion } = await loadDiagnostics();
  const assertion = computeCreatePathAssertion({
    backendKind: 'mock',
    filesBackend: 'mock',
    workerConfigured: false,
    firebaseProject: null,
  });
  assert.deepEqual(assertion, {
    ok: false,
    path: 'mock',
    reasons: ['backendKind is "mock", not "firestore"'],
  });
});

test('computeCreatePathAssertion: a fully configured Firestore + Worker runtime is provably ok', async () => {
  const { computeCreatePathAssertion } = await loadDiagnostics();
  const assertion = computeCreatePathAssertion({
    backendKind: 'firestore',
    filesBackend: 'worker',
    workerConfigured: true,
    firebaseProject: 'luxace-service',
  });
  assert.deepEqual(assertion, { ok: true, path: 'firestore-worker', reasons: [] });
});

test('computeCreatePathAssertion fails closed when the Worker URL is missing even though backendKind is firestore', async () => {
  const { computeCreatePathAssertion } = await loadDiagnostics();
  const assertion = computeCreatePathAssertion({
    backendKind: 'firestore',
    filesBackend: 'worker',
    workerConfigured: false,
    firebaseProject: 'luxace-service',
  });
  assert.equal(assertion.ok, false);
  assert.equal(assertion.path, 'firestore-worker');
  assert.ok(assertion.reasons.some((reason) => reason.includes('VITE_FILES_WORKER_URL')));
});

test('computeCreatePathAssertion fails closed when filesBackend is not worker, independent of the Worker URL being set', async () => {
  const { computeCreatePathAssertion } = await loadDiagnostics();
  const assertion = computeCreatePathAssertion({
    backendKind: 'firestore',
    filesBackend: 'mock',
    workerConfigured: true,
    firebaseProject: 'luxace-service',
  });
  assert.equal(assertion.ok, false);
  assert.ok(assertion.reasons.some((reason) => reason.includes('filesBackend')));
});

test('a Mock create result can never be mistaken for a Worker allocator result: assertion.ok is false whenever assertion.path is "mock"', async () => {
  const { computeCreatePathAssertion } = await loadDiagnostics();
  const assertion = computeCreatePathAssertion({
    backendKind: 'mock',
    filesBackend: 'worker',
    workerConfigured: true,
    firebaseProject: null,
  });
  assert.equal(assertion.path, 'mock');
  assert.equal(assertion.ok, false);
});

test('runtimeDiagnostics.ts never reads the Firebase API key, auth domain, app ID, or messaging sender ID env vars', async () => {
  const source = await readSource('src/config/runtimeDiagnostics.ts');
  assert.doesNotMatch(source, /import\.meta\.env\.VITE_FIREBASE_API_KEY/);
  assert.doesNotMatch(source, /import\.meta\.env\.VITE_FIREBASE_AUTH_DOMAIN/);
  assert.doesNotMatch(source, /import\.meta\.env\.VITE_FIREBASE_APP_ID/);
  assert.doesNotMatch(source, /import\.meta\.env\.VITE_FIREBASE_MESSAGING_SENDER_ID/);
});

test('runtimeDiagnostics.ts reads the Worker URL only to compute a boolean, never assigning its raw value into the returned shape', async () => {
  const source = await readSource('src/config/runtimeDiagnostics.ts');
  assert.match(source, /import\.meta\.env\.VITE_FILES_WORKER_URL/);
  assert.doesNotMatch(source, /workerUrl:\s*inputs\.workerUrl,/);
  assert.doesNotMatch(source, /workerConfigured:\s*inputs\.workerUrl,/);
});

test('RuntimeModeIndicator renders an unmistakable Mock banner and never claims FIRESTORE + WORKER outside a fully-ok assertion', async () => {
  const source = await readSource('src/shared/components/RuntimeModeIndicator.tsx');
  assert.match(source, /โหมดทดสอบ.*Mock Data/);
  assert.match(source, /FIRESTORE \+ WORKER/);
  assert.match(source, /assertion\.ok/);
});

test('RuntimeModeIndicator is wired into StaffShell (every staff page, including New Service Job) and Login (before sign-in)', async () => {
  const staffShellSource = await readSource('src/shared/layouts/StaffShell.tsx');
  assert.match(staffShellSource, /<RuntimeModeIndicator \/>/);
  const loginSource = await readSource('src/features/auth/pages/Login.tsx');
  assert.match(loginSource, /<RuntimeModeIndicator \/>/);
});

test('useCreateServiceJob logs the create-path assertion in dev before every create call, gated on import.meta.env.DEV', async () => {
  const source = await readSource('src/hooks/useCreateServiceJob.ts');
  assert.match(source, /assertFirestoreWorkerCreatePath/);
  assert.match(source, /import\.meta\.env\.DEV/);
  assert.match(source, /\[Create Path\]/);
});

test('Mock Service Job IDs mirror the real BRN-YYYY-NNNNNN/SR-YYYY-NNNNNN shape (the exact ambiguity this task addresses)', async () => {
  const source = await readSource('src/repositories/serviceJobsRepository.ts');
  assert.match(source, /formatServiceJobTrackingNumber/);
  assert.match(source, /formatServiceRequestNumber/);
});

test('production build already fails closed on VITE_BACKEND_KIND=mock (F5d-33/34, reconfirmed here): App.tsx wires BackendConfigurationGate around the whole app', async () => {
  const { resolveBackendConfiguration } = await vite.ssrLoadModule(
    '/src/config/backend.ts'
  );
  const productionMock = resolveBackendConfiguration('mock', true);
  assert.equal(productionMock.valid, false);
  assert.match(productionMock.error, /VITE_BACKEND_KIND=firestore/);

  const appSource = await readSource('src/app/App.tsx');
  assert.match(appSource, /<BackendConfigurationGate configuration={appConfiguration}>/);
  assert.match(
    appSource,
    /combineBackendConfigurations\(\s*backendConfiguration,\s*filesBackendConfiguration\s*\)/
  );

  const gateSource = await readSource('src/app/BackendConfigurationGate.tsx');
  assert.match(gateSource, /if \(!configuration\.valid\)/);
});

test('Mock mode workflows are unaffected: repositoryProvider.ts still resolves a working Mock search under Mock configuration', async () => {
  const { repositories } = await vite.ssrLoadModule(
    '/src/repositories/repositoryProvider.ts'
  );
  const results = repositories.search.search('maggie.chen88');
  assert.ok(results.length >= 1);
});
