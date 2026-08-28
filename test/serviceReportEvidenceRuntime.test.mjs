import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Phase 6R-B.4 — ordinary Service Report evidence object-URL ownership
// (Phase 4R.6R2 SHOULD FIX).
//
// getDownloadUrl() returns a caller-owned disposable object URL, so the one
// thing that has to be proven here is ORDERING: what happens to a URL that
// arrives after the request that asked for it is gone. Source text cannot show
// that — `URL.revokeObjectURL` appearing in a cleanup says nothing about a
// promise that settles after the cleanup already ran. Every case below
// therefore holds the download open with a deferred and releases it at a
// chosen point relative to unmount and to the evidence selection changing.
//
// The seam is test/support/hookRuntime.mjs aliased over `react`, the same
// wiring test/approvalConsoleHookLifecycle.test.mjs uses. The hook under test
// is the real, unmodified src/hooks/useServiceReportEvidence.ts; only the
// two-argument call is wrapped so mountHook can drive it as one props object.
// ServiceReportPrintPreview is deliberately not mounted: it would add
// document/lucide-react setup and prove nothing extra, since every ordering in
// this finding lives in the hook.

const RUNTIME = fileURLToPath(new URL('./support/hookRuntime.mjs', import.meta.url));

globalThis.window = globalThis.window ?? new EventTarget();
globalThis.document = globalThis.document ?? new EventTarget();

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { react: RUNTIME } },
  optimizeDeps: { noDiscovery: true, include: [] },
  // Same cacheDir discipline as the sibling runtime suites: this suite alters
  // the Vite config, so it must not share node_modules/.vite with them while
  // root `node --test` runs test files concurrently.
  cacheDir: join(tmpdir(), 'service-report-evidence-runtime'),
});
after(() => vite.close());

const { deferred, mountHook } = await vite.ssrLoadModule(RUNTIME);
const { useServiceReportEvidence } = await vite.ssrLoadModule(
  '/src/hooks/useServiceReportEvidence.ts'
);
const { repositories } = await vite.ssrLoadModule('/src/repositories/repositoryProvider.ts');

const ID_A = 'service-jobs/BRN-2026-000001/before/photo-1.jpg';
const ID_B = 'service-jobs/BRN-2026-000002/after/photo-2.jpg';
const ID_PDF = 'service-jobs/BRN-2026-000001/other/receipt.pdf';

function attachment(id, name, contentType = 'image/jpeg') {
  return { id, name, category: 'before', size: 1024, contentType };
}

const ATTACHMENTS_A = [attachment(ID_A, 'ก่อนซ่อม.jpg')];
const ATTACHMENTS_B = [attachment(ID_B, 'หลังซ่อม.png', 'image/png')];

// Request A and request B differ in both halves of the hook's requestKey — the
// attachment id AND the content type — so neither test identity can be
// mistaken for the other by a partial comparison.
const REQUEST_A = { ids: [ID_A], attachments: ATTACHMENTS_A };
const REQUEST_B = { ids: [ID_B], attachments: ATTACHMENTS_B };

const originalRevoke = globalThis.URL.revokeObjectURL;
const originalAttachments = repositories.attachments;
const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;
after(() => {
  globalThis.URL.revokeObjectURL = originalRevoke;
  repositories.attachments = originalAttachments;
  globalThis.localStorage = originalLocalStorage;
  globalThis.sessionStorage = originalSessionStorage;
});

