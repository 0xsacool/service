import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-49B (Terra P2 UX honesty) established that this copy must never
// promise a search dimension that silently never matches — at the time,
// Firestore-mode search only supported name/phone/tracking/serial (no
// marketplace/order backing collection existed — DECISIONS.md #038). F5d-69
// closed that gap: orderNumber/contactChannelIdentity are now real
// ServiceJob fields, matched in memory by firestoreSearchRepository.ts
// (DECISIONS.md #041), so both modes advertise the same dimensions today
// and the backendKind branches these tests used to check are gone by
// design — asserted below as their *absence*, not re-added. The unwired
// "+ New Customer" action must still not look live where it genuinely
// isn't (superseded by F5d-65 below). Source-text assertions, not
// rendering, matching this project's existing no-React-renderer testing
// approach.

test('SearchInput no longer branches on backendKind, and the single copy advertises marketplace/order (F5d-69 closed the gap)', async () => {
  const source = await readSource('src/shared/components/search/SearchInput.tsx');
  assert.doesNotMatch(source, /backendKind\s*===/);
  assert.match(source, /ชื่อผู้ใช้/);
  assert.match(source, /ออเดอร์/);
});

test('SearchEmptyState no longer branches on backendKind, and the single bare prompt advertises marketplace/order', async () => {
  const source = await readSource('src/shared/components/search/SearchEmptyState.tsx');
  assert.doesNotMatch(source, /backendKind\s*===/);
  assert.match(source, /ชื่อผู้ใช้/);
  assert.match(source, /ออเดอร์/);
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

test('NewServiceJob no longer branches its start-search subtitle on backendKind, and the single copy advertises marketplace/order', async () => {
  const source = await readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
  const promptDeclaration = source.match(/const START_SEARCH_PROMPT =[\s\S]*?;/)[0];
  assert.doesNotMatch(promptDeclaration, /backendKinds*===/);
  assert.match(promptDeclaration, /ชื่อผู้ใช้/);
  assert.match(promptDeclaration, /ออเดอร์/);
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
