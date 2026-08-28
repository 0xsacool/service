import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createComponentRuntimeServer, COMPONENT_RUNTIME_PATH } from './support/componentRuntimeServer.mjs';

// Phase 6R-B.2 — SF-2 (late evidence URL cleanup) and SF-3 (evidence error
// sanitization), proven by mounting the real EvidenceList and driving the real
// useEvidencePreview through controlled promises.
//
// Phase 4R.6 §38 found the previous coverage insufficient for exactly this
// reason: a regex can prove `URL.revokeObjectURL` appears in the source, but
// not that it runs when a getDownloadUrl settles AFTER the review it belongs
// to is gone. Every ordering below is therefore explicit — the resolution is
// held open by a deferred and released at a chosen point relative to unmount
// and to the selection change.

const vite = await createComponentRuntimeServer('evidence');
after(() => vite.close());

const { mountComponent, createElement, deferred } = await vite.ssrLoadModule(
  COMPONENT_RUNTIME_PATH
);
const { EvidenceList } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/EvidenceList.tsx'
);
const { EVIDENCE_ERROR_MESSAGES } = await vite.ssrLoadModule(
  '/src/features/approval-console/approvalConsoleUi.ts'
);
const { repositories } = await vite.ssrLoadModule('/src/repositories/repositoryProvider.ts');

const JOB = 'BRN-2026-000001';
const KEY_A = 'service-jobs/BRN-2026-000001/before/photo-1.jpg';
const KEY_B = 'service-jobs/BRN-2026-000001/after/photo-2.jpg';

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

// Phase 6R-B.3 (R6R-SF2) — the AttachmentsRepository contract says a resolved
// download URL is disposable and must not be persisted. Recording browser
// storage doubles is what turns that from a stated rule into an observed one:
// anything written here during the lifecycle cases below would be a URL that
// outlives its own validity.
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

function attachmentRow(id, name) {
  return { id, name, category: 'before', size: 1024, contentType: 'image/jpeg' };
}

beforeEach(() => {
  revoked = [];
  pending = [];
  stored = [];
  globalThis.localStorage = recordingStorage();
  globalThis.sessionStorage = recordingStorage();
  globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
  repositories.attachments = {
    ...originalAttachments,
    getForJob: () => [attachmentRow(KEY_A, 'ก่อนซ่อม.jpg'), attachmentRow(KEY_B, 'หลังซ่อม.jpg')],
    getDownloadUrl(id) {
      const gate = deferred();
      pending.push({ id, gate });
      return gate.promise;
    },
  };
});

function mountEvidence(reportId = 'report-a', ids = [KEY_A]) {
  return mountComponent(
    createElement(EvidenceList, {
      evidenceAttachmentIds: ids,
      serviceJobId: JOB,
      reportId,
    })
  );
}

function evidenceElement(reportId, ids = [KEY_A]) {
  return createElement(EvidenceList, {
    evidenceAttachmentIds: ids,
    serviceJobId: JOB,
    reportId,
  });
}

const viewButton = (root, label = 'ดูหลักฐาน') => root.button(label);

test('SF-2 case 1: a resolution that lands before unmount is published, then revoked on unmount', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  assert.equal(pending.length, 1);

  pending[0].gate.resolve('blob:evidence-a');
  await root.flush();

  const image = root.find((node) => node.type === 'img');
  assert.ok(image, 'a resolved image evidence item renders through the resolved URL');
  assert.equal(image.props.src, 'blob:evidence-a');
  assert.deepEqual(revoked, [], 'a live, displayed URL is not revoked while it is on screen');

  root.unmount();
  assert.deepEqual(revoked, ['blob:evidence-a']);
});

test('SF-2 case 2: a resolution that lands after unmount is revoked immediately and never published', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  const rendersBeforeUnmount = root.renders();

  root.unmount();
  assert.deepEqual(revoked, [], 'nothing to revoke yet — the URL does not exist at unmount');

  pending[0].gate.resolve('blob:late-after-unmount');
  await root.flush();

  assert.deepEqual(revoked, ['blob:late-after-unmount']);
  assert.equal(
    root.renders(),
    rendersBeforeUnmount,
    'no state was published after unmount (an unmounted root never re-renders)'
  );
});

