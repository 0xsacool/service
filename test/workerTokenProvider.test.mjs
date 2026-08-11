import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { fetchWithWorkerToken } = await vite.ssrLoadModule(
  '/src/auth/workerTokenProvider.ts'
);

test('Worker requests inject the current Firebase ID token', async () => {
  const refreshes = [];
  let authorization = null;
  const response = await fetchWithWorkerToken(
    {
      async getIdToken(forceRefresh) {
        refreshes.push(forceRefresh);
        return 'current-token';
      },
    },
    'https://worker.example.test/files/path',
    { method: 'GET' },
    {
      async fetch(_input, init) {
        authorization = new Headers(init.headers).get('Authorization');
        return new Response(null, { status: 200 });
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(refreshes, [false]);
  assert.equal(authorization, 'Bearer current-token');
});

test('a Worker 401 refreshes the Firebase token once and retries once', async () => {
  const refreshes = [];
  let calls = 0;
  const response = await fetchWithWorkerToken(
    {
      async getIdToken(forceRefresh) {
        refreshes.push(forceRefresh);
        return forceRefresh ? 'fresh-token' : 'old-token';
      },
    },
    'https://worker.example.test/files/path',
    { method: 'GET' },
    {
      async fetch() {
        calls += 1;
        return new Response(null, { status: calls === 1 ? 401 : 200 });
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(calls, 2);
});

test('a persistent Worker 401 triggers the session recovery hook without another retry', async () => {
  let calls = 0;
  let recoveryCalls = 0;
  const response = await fetchWithWorkerToken(
    {
      async getIdToken() {
        return 'token';
      },
      async handlePersistentUnauthorized() {
        recoveryCalls += 1;
      },
    },
    'https://worker.example.test/files/path',
    { method: 'GET' },
    {
      async fetch() {
        calls += 1;
        return new Response(null, { status: 401 });
      },
    }
  );

  assert.equal(response.status, 401);
  assert.equal(calls, 2);
  assert.equal(recoveryCalls, 1);
});

test('a Worker 403 is surfaced without a token refresh or cross-scope retry', async () => {
  const refreshes = [];
  let calls = 0;
  const response = await fetchWithWorkerToken(
    {
      async getIdToken(forceRefresh) {
        refreshes.push(forceRefresh);
        return 'token';
      },
    },
    'https://worker.example.test/files/path',
    { method: 'GET' },
    {
      async fetch() {
        calls += 1;
        return new Response(null, { status: 403 });
      },
    }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(refreshes, [false]);
  assert.equal(calls, 1);
});

test('a missing Firebase token fails closed before any Worker request', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchWithWorkerToken(
        {
          async getIdToken() {
            return null;
          },
        },
        'https://worker.example.test/files/path',
        { method: 'GET' },
        {
          async fetch() {
            calls += 1;
            return new Response(null, { status: 200 });
          },
        }
      ),
    /not configured/
  );
  assert.equal(calls, 0);
});