// The contract forbids persisting a disposable URL. Recording storage doubles
// are what turn that from a stated rule into an observed one.
let stored = [];
function recordingStorage() {
  return {
    getItem: () => null,
    setItem: (key, value) => stored.push({ key, value: String(value) }),
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

let revoked = [];
let pending = [];

beforeEach(() => {
  revoked = [];
  pending = [];
  stored = [];
  globalThis.localStorage = recordingStorage();
  globalThis.sessionStorage = recordingStorage();
  globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
  repositories.attachments = {
    ...originalAttachments,
    getForJob: () => [...ATTACHMENTS_A, ...ATTACHMENTS_B],
    getDownloadUrl(id) {
      const gate = deferred();
      pending.push({ id, gate });
      return gate.promise;
    },
  };
});

const mount = (props = REQUEST_A) =>
  mountHook((current) => useServiceReportEvidence(current.ids, current.attachments), props);

test('case 1: a resolution that lands before unmount is published, then revoked exactly once on unmount', async () => {
  const hook = mount();
  await hook.flush();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, ID_A);
  assert.equal(hook.result().isLoading, true);

  pending[0].gate.resolve('blob:report-evidence-a');
  await hook.flush();

  assert.equal(hook.result().isLoading, false);
  assert.deepEqual(
    hook.result().evidence.map((item) => [item.id, item.url, item.status]),
    [[ID_A, 'blob:report-evidence-a', 'ready']]
  );
  assert.deepEqual(revoked, [], 'a displayed URL is not revoked while its request is current');

  hook.unmount();
  assert.deepEqual(revoked, ['blob:report-evidence-a']);
});

test('case 2: a resolution that lands after unmount is revoked immediately and never published', async () => {
  const hook = mount();
  await hook.flush();
  assert.equal(pending.length, 1);
  const rendersBeforeUnmount = hook.renders();

  hook.unmount();
  assert.deepEqual(revoked, [], 'the URL does not exist yet at unmount, so there is nothing to revoke');

  pending[0].gate.resolve('blob:late-after-unmount');
  await hook.flush();

  assert.deepEqual(
    revoked,
    ['blob:late-after-unmount'],
    'the late URL is disposed of by the resolution itself, not left ownerless'
  );
  assert.equal(hook.renders(), rendersBeforeUnmount, 'no state was published after unmount');
  assert.deepEqual(hook.result().evidence, [], 'the unmounted hook never received the late URL');
});

test('case 3: request A pending, request B current, late A — no publish into B and A is revoked', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, ID_A);

  hook.rerender(REQUEST_B);
  await hook.flush();
  assert.equal(pending.length, 2, 'B dispatches its own download');
  assert.equal(pending[1].id, ID_B);
  assert.equal(hook.result().isLoading, true);

  pending[0].gate.resolve('blob:late-a');
  await hook.flush();

  assert.deepEqual(revoked, ['blob:late-a'], 'the A object URL is released, not leaked');
  assert.deepEqual(hook.result().evidence, [], 'late A evidence never appears under B');
  assert.equal(hook.result().isLoading, true, 'B remains its own pending request');

  pending[1].gate.resolve('blob:b');
  await hook.flush();
  assert.deepEqual(
    hook.result().evidence.map((item) => [item.id, item.url]),
    [[ID_B, 'blob:b']],
    'B publishes its own URL, uncontaminated by A'
  );

  hook.unmount();
  assert.deepEqual(revoked, ['blob:late-a', 'blob:b']);
});

test('case 4: an already-displayed URL is revoked when the request changes to B', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  pending[0].gate.resolve('blob:displayed-a');
  await hook.flush();
  assert.equal(hook.result().evidence[0].url, 'blob:displayed-a');

  hook.rerender(REQUEST_B);
  await hook.flush();

  assert.deepEqual(revoked, ['blob:displayed-a'], 'the A URL is released at the ownership change');
  assert.equal(hook.result().isLoading, true, 'B is loading rather than showing A');

  pending[1].gate.resolve('blob:b-after-a');
  await hook.flush();
  assert.deepEqual(
    hook.result().evidence.map((item) => item.url),
    ['blob:b-after-a']
  );
  hook.unmount();
  assert.deepEqual(revoked, ['blob:displayed-a', 'blob:b-after-a']);
});

