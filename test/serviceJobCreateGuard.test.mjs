import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const loadServiceJobCreation = async () =>
  await vite.ssrLoadModule('/src/services/serviceJobCreation.ts');
const loadRuntimeDiagnostics = async () =>
  await vite.ssrLoadModule('/src/config/runtimeDiagnostics.ts');

function spy(result) {
  const fn = async () => {
    fn.calls += 1;
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = 0;
  return fn;
}

// F5d-54B. Terra (F5d-54A) found assertFirestoreWorkerCreatePath() was
// computed and logged but never enforced — a Firestore create could still
// reach the repository/Worker path even when the assertion reported
// ok: false (e.g. backendKind=firestore with a non-worker files backend).
// These tests exercise performServiceJobCreate()'s actual dispatch
// behavior with spy delegates, proving real enforcement rather than only
// checking source text for the word "if".

test('A. Mock mode: createViaMock is invoked exactly once, createViaFirestore is never invoked, Worker readiness is irrelevant', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const mockCreate = spy({ id: 'BRN-2026-000123' });
  const firestoreCreate = spy({ id: 'should-never-happen' });
  // Deliberately an unready readiness object — Mock must not care.
  const result = await performServiceJobCreate(
    'mock',
    { ok: false, path: 'mock', reasons: ['backendKind is "mock", not "firestore"'] },
    { createViaMock: mockCreate, createViaFirestore: firestoreCreate }
  );
  assert.deepEqual(result, { id: 'BRN-2026-000123' });
  assert.equal(mockCreate.calls, 1);
  assert.equal(firestoreCreate.calls, 0);
});

test('B. Firestore + Worker + URL: passes the guard, createViaFirestore is invoked exactly once, createViaMock is never invoked', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const mockCreate = spy({ id: 'should-never-happen' });
  const firestoreCreate = spy({ id: 'BRN-2026-000456' });
  const result = await performServiceJobCreate(
    'firestore',
    { ok: true, path: 'firestore-worker', reasons: [] },
    { createViaMock: mockCreate, createViaFirestore: firestoreCreate }
  );
  assert.deepEqual(result, { id: 'BRN-2026-000456' });
  assert.equal(firestoreCreate.calls, 1);
  assert.equal(mockCreate.calls, 0);
});

test('C. Firestore + Worker + missing URL: rejects before any delegate is invoked', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const mockCreate = spy({ id: 'should-never-happen' });
  const firestoreCreate = spy({ id: 'should-never-happen' });
  await assert.rejects(
    () =>
      performServiceJobCreate(
        'firestore',
        {
          ok: false,
          path: 'firestore-worker',
          reasons: ['VITE_FILES_WORKER_URL is not configured'],
        },
        { createViaMock: mockCreate, createViaFirestore: firestoreCreate }
      ),
    /Firestore create path is not ready for Worker mode/
  );
  assert.equal(firestoreCreate.calls, 0);
  assert.equal(mockCreate.calls, 0);
});

test('D. Firestore + non-Worker files backend: rejects before any delegate is invoked', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const mockCreate = spy({ id: 'should-never-happen' });
  const firestoreCreate = spy({ id: 'should-never-happen' });
  await assert.rejects(
    () =>
      performServiceJobCreate(
        'firestore',
        {
          ok: false,
          path: 'firestore-worker',
          reasons: ['filesBackend is not "worker"'],
        },
        { createViaMock: mockCreate, createViaFirestore: firestoreCreate }
      ),
    /Firestore create path is not ready for Worker mode/
  );
  assert.equal(firestoreCreate.calls, 0);
  assert.equal(mockCreate.calls, 0);
});

test('E. invalid/non-ready configuration (null backendKind): no create delegate is ever invoked', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const mockCreate = spy({ id: 'should-never-happen' });
  const firestoreCreate = spy({ id: 'should-never-happen' });
  await assert.rejects(() =>
    performServiceJobCreate(
      null,
      { ok: false, path: 'mock', reasons: ['backendKind is "mock", not "firestore"'] },
      { createViaMock: mockCreate, createViaFirestore: firestoreCreate }
    )
  );
  assert.equal(firestoreCreate.calls, 0);
  assert.equal(mockCreate.calls, 0);
});

