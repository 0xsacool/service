import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-70 Phase 2A — core repository -> React reactivity correction.
// useServiceJobs previously read repositories.serviceJobs.getAll() as a
// bare function call with no subscription at all, so a mounted Service Job
// consumer never re-rendered when the repository's live cache changed
// (neither via a direct authoritative cache write after create/update/
// issuance, nor via the existing onSnapshot listener's bump). This file
// proves: dataVersion.ts's external-store contract, that useServiceJobs is
// now wired to it correctly (a stable numeric token, never getAll()'s array,
// as the snapshot), that every direct Firestore cache write introduced in
// F5d-70 emits the invalidation signal, that the Mock repository has
// equivalent parity, and that none of this touches the F5d-69G transient
// plaintext SRV handling in any way.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { bumpDataVersion, getDataVersion, subscribeToDataVersion } = await vite.ssrLoadModule(
  '/src/repositories/dataVersion.ts'
);

// --- A: dataVersion is a stable numeric external-store snapshot ------------

test('getDataVersion() is a number and is stable across repeated reads with no intervening bump', () => {
  const a = getDataVersion();
  const b = getDataVersion();
  assert.equal(typeof a, 'number');
  assert.equal(a, b);
});

// --- B/C: subscribe / bump / unsubscribe ------------------------------------

test('a subscriber is notified synchronously after bumpDataVersion()', () => {
  let calls = 0;
  const unsubscribe = subscribeToDataVersion(() => {
    calls += 1;
  });
  const before = getDataVersion();
  bumpDataVersion();
  assert.equal(calls, 1);
  assert.equal(getDataVersion(), before + 1);
  unsubscribe();
});

test('unsubscribe prevents any later notification', () => {
  let calls = 0;
  const unsubscribe = subscribeToDataVersion(() => {
    calls += 1;
  });
  unsubscribe();
  bumpDataVersion();
  assert.equal(calls, 0);
});

// --- D/E/I: useServiceJobs wiring, source-structural (no jsdom in this repo) -

const useServiceJobsSourcePromise = readSource('src/hooks/useServiceJobs.ts');

test('useServiceJobs subscribes via useSyncExternalStore(subscribeToDataVersion, getDataVersion, getDataVersion)', async () => {
  const source = await useServiceJobsSourcePromise;
  assert.match(source, /import \{ useSyncExternalStore \} from 'react';/);
  assert.match(
    source,
    /useSyncExternalStore\(subscribeToDataVersion, getDataVersion, getDataVersion\);/
  );
});

test('getAll() is never passed as the useSyncExternalStore snapshot — it is read separately during render', async () => {
  const source = await useServiceJobsSourcePromise;
  const syncExternalStoreCall = source.match(/useSyncExternalStore\([^)]*\)/)[0];
  assert.doesNotMatch(syncExternalStoreCall, /getAll/);
  // getAll() is still called, just as an ordinary render-time read, not as
  // one of the three useSyncExternalStore arguments.
  assert.match(source, /repositories\.serviceJobs\.getAll\(\)/);
});

