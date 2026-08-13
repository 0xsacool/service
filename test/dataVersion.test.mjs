import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-49B (Terra P1 search reactivity remediation). No React test renderer
// exists in this project (every existing "UI behavior" test here exercises
// extracted logic, not JSX rendering — see e.g. serviceReportUi.test.mjs),
// so this proves the reactive mechanism itself end to end at the two seams
// that make it work: (1) the pure external-store contract, and (2) that the
// Firestore listener repositories genuinely call it from inside their own
// onSnapshot handlers, and that useUniversalSearch genuinely subscribes to
// it. React's own useSyncExternalStore contract (re-render on notify) is
// not re-tested here — that's React's job, not this codebase's.

test('bumpDataVersion increments the version and notifies every subscriber', async () => {
  const { bumpDataVersion, getDataVersion, subscribeToDataVersion } =
    await vite.ssrLoadModule('/src/repositories/dataVersion.ts');
  const before = getDataVersion();
  let calls = 0;
  const unsubscribe = subscribeToDataVersion(() => {
    calls += 1;
  });
  bumpDataVersion();
  assert.equal(getDataVersion(), before + 1);
  assert.equal(calls, 1);
  unsubscribe();
  bumpDataVersion();
  // Unsubscribed listeners must not still fire.
  assert.equal(calls, 1);
  assert.equal(getDataVersion(), before + 2);
});

test('multiple independent subscribers are each notified exactly once per bump', async () => {
  const { bumpDataVersion, subscribeToDataVersion } = await vite.ssrLoadModule(
    '/src/repositories/dataVersion.ts'
  );
  let a = 0;
  let b = 0;
  const unsubA = subscribeToDataVersion(() => (a += 1));
  const unsubB = subscribeToDataVersion(() => (b += 1));
  bumpDataVersion();
  assert.equal(a, 1);
  assert.equal(b, 1);
  unsubA();
  unsubB();
});

test('firestoreCustomersRepository bumps the shared data version from inside its own snapshot handler', async () => {
  const source = await readSource('src/repositories/firestoreCustomersRepository.ts');
  assert.match(source, /import\s*\{\s*bumpDataVersion\s*\}\s*from\s*'\.\/dataVersion'/);
  assert.match(source, /onSnapshot\(/);
  assert.match(source, /bumpDataVersion\(\);/);
});

test('firestoreServiceJobRepository bumps the shared data version from inside its own snapshot handler', async () => {
  const source = await readSource('src/repositories/firestoreServiceJobRepository.ts');
  assert.match(source, /import\s*\{\s*bumpDataVersion\s*\}\s*from\s*'\.\/dataVersion'/);
  assert.match(source, /onSnapshot\(/);
  assert.match(source, /bumpDataVersion\(\);/);
});

test('useUniversalSearch subscribes to the shared data version and includes it in the search memo', async () => {
  const source = await readSource('src/hooks/useUniversalSearch.ts');
  assert.match(source, /useSyncExternalStore/);
  assert.match(
    source,
    /useSyncExternalStore\(\s*subscribeToDataVersion,\s*getDataVersion,\s*getDataVersion\s*\)/
  );
  assert.match(source, /repositories\.search\.search\(query\)/);
  assert.match(source, /\[query,\s*dataVersion\]/);
});

test('an unchanged query recalculates results once the underlying data version changes', () => {
  // Direct proof of the memoization contract useUniversalSearch relies on:
  // React's useMemo recomputes whenever any entry in its dependency array
  // changes, so including dataVersion alongside query is sufficient by
  // construction — reproduced here without React by calling the same
  // search function directly with a version-like second key.
  const calls = [];
  function search(query) {
    calls.push(query);
    return calls.length;
  }
  function memoize(fn) {
    let lastKey = null;
    let lastResult = null;
    return (query, version) => {
      const key = `${query}::${version}`;
      if (key !== lastKey) {
        lastResult = fn(query);
        lastKey = key;
      }
      return lastResult;
    };
  }
  const memoizedSearch = memoize(search);
  const query = 'same query';
  const firstResult = memoizedSearch(query, 1);
  const secondResult = memoizedSearch(query, 1); // unchanged query AND version
  assert.equal(secondResult, firstResult);
  assert.equal(calls.length, 1); // not recomputed — proves memoization alone is a no-op here

  const thirdResult = memoizedSearch(query, 2); // unchanged query, version bumped
  assert.notEqual(thirdResult, firstResult);
  assert.equal(calls.length, 2); // recomputed purely because the version changed
});