test('F. the create guard and the diagnostic assertion agree on readiness across every backend/filesBackend/worker combination', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  const { computeCreatePathAssertion } = await loadRuntimeDiagnostics();

  const cases = [
    { backendKind: 'mock', filesBackend: 'mock', workerConfigured: false },
    { backendKind: 'mock', filesBackend: 'worker', workerConfigured: true },
    { backendKind: 'firestore', filesBackend: 'worker', workerConfigured: true },
    { backendKind: 'firestore', filesBackend: 'worker', workerConfigured: false },
    { backendKind: 'firestore', filesBackend: 'mock', workerConfigured: true },
    { backendKind: null, filesBackend: null, workerConfigured: false },
  ];

  for (const diagnostics of cases) {
    const assertion = computeCreatePathAssertion({
      ...diagnostics,
      firebaseProject: null,
    });
    const firestoreCreate = spy({ id: 'firestore-result' });
    const mockCreate = spy({ id: 'mock-result' });

    if (diagnostics.backendKind === 'mock') {
      const result = await performServiceJobCreate(diagnostics.backendKind, assertion, {
        createViaMock: mockCreate,
        createViaFirestore: firestoreCreate,
      });
      assert.deepEqual(result, { id: 'mock-result' });
      continue;
    }

    if (assertion.ok) {
      const result = await performServiceJobCreate(diagnostics.backendKind, assertion, {
        createViaMock: mockCreate,
        createViaFirestore: firestoreCreate,
      });
      assert.deepEqual(result, { id: 'firestore-result' });
      assert.equal(firestoreCreate.calls, 1);
    } else {
      await assert.rejects(() =>
        performServiceJobCreate(diagnostics.backendKind, assertion, {
          createViaMock: mockCreate,
          createViaFirestore: firestoreCreate,
        })
      );
      assert.equal(firestoreCreate.calls, 0);
    }
    assert.equal(mockCreate.calls, 0);
  }
});

test('G. the rejection message contains no secret/config dump — only the pre-sanitized reasons already produced by computeCreatePathAssertion', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  await assert.rejects(
    () =>
      performServiceJobCreate(
        'firestore',
        {
          ok: false,
          path: 'firestore-worker',
          reasons: ['VITE_FILES_WORKER_URL is not configured'],
        },
        {
          createViaMock: spy({}),
          createViaFirestore: spy({}),
        }
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /AIza|https?:\/\/|apiKey|token|Bearer/i);
      return true;
    }
  );
});

test('performServiceJobCreate never begins the create attempt (no side effect) before the readiness check for an unready Firestore path', async () => {
  const { performServiceJobCreate } = await loadServiceJobCreation();
  let sideEffectRan = false;
  const firestoreCreate = async () => {
    sideEffectRan = true;
    return { id: 'should-never-happen' };
  };
  await assert.rejects(() =>
    performServiceJobCreate(
      'firestore',
      { ok: false, path: 'firestore-worker', reasons: ['filesBackend is not "worker"'] },
      { createViaMock: spy({}), createViaFirestore: firestoreCreate }
    )
  );
  assert.equal(sideEffectRan, false);
});

test('useCreateServiceJob.ts routes creation through performServiceJobCreate with lazy (never pre-invoked) delegates', async () => {
  const source = await readSource('src/hooks/useCreateServiceJob.ts');
  assert.match(source, /performServiceJobCreate\(backendKind, assertion, \{/);
  assert.match(source, /createViaMock: \(\) =>/);
  assert.match(source, /createViaFirestore: async \(\) => \{/);
  // The idempotency key must be generated inside the Firestore delegate,
  // never before performServiceJobCreate is called (Objective 5).
  const dispatchIndex = source.indexOf('performServiceJobCreate(backendKind');
  const uuidIndex = source.indexOf('crypto.randomUUID()');
  assert.ok(dispatchIndex >= 0 && uuidIndex >= 0);
  assert.ok(
    uuidIndex > dispatchIndex,
    'crypto.randomUUID() must appear textually inside the dispatch call, not before it'
  );
});

test('useCreateServiceJob.ts no longer contains an unenforced inline Firestore branch (the F5d-54A blocker)', async () => {
  const source = await readSource('src/hooks/useCreateServiceJob.ts');
  assert.doesNotMatch(
    source,
    /if \(backendKind === 'mock'\) \{\s*\n\s*return await repositories/
  );
});