test('case 5: a failed resolution leaks nothing, and a later request still resolves and is owned', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  pending[0].gate.reject(new Error('transient download failure'));
  await hook.flush();

  assert.deepEqual(revoked, [], 'a failure creates no object URL to leak');
  assert.equal(hook.result().isLoading, false);
  assert.deepEqual(
    hook.result().evidence.map((item) => [item.id, item.url, item.status]),
    [[ID_A, null, 'unavailable']],
    'the failure surfaces as unavailable rather than a broken URL'
  );

  hook.rerender(REQUEST_B);
  await hook.flush();
  assert.equal(pending.length, 2, 'the next request actually re-dispatches a download');
  pending[1].gate.resolve('blob:after-failure');
  await hook.flush();
  assert.equal(hook.result().evidence[0].url, 'blob:after-failure');
  assert.deepEqual(revoked, [], 'nothing was revoked while the new URL is current');

  hook.unmount();
  assert.deepEqual(revoked, ['blob:after-failure']);
});

test('case 5b: a late failure after unmount publishes nothing and revokes nothing', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  const rendersBeforeUnmount = hook.renders();
  hook.unmount();

  pending[0].gate.reject(new Error('late transient failure'));
  await hook.flush();

  assert.deepEqual(revoked, []);
  assert.equal(hook.renders(), rendersBeforeUnmount);
});

test('case 6: a rerender with the same request re-requests nothing and revokes nothing', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  pending[0].gate.resolve('blob:stable');
  await hook.flush();
  assert.equal(hook.result().isLoading, false);

  // New array identities carrying the identical selection: the requestKey is
  // unchanged, so the effect must not re-run.
  hook.rerender({ ids: [ID_A], attachments: [attachment(ID_A, 'ก่อนซ่อม.jpg')] });
  await hook.flush();

  assert.equal(pending.length, 1, 'no second download was dispatched');
  assert.deepEqual(revoked, [], 'the current URL was not spuriously revoked');
  assert.equal(hook.result().isLoading, false, 'the evidence never flickers back to loading');
  assert.equal(hook.result().evidence[0].url, 'blob:stable');

  hook.unmount();
  assert.deepEqual(revoked, ['blob:stable']);
});

test('case 7: a non-image selection resolves to unavailable without requesting a URL', async () => {
  const hook = mount({
    ids: [ID_PDF],
    attachments: [attachment(ID_PDF, 'ใบเสร็จ.pdf', 'application/pdf')],
  });
  await hook.flush();

  assert.deepEqual(pending, [], 'no download is dispatched for a non-image attachment');
  assert.deepEqual(
    hook.result().evidence.map((item) => [item.id, item.url, item.status]),
    [[ID_PDF, null, 'unavailable']]
  );
  hook.unmount();
  assert.deepEqual(revoked, []);
});

test('case 8: several evidence items are each owned, and a mid-flight unmount leaves none ownerless', async () => {
  const attachments = [
    attachment(ID_A, 'ก่อนซ่อม.jpg'),
    attachment(ID_B, 'หลังซ่อม.png', 'image/png'),
  ];
  const hook = mount({ ids: [ID_A, ID_B], attachments });
  await hook.flush();
  assert.equal(pending.length, 2);

  // The first item lands while the request is still current, the second only
  // after unmount: one URL is revoked by cleanup, the other by itself.
  pending[0].gate.resolve('blob:multi-first');
  await hook.flush();
  assert.deepEqual(revoked, [], 'a partially resolved batch publishes and revokes nothing yet');

  hook.unmount();
  pending[1].gate.resolve('blob:multi-second');
  await hook.flush();

  assert.deepEqual(
    revoked.slice().sort(),
    ['blob:multi-first', 'blob:multi-second'].sort(),
    'both URLs from the interrupted batch are released'
  );
});

test('no disposable evidence URL is ever written to persistent browser storage', async () => {
  const hook = mount(REQUEST_A);
  await hook.flush();
  pending[0].gate.resolve('blob:persist-probe');
  await hook.flush();
  assert.equal(hook.result().evidence[0].url, 'blob:persist-probe');

  hook.rerender(REQUEST_B);
  await hook.flush();
  pending[1].gate.resolve('blob:persist-probe-b');
  await hook.flush();
  hook.unmount();
  await hook.flush();

  assert.deepEqual(stored, [], 'the ordinary evidence path writes nothing to browser storage');
  assert.deepEqual(revoked, ['blob:persist-probe', 'blob:persist-probe-b']);
});