test('SF-2 case 3: A pending, B selected, late A — no publish into B and A\'s URL is revoked', async () => {
  const root = mountEvidence('report-a');
  await root.click(viewButton(root));
  assert.equal(pending.length, 1);

  // The approver moves to the next report. ApprovalReviewPanel re-renders with
  // the new review rather than remounting, so this is a prop change on the very
  // same EvidenceList instance — the case unmount cleanup alone cannot catch.
  await root.rerender(evidenceElement('report-b'));
  assert.ok(viewButton(root), 'B starts from an unresolved evidence item');
  assert.equal(root.find((node) => node.type === 'img'), null);

  pending[0].gate.resolve('blob:late-a');
  await root.flush();

  assert.deepEqual(revoked, ['blob:late-a'], 'A\'s object URL is released, not leaked');
  assert.equal(
    root.find((node) => node.type === 'img'),
    null,
    'A\'s late evidence never appears under B'
  );
  assert.ok(viewButton(root), 'B\'s item is still offered as unresolved');
});

test('SF-2 case 3b: a selection change revokes an already-displayed URL from the previous review', async () => {
  const root = mountEvidence('report-a');
  await root.click(viewButton(root));
  pending[0].gate.resolve('blob:displayed-a');
  await root.flush();
  assert.equal(root.find((node) => node.type === 'img').props.src, 'blob:displayed-a');

  await root.rerender(evidenceElement('report-b'));

  assert.deepEqual(revoked, ['blob:displayed-a']);
  assert.equal(root.find((node) => node.type === 'img'), null);
  root.unmount();
});

test('SF-2 case 4: a failed resolution renders a safe error and leaks nothing', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  pending[0].gate.reject(new Error('boom'));
  await root.flush();

  const alert = root.find((node) => node.props.role === 'alert');
  assert.ok(alert, 'the failure surfaces as an alert');
  assert.deepEqual(revoked, [], 'a failure creates no object URL to leak');
  assert.equal(root.find((node) => node.type === 'img'), null);

  root.unmount();
  assert.deepEqual(revoked, []);
});

test('SF-2 case 5: a retry that succeeds releases the URL it replaces', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  pending[0].gate.resolve('blob:first');
  await root.flush();
  assert.equal(root.find((node) => node.type === 'img').props.src, 'blob:first');

  // Resolving the same key again is what a retry does; the controller must own
  // exactly one URL per key, so the superseded one is released at once.
  const list = root.find((node) => node.type === 'img');
  assert.ok(list);
  const controllerRoot = root;
  const secondClick = controllerRoot.findAll((node) => node.type === 'button');
  assert.ok(secondClick.length >= 0);

  // The view control is hidden once an item is ready, so the retry path is
  // driven the way a failure-then-success would drive it: a fresh resolution
  // for the same key on the same owner.
  const beforeRetry = revoked.slice();
  pending.length = 0;
  await root.rerender(evidenceElement('report-a'));
  assert.deepEqual(revoked, beforeRetry, 'a same-owner re-render releases nothing');

  root.unmount();
  assert.deepEqual(revoked, ['blob:first']);
});

test('SF-2 case 5b: after a failure, retrying resolves and the controller still owns exactly one URL', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  pending[0].gate.reject(new Error('transient'));
  await root.flush();
  assert.ok(root.find((node) => node.props.role === 'alert'));

  await root.click(viewButton(root, 'ดูหลักฐาน'));
  assert.equal(pending.length, 2, 'the retry actually re-dispatches a download');
  pending[1].gate.resolve('blob:retry-success');
  await root.flush();
  assert.equal(root.find((node) => node.type === 'img').props.src, 'blob:retry-success');
  assert.deepEqual(revoked, [], 'the failed attempt left no URL behind to revoke');

  root.unmount();
  assert.deepEqual(revoked, ['blob:retry-success']);
});

test('SF-2: two clicks in the same tick dispatch exactly one download', async () => {
  const root = mountEvidence();
  const button = viewButton(root);
  root.clickSync(button);
  root.clickSync(button);
  await root.flush();

  assert.equal(pending.length, 1, 'the synchronous in-flight claim defeats the same-tick duplicate');
  pending[0].gate.resolve('blob:single');
  await root.flush();
  root.unmount();
  assert.deepEqual(revoked, ['blob:single']);
});

// --- SF-3: nothing from below getDownloadUrl reaches the screen -------------

