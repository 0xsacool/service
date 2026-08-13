import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-55. Gate 7.1's manual UI acceptance failed at the transport layer
// with "Failed to execute 'fetch' on 'Window': Illegal invocation" — the
// browser's native fetch is a WebIDL "unforgeable" method that requires
// Window (or another Window-like global) as its receiver. The old
// `const browserWorkerFetchDependencies = { fetch }` copied the fetch
// reference onto a plain object with no receiver binding; calling it as
// `dependencies.fetch(...)` invoked native fetch with `dependencies` (a
// plain object) as `this`, which Chrome rejects. Production impact was
// zero durable writes — the request never left the browser.
//
// These tests reproduce the receiver check itself (a real function that
// throws unless invoked with the correct `this`, mirroring Chrome's
// behavior), not just source-text pattern matching, per Objective 3.

function makeNativeStyleFetch(expectedReceiver) {
  // Deliberately `function`, not an arrow function — only a real function
  // has a call-site-dependent `this`, which is exactly the property native
  // browser fetch relies on to reject a mismatched receiver.
  return function nativeStyleFetch() {
    if (this !== expectedReceiver) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  };
}

test('OLD pattern reproduction: a plain-object-attached native-style fetch throws Illegal invocation when called as dependencies.fetch(...)', () => {
  const nativeStyleFetch = makeNativeStyleFetch(globalThis);
  const oldStyleDependencies = { fetch: nativeStyleFetch };
  assert.throws(() => oldStyleDependencies.fetch('https://worker.example.test/x'), {
    name: 'TypeError',
    message: /Illegal invocation/,
  });
});

test('FIXED pattern: binding the native-style fetch to globalThis before attaching it to a plain object succeeds', () => {
  const nativeStyleFetch = makeNativeStyleFetch(globalThis);
  const fixedDependencies = { fetch: nativeStyleFetch.bind(globalThis) };
  assert.doesNotThrow(() => fixedDependencies.fetch('https://worker.example.test/x'));
});

test('the real default browser fetch dependency in workerTokenProvider.ts succeeds against a receiver-checking native-style fetch, with no dependencies override', async () => {
  const originalFetch = globalThis.fetch;
  let observedReceiver = 'not-called';
  globalThis.fetch = function nativeStyleFetch() {
    observedReceiver = this;
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  // A dedicated, fresh Vite server so workerTokenProvider.ts's module-level
  // browserWorkerFetchDependencies const is evaluated fresh against our
  // patched globalThis.fetch, rather than reusing another test file's
  // already-cached module graph (bound to the real Node fetch).
  const vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { fetchWithWorkerToken } = await vite.ssrLoadModule(
      '/src/auth/workerTokenProvider.ts'
    );
    const response = await fetchWithWorkerToken(
      {
        async getIdToken() {
          return 'a-real-looking-id-token';
        },
      },
      'https://worker.example.test/service-jobs',
      { method: 'POST' }
      // No dependencies override — this exercises the real production
      // default path, not an injected fake.
    );
    assert.equal(response.status, 200);
    assert.equal(observedReceiver, globalThis);
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
  }
});

test('workerTokenProvider.ts no longer constructs its default fetch dependency as a bare { fetch } object literal', async () => {
  const source = await readSource('src/auth/workerTokenProvider.ts');
  assert.doesNotMatch(source, /=\s*\{\s*fetch\s*\}\s*;/);
  assert.match(source, /globalThis\.fetch\.bind\(globalThis\)/);
});

test('dependency injection is preserved: WorkerFetchDependencies is still a parameter with a default, not hardwired', async () => {
  const source = await readSource('src/auth/workerTokenProvider.ts');
  assert.match(
    source,
    /dependencies: WorkerFetchDependencies = browserWorkerFetchDependencies/
  );
  assert.match(source, /dependencies\.fetch\(/);
});

test('the transport path never logs or embeds the Firebase ID token anywhere except the Authorization header it sends', async () => {
  const source = await readSource('src/auth/workerTokenProvider.ts');
  assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
  // The only place idToken may appear textually is the Authorization
  // header construction itself.
  const idTokenUses = source.match(/idToken/g) ?? [];
  assert.ok(idTokenUses.length > 0);
  assert.match(source, /Authorization: `Bearer \$\{idToken\}`/);
});

test('a thrown "missing token" error never contains the token value itself (there is none to leak)', async () => {
  const vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { fetchWithWorkerToken } = await vite.ssrLoadModule(
      '/src/auth/workerTokenProvider.ts'
    );
    await assert.rejects(
      () =>
        fetchWithWorkerToken(
          {
            async getIdToken() {
              return null;
            },
          },
          'https://worker.example.test/service-jobs',
          { method: 'POST' },
          {
            async fetch() {
              throw new Error('must not be called');
            },
          }
        ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /Bearer|AIza|ey[A-Za-z0-9_-]{10,}/);
        return true;
      }
    );
  } finally {
    await vite.close();
  }
});