test('no new Firestore listener (onSnapshot/collection/query) is introduced in useServiceJobs', async () => {
  const source = await useServiceJobsSourcePromise;
  // Checks for actual calls, not prose — the hook's own comment legitimately
  // mentions "onSnapshot" by name to explain why the invalidation exists.
  assert.doesNotMatch(source, /onSnapshot\(|collection\(|query\(/);
});

test('no polling/interval/forced-reload mechanism was introduced', async () => {
  const source = await useServiceJobsSourcePromise;
  assert.doesNotMatch(source, /setInterval|setTimeout|window\.location\.reload|useEffect/);
});

// --- F/G: Firestore repository direct-write invalidation + existing bump ---

const firestoreRepoSourcePromise = readSource(
  'src/repositories/firestoreServiceJobRepository.ts'
);

test('the onSnapshot listener still calls bumpDataVersion() (pre-existing, must remain present and unique)', async () => {
  const source = await firestoreRepoSourcePromise;
  // Exactly one onSnapshot subscription remains — this phase adds no second one.
  assert.equal((source.match(/onSnapshot\(/g) ?? []).length, 1);
  assert.match(source, /\/\/ F5d-49B[\s\S]{0,300}?bumpDataVersion\(\);/);
});

test('create(): the direct authoritative cache write is immediately followed by bumpDataVersion()', async () => {
  const source = await firestoreRepoSourcePromise;
  assert.match(
    source,
    /\(created\) => \{\s*\n\s*jobsById\.set\(created\.id, created\);\s*\n\s*bumpDataVersion\(\);\s*\n\s*\}/
  );
});

test('update(): the direct authoritative cache write is immediately followed by bumpDataVersion()', async () => {
  const source = await firestoreRepoSourcePromise;
  assert.match(
    source,
    /\(updated\) => \{\s*\n\s*jobsById\.set\(updated\.id, updated\);\s*\n\s*bumpDataVersion\(\);\s*\n\s*\}/
  );
});

test('issuePublicTrackingCode(): the direct authoritative cache write is immediately followed by bumpDataVersion(), and only the hashed job (never the plaintext code) enters the cache', async () => {
  const source = await firestoreRepoSourcePromise;
  assert.match(
    source,
    /jobsById\.set\(job\.id, job\);\s*\n[\s\S]{0,500}?bumpDataVersion\(\);\s*\n\s*return \{ code: body\.code, job \};/
  );
  // The cache write itself only ever takes the parsed `job` object (already
  // hashed by the server) — never `body.code` or any raw credential.
  assert.doesNotMatch(source, /jobsById\.set\([^)]*code[^)]*\)/i);
});

// --- H: Mock repository parity — a real runtime proof, not just source -----

test('Mock Service Job repository: create/update/issuePublicTrackingCode each bump dataVersion exactly once, using the real dataVersion.ts singleton', async () => {
  const { serviceJobsRepository } = await vite.ssrLoadModule(
    '/src/repositories/serviceJobsRepository.ts'
  );
  const existing = serviceJobsRepository.getAll()[0];
  assert.notEqual(existing, undefined, 'expected at least one seeded mock job');

  const beforeUpdate = getDataVersion();
  await serviceJobsRepository.update(existing.id, { notes: existing.notes });
  assert.equal(getDataVersion(), beforeUpdate + 1);

  const beforeIssue = getDataVersion();
  const { job: issuedJob } = await serviceJobsRepository.issuePublicTrackingCode(existing.id);
  assert.equal(getDataVersion(), beforeIssue + 1);
  assert.notEqual(issuedJob.publicTrackingCodeHash, null);

  const beforeCreate = getDataVersion();
  await serviceJobsRepository.create({
    ...existing,
    id: `F5D70-QA-${Date.now()}`,
  });
  assert.equal(getDataVersion(), beforeCreate + 1);
});

// --- J/K: no plaintext credential anywhere near this, F5d-69G untouched ----

test('dataVersion.ts carries only a number — structurally incapable of holding a plaintext credential', async () => {
  const source = await readSource('src/repositories/dataVersion.ts');
  assert.match(source, /let version = 0;/);
  assert.doesNotMatch(source, /string|code|Srv|SRV/i);
});

test('none of the F5d-69G transient plaintext SRV surfaces gained a dataVersion import or a bumpDataVersion() call', async () => {
  // F5d-70 Phase 5B (a later, separately-approved phase) legitimately edited
  // ServiceJobDetails.tsx and PublicTrackingSection.tsx for UI draft
  // reconciliation, and its comments explain that work by name ("F5d-70
  // dataVersion reactivity") without importing or calling either symbol —
  // so this now checks for the actual surface (import/call), not a bare
  // word match, which the original Phase 2A assertion could not have
  // anticipated. The protective intent — the plaintext SRV must never be
  // pushed through the dataVersion signal — is unchanged and still holds.
  for (const path of [
    'src/features/service-jobs/pages/ServiceJobDetails.tsx',
    'src/features/service-jobs/components/PublicTrackingSection.tsx',
    'src/features/service-jobs/components/DeliveryNotePrintPreview.tsx',
    'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx',
  ]) {
    const source = await readSource(path);
    assert.doesNotMatch(source, /bumpDataVersion\(|from '.*dataVersion'/);
  }
});
