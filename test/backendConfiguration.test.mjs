import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { resolveBackendConfiguration, combineBackendConfigurations } =
  await vite.ssrLoadModule('/src/config/backend.ts');
const { resolveFilesBackendConfiguration } = await vite.ssrLoadModule(
  '/src/config/filesBackend.ts'
);

// F5d-33/F5d-34 — a missing/unset VITE_FILES_BACKEND previously always
// defaulted to 'mock', including in a production build with a durable
// (Firestore) business backend: Service Jobs would be durable and shared
// while attachments silently stayed in-memory and per-session, with no
// error anywhere. These tests prove the files-backend axis now fails
// closed under the one combination where that silent downgrade is actually
// a misconfiguration, while every development/test default is unchanged.

test('development defaults remain the safe Mock attachments backend', () => {
  assert.deepEqual(resolveFilesBackendConfiguration(undefined, false, 'mock'), {
    valid: true,
    kind: 'mock',
    error: null,
  });
  assert.deepEqual(resolveFilesBackendConfiguration('mock', false, 'firestore'), {
    valid: true,
    kind: 'mock',
    error: null,
  });
});

test('worker is accepted in any environment', () => {
  assert.deepEqual(resolveFilesBackendConfiguration('worker', false, 'mock'), {
    valid: true,
    kind: 'worker',
    error: null,
  });
  assert.deepEqual(resolveFilesBackendConfiguration('worker', true, 'firestore'), {
    valid: true,
    kind: 'worker',
    error: null,
  });
});

test('production with a durable Service Job backend fails closed without a worker files backend', () => {
  const unset = resolveFilesBackendConfiguration(undefined, true, 'firestore');
  const explicitMock = resolveFilesBackendConfiguration('mock', true, 'firestore');
  assert.equal(unset.valid, false);
  assert.equal(unset.kind, null);
  assert.match(unset.error, /VITE_FILES_BACKEND=worker/);
  assert.equal(explicitMock.valid, false);
  assert.match(explicitMock.error, /VITE_FILES_BACKEND=worker/);
});

test('production Mock business backend does not force a worker files backend on its own', () => {
  // Unreachable in the real app (backend.ts already rejects production +
  // Mock business data before this ever runs), but the pure function must
  // not over-apply the fail-closed rule beyond the one combination it's
  // actually guarding: a durable business backend with non-durable files.
  assert.deepEqual(resolveFilesBackendConfiguration(undefined, true, 'mock'), {
    valid: true,
    kind: 'mock',
    error: null,
  });
});

test('combineBackendConfigurations surfaces the primary error first', () => {
  const invalidPrimary = resolveBackendConfiguration('mock', true);
  const validSecondary = { valid: true, kind: 'worker', error: null };
  const combined = combineBackendConfigurations(invalidPrimary, validSecondary);
  assert.equal(combined, invalidPrimary);
});

test('combineBackendConfigurations fails closed on a valid primary with an invalid secondary', () => {
  const validPrimary = resolveBackendConfiguration('firestore', true);
  const invalidSecondary = resolveFilesBackendConfiguration(undefined, true, 'firestore');
  const combined = combineBackendConfigurations(validPrimary, invalidSecondary);
  assert.equal(combined.valid, false);
  assert.equal(combined.kind, null);
  assert.equal(combined.error, invalidSecondary.error);
});

test('combineBackendConfigurations returns the primary when both axes are valid', () => {
  const validPrimary = resolveBackendConfiguration('firestore', true);
  const validSecondary = resolveFilesBackendConfiguration('worker', true, 'firestore');
  const combined = combineBackendConfigurations(validPrimary, validSecondary);
  assert.equal(combined, validPrimary);
});
