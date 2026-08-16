import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-49B (Terra P2 UX honesty). Firestore-mode search only supports name,
// phone, tracking number, and serial number (no marketplace/order backing
// collection exists — DECISIONS.md #038); the UI text must not promise more
// than that, and the unwired "+ New Customer" action must not look live.
// Source-text assertions, not rendering, matching this project's existing
// no-React-renderer testing approach.

test('SearchInput branches its wording on backendKind and the Firestore-mode copy omits marketplace/order', async () => {
  const source = await readSource('src/shared/components/search/SearchInput.tsx');
  assert.match(source, /backendKind === 'mock'/);
  const firestoreBranchMatch = source.match(
    /: ['"]ค้นหาชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง[^'"]*['"]/
  );
  assert.ok(firestoreBranchMatch, 'expected a Firestore-mode placeholder branch');
  for (const branch of firestoreBranchMatch) {
    assert.doesNotMatch(branch, /ชื่อผู้ใช้|ออเดอร์/);
  }
});

test('SearchEmptyState branches its bare prompt on backendKind and the Firestore-mode copy omits marketplace/order', async () => {
  const source = await readSource('src/shared/components/search/SearchEmptyState.tsx');
  assert.match(source, /backendKind === 'mock'/);
  const firestoreBranchMatch = source.match(
    /: ['"]เริ่มพิมพ์ชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง['"]/
  );
  assert.ok(firestoreBranchMatch, 'expected a Firestore-mode bare-prompt branch');
});

test('F5d-65: SearchNoResults offers a live "+ New Customer" action in every backend mode', async () => {
  // Superseded by F5d-65: F5d-49B hid this control outside Mock mode
  // because customer creation was unwired everywhere. It is now wired
  // (Worker-mediated, atomic with Service Job creation — see
  // src/services/serviceJobCreation.ts), so the mode-conditional hide and
  // its "not supported" copy are gone; the button itself no longer branches
  // on backendKind at all.
  const source = await readSource('src/shared/components/search/SearchNoResults.tsx');
  assert.doesNotMatch(source, /ยังไม่รองรับในโหมดนี้/);
  assert.doesNotMatch(source, /backendKind === 'mock' \? \(/);
  assert.match(source, /สร้างลูกค้าใหม่/);
});

test('NewServiceJob branches its start-search subtitle on backendKind and the Firestore-mode copy omits marketplace/order', async () => {
  const source = await readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
  assert.match(source, /backendKind === 'mock'/);
  const firestoreBranchMatch = source.match(
    /: ['"]เริ่มจากค้นหาลูกค้า — ค้นหาด้วยชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง['"]/
  );
  assert.ok(firestoreBranchMatch, 'expected a Firestore-mode start-search prompt branch');
  const mockBranchMatch = source.match(/\? ['"]เริ่มจากค้นหาลูกค้า[^'"]*['"]/);
  assert.ok(mockBranchMatch, 'expected a Mock-mode start-search prompt branch');
  assert.match(mockBranchMatch[0], /ชื่อผู้ใช้|ออเดอร์/);
});

test('Mock search behavior is unchanged: still matches by marketplace username', async () => {
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    define: {
      'import.meta.env.VITE_BACKEND_KIND': JSON.stringify('mock'),
      'import.meta.env.VITE_FILES_BACKEND': JSON.stringify('mock'),
    },
    server: { middlewareMode: true },
  });
  try {
    const { repositories } = await vite.ssrLoadModule(
      '/src/repositories/repositoryProvider.ts'
    );
    const results = repositories.search.search('maggie.chen88');
    assert.ok(results.length >= 1, 'expected the Mock fixture username to still match');
    assert.equal(results[0].username, 'maggie.chen88');
  } finally {
    await vite.close();
  }
});
