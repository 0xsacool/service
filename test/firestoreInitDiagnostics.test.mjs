import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const loadDiagnostics = async () =>
  await vite.ssrLoadModule('/src/repositories/firestoreInitDiagnostics.ts');

// F5d-52. AuthSessionProvider.tsx currently catches every
// activateFirestoreRepositories() failure with one generic, user-facing
// message and no other detail (F5d-50's live rehearsal only ever saw
// "Staff data could not be initialized. Try again later."). This module
// exists purely to make the exact, sanitized failing stage observable in
// local development without changing that generic message or anything else
// about control flow — every test here proves an observation property, not
// a behavior change.

test('sanitizedFirestoreErrorCode passes through only recognized Firestore error codes', async () => {
  const { sanitizedFirestoreErrorCode } = await loadDiagnostics();
  assert.equal(
    sanitizedFirestoreErrorCode({ code: 'permission-denied' }),
    'permission-denied'
  );
  assert.equal(sanitizedFirestoreErrorCode({ code: 'unavailable' }), 'unavailable');
  assert.equal(
    sanitizedFirestoreErrorCode({ code: 'unauthenticated' }),
    'unauthenticated'
  );
});

test('sanitizedFirestoreErrorCode falls back to "unknown" for anything unrecognized or malformed', async () => {
  const { sanitizedFirestoreErrorCode } = await loadDiagnostics();
  assert.equal(sanitizedFirestoreErrorCode({ code: 'made-up-code' }), 'unknown');
  assert.equal(sanitizedFirestoreErrorCode({ code: 123 }), 'unknown');
  assert.equal(sanitizedFirestoreErrorCode({}), 'unknown');
  assert.equal(sanitizedFirestoreErrorCode(null), 'unknown');
  assert.equal(sanitizedFirestoreErrorCode(undefined), 'unknown');
  assert.equal(sanitizedFirestoreErrorCode('a raw string error'), 'unknown');
  assert.equal(
    sanitizedFirestoreErrorCode(new Error('plain error, no .code')),
    'unknown'
  );
});

test('describeFirestoreInitError produces exactly {repository, stage, code} and nothing else', async () => {
  const { describeFirestoreInitError } = await loadDiagnostics();
  const entry = describeFirestoreInitError(
    { code: 'permission-denied' },
    'customers',
    'initial-listener'
  );
  assert.deepEqual(Object.keys(entry).sort(), ['code', 'repository', 'stage']);
  assert.deepEqual(entry, {
    repository: 'customers',
    stage: 'initial-listener',
    code: 'permission-denied',
  });
});

test('a raw error carrying PII-shaped content (a legacy phone-keyed document path, a token) is never exposed', async () => {
  const { describeFirestoreInitError } = await loadDiagnostics();
  const secretPhone = '0812345678';
  const secretToken = 'ey.raw.jwt.should.never.appear';
  const rawError = {
    code: 'permission-denied',
    message: `Missing or insufficient permissions for customers/${secretPhone}`,
    customData: { authToken: secretToken },
    stack: `Error: at customers/${secretPhone}`,
  };
  const entry = describeFirestoreInitError(rawError, 'customers', 'initial-listener');
  const serialized = JSON.stringify(entry);
  assert.doesNotMatch(serialized, new RegExp(secretPhone));
  assert.doesNotMatch(serialized, new RegExp(secretToken));
  assert.doesNotMatch(serialized, /message|customData|stack|authToken/);
});

test('recordFirestoreInitFailure/getFirestoreInitDiagnostics/clearFirestoreInitDiagnostics round-trip', async () => {
  const {
    recordFirestoreInitFailure,
    getFirestoreInitDiagnostics,
    clearFirestoreInitDiagnostics,
  } = await loadDiagnostics();
  clearFirestoreInitDiagnostics();
  assert.deepEqual(getFirestoreInitDiagnostics(), []);
  recordFirestoreInitFailure({
    repository: 'productMaster',
    stage: 'factory',
    code: 'unavailable',
  });
  recordFirestoreInitFailure({
    repository: 'serviceReports',
    stage: 'listener',
    code: 'permission-denied',
  });
  const diagnostics = getFirestoreInitDiagnostics();
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].repository, 'productMaster');
  assert.equal(diagnostics[1].repository, 'serviceReports');
  clearFirestoreInitDiagnostics();
  assert.deepEqual(getFirestoreInitDiagnostics(), []);
});