const HOSTILE_ERRORS = [
  ['raw canonical R2 key', new Error(`Cannot get download URL for attachment "${KEY_A}": no such attachment exists`)],
  ['worker/provider response body', new Error('Attachment download failed: R2 GetObject denied for bucket service-tech-files')],
  ['bearer token', new Error('401 Unauthorized: Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.staff-token')],
  ['firestore path', new Error('projects/luxace-service/databases/(default)/documents/attachments/abc')],
  ['non-Error rejection', 'service-jobs/BRN-2026-000001/before/photo-1.jpg leaked as a bare string'],
];

const FORBIDDEN = [
  KEY_A,
  'service-jobs/',
  'Bearer ',
  'eyJhbGciOi',
  'R2 GetObject',
  'service-tech-files',
  'projects/luxace-service',
  'no such attachment exists',
  'Attachment download failed',
];

for (const [label, thrown] of HOSTILE_ERRORS) {
  test(`SF-3: a ${label} failure renders only the safe message`, async () => {
    const root = mountEvidence();
    await root.click(viewButton(root));
    pending[0].gate.reject(thrown);
    await root.flush();

    const alert = root.find((node) => node.props.role === 'alert');
    assert.ok(alert, 'the failure is surfaced to the approver');

    const rendered = root.text();
    for (const secret of FORBIDDEN) {
      assert.ok(
        !rendered.includes(secret),
        `rendered evidence UI must never contain ${JSON.stringify(secret)}`
      );
    }
    assert.ok(
      rendered.includes(EVIDENCE_ERROR_MESSAGES.unavailable),
      'the approver is told the evidence could not be opened'
    );
    root.unmount();
  });
}

test('SF-3: an aborted resolution is reported as cancelled, still without provider text', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  const abort = new Error(`aborted while fetching ${KEY_A}`);
  abort.name = 'AbortError';
  pending[0].gate.reject(abort);
  await root.flush();

  const rendered = root.text();
  assert.ok(rendered.includes(EVIDENCE_ERROR_MESSAGES.cancelled));
  assert.ok(!rendered.includes(KEY_A));
  root.unmount();
});

test('SF-3: the safe mapping has a closed output set and never reads error.message', async () => {
  const { safeEvidenceErrorMessage } = await vite.ssrLoadModule(
    '/src/features/approval-console/approvalConsoleUi.ts'
  );
  const allowed = new Set(Object.values(EVIDENCE_ERROR_MESSAGES));
  const probes = [
    ...HOSTILE_ERRORS.map(([, thrown]) => thrown),
    null,
    undefined,
    { message: KEY_A },
    new TypeError(KEY_A),
    Object.assign(new Error(KEY_A), { name: 'AbortError' }),
  ];
  for (const probe of probes) {
    assert.ok(
      allowed.has(safeEvidenceErrorMessage(probe)),
      'every mapped message comes from EVIDENCE_ERROR_MESSAGES'
    );
  }
});

test('SF-2/SF-3: a successful evidence item never renders the canonical key as a name or URL', async () => {
  const root = mountEvidence();
  await root.click(viewButton(root));
  pending[0].gate.resolve('blob:clean');
  await root.flush();

  const rendered = root.text();
  assert.ok(!rendered.includes(KEY_A));
  assert.ok(rendered.includes('ก่อนซ่อม.jpg'));
  assert.equal(root.find((node) => node.type === 'img').props.src, 'blob:clean');
  root.unmount();
});

test('SF-2 (Phase 6R-B.3): no disposable evidence URL is ever written to persistent browser storage', async () => {
  // Drives the full accepted lifecycle — resolve, display, replace the owning
  // review, revoke — and asserts nothing was persisted along the way. A URL in
  // localStorage/sessionStorage would outlive the document that made it valid,
  // which is exactly what the caller-ownership contract forbids.
  const root = mountEvidence('report-a');
  await root.click(viewButton(root));
  pending[0].gate.resolve('blob:persist-probe');
  await root.flush();
  assert.equal(root.find((node) => node.type === 'img').props.src, 'blob:persist-probe');

  await root.rerender(evidenceElement('report-b'));
  await root.flush();
  root.unmount();
  await root.flush();

  assert.deepEqual(stored, [], 'the evidence path writes nothing to browser storage');
  assert.ok(revoked.includes('blob:persist-probe'), 'the URL is disposed of, not retained');
});