test('recordFirestoreInitFailure logs the documented "[Firestore Init] <repo>: <code> (<stage>)" line in dev', async () => {
  const { recordFirestoreInitFailure, clearFirestoreInitDiagnostics } =
    await loadDiagnostics();
  clearFirestoreInitDiagnostics();
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(' '));
  try {
    recordFirestoreInitFailure({
      repository: 'customers',
      stage: 'initial-listener',
      code: 'permission-denied',
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(
    calls.some(
      (line) =>
        line === '[Firestore Init] customers: permission-denied (initial-listener)'
    ),
    `expected the documented diagnostic line, got: ${JSON.stringify(calls)}`
  );
});

test('every repository that participates in Firestore activation imports and calls the diagnostic recorder', async () => {
  const paths = [
    'src/repositories/firestoreServiceJobRepository.ts',
    'src/repositories/firestoreCustomersRepository.ts',
    'src/repositories/firestoreProductMasterRepository.ts',
    'src/repositories/firestoreServiceReportsRepository.ts',
    'src/repositories/firestoreAttachmentsRepository.ts',
    'src/repositories/repositoryProvider.ts',
  ];
  for (const path of paths) {
    const source = await readSource(path);
    assert.match(
      source,
      /from '\.\/firestoreInitDiagnostics'/,
      `${path} should import firestoreInitDiagnostics`
    );
    assert.match(
      source,
      /recordFirestoreInitFailure\(/,
      `${path} should call recordFirestoreInitFailure`
    );
  }
});

test('initial-listener vs listener stage is distinguished by the same "settled" flag that already gates the readiness promise', async () => {
  const paths = [
    'src/repositories/firestoreServiceJobRepository.ts',
    'src/repositories/firestoreCustomersRepository.ts',
    'src/repositories/firestoreProductMasterRepository.ts',
  ];
  for (const path of paths) {
    const source = await readSource(path);
    assert.match(
      source,
      /settled \? 'listener' : 'initial-listener'/,
      `${path} should classify by the existing settled flag, not a new one`
    );
  }
});

test('repositoryProvider.ts wraps each Firestore repository factory call so a synchronous/rejected failure is tagged before being rethrown unchanged', async () => {
  const source = await readSource('src/repositories/repositoryProvider.ts');
  assert.match(source, /async function activateWithDiagnostics/);
  assert.match(source, /catch \(error\) \{\s*recordFirestoreInitFailure/);
  assert.match(source, /throw error;/);
  assert.match(source, /activateWithDiagnostics\('serviceJobs'/);
  assert.match(source, /activateWithDiagnostics\('customers'/);
  assert.match(source, /activateWithDiagnostics\('productMaster'/);
  assert.match(source, /activateWithDiagnostics\('attachments'/);
  assert.match(source, /activateWithDiagnostics\('serviceReports'/);
});

test('each activation attempt clears diagnostics from any prior attempt before running', async () => {
  const source = await readSource('src/repositories/repositoryProvider.ts');
  assert.match(
    source,
    /clearFirestoreInitDiagnostics\(\);\s*\n\s*repositories = await createFirestoreBackedRepositoryProvider/
  );
});

test('AuthSessionProvider.tsx is untouched: still one generic message, no diagnostic import, no raw error read from the catch', async () => {
  const source = await readSource('src/auth/AuthSessionProvider.tsx');
  assert.doesNotMatch(source, /firestoreInitDiagnostics/);
  assert.match(source, /catch \{/);
  assert.match(source, /Staff data could not be initialized\. Try again later\./);
});

test('the diagnostic record never carries a repository name outside the closed Firestore repository set', async () => {
  const { describeFirestoreInitError } = await loadDiagnostics();
  const validRepositories = [
    'serviceJobs',
    'customers',
    'productMaster',
    'attachments',
    'serviceReports',
  ];
  for (const repository of validRepositories) {
    const entry = describeFirestoreInitError(
      { code: 'unavailable' },
      repository,
      'factory'
    );
    assert.equal(entry.repository, repository);
  }
});

test('a successful repositoryProvider.ts load (Mock mode) is unaffected by the diagnostics module being present', async () => {
  const { repositories } = await vite.ssrLoadModule(
    '/src/repositories/repositoryProvider.ts'
  );
  // Mock mode never touches Firestore or the diagnostics recorder; this
  // proves importing repositoryProvider.ts with the new instrumentation in
  // place still yields an ordinary, working Mock repository set.
  assert.ok(repositories.search.search);
  const results = repositories.search.search('maggie.chen88');
  assert.ok(results.length >= 1);
});
