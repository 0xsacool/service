import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-66 Phase 2B-R — root cause: firestoreServiceReportsRepository.ts's
// createDraft() generated a fresh crypto.randomUUID() on every invocation,
// so a caller retry of the same logical attempt (after a lost/unknown
// network outcome) never reused the original Idempotency-Key, defeating
// the Worker's own serviceReportDraftKeys replay lookup.
//
// F5d-66 Phase 2B-R2 — the Phase 2B-R fix tracked only "is a key pending,"
// not which Service Job it belonged to. A single useServiceReports() hook
// instance persists for the lifetime of its mounted component, and React
// does not guarantee that component is remounted every time its
// serviceJobId prop changes (e.g. client-side navigation between two
// Service Job Details views reusing the same component instance). Without
// binding the pending key to its owning serviceJobId, a key allocated for
// Job A could leak into a create-draft call for Job B. This file proves
// the fix directly — no React rendering harness is available or needed,
// since the key lifecycle lives in a framework-independent controller.

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { createServiceReportDraftAttemptKeyController } = await vite.ssrLoadModule(
  '/src/hooks/serviceReportDraftAttemptKey.ts'
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_A = 'BRN-2026-000001';
const JOB_B = 'JLC-2026-000002';

test('the first logical attempt lazily generates a real UUIDv4 key', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const key = controller.get(JOB_A);
  assert.match(key, UUID_V4);
});

test('calling get() again for the same serviceJobId before the attempt concludes returns exactly the same key', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const first = controller.get(JOB_A);
  const second = controller.get(JOB_A);
  const third = controller.get(JOB_A);
  assert.equal(second, first);
  assert.equal(third, first);
});

test('a network/unknown-outcome failure (no status) retains the pending key for retry on the same job', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const first = controller.get(JOB_A);
  controller.onFailure(JOB_A, undefined);
  const retry = controller.get(JOB_A);
  assert.equal(retry, first);
});

test('a 500 (unknown server-side outcome) retains the pending key for retry on the same job', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const first = controller.get(JOB_A);
  controller.onFailure(JOB_A, 500);
  const retry = controller.get(JOB_A);
  assert.equal(retry, first);
});

test('conclusive rejections (400/401/403/409) clear the pending key for that job', () => {
  for (const status of [400, 401, 403, 409]) {
    const controller = createServiceReportDraftAttemptKeyController();
    const first = controller.get(JOB_A);
    controller.onFailure(JOB_A, status);
    const next = controller.get(JOB_A);
    assert.notEqual(next, first, `status ${status} should have cleared the pending key`);
  }
});

test('a successful completion clears the pending attempt key for that job', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const first = controller.get(JOB_A);
  controller.onSuccess(JOB_A);
  const next = controller.get(JOB_A);
  assert.notEqual(next, first);
});

// --- F5d-66 Phase 2B-R2 required scenarios ---

test('1. Job A gets a real key', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const keyA = controller.get(JOB_A);
  assert.match(keyA, UUID_V4);
});

test('2. an ambiguous (network/unknown) failure preserves the key for Job A', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const keyA = controller.get(JOB_A);
  controller.onFailure(JOB_A, undefined);
  assert.equal(controller.get(JOB_A), keyA);
});

test('3. the same controller then switching to Job B gets a different key than Job A, even though Job A never explicitly concluded', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const keyA = controller.get(JOB_A);
  controller.onFailure(JOB_A, undefined); // ambiguous — A's key would normally be retained
  const keyB = controller.get(JOB_B); // switching jobs on the same controller instance
  assert.notEqual(keyB, keyA);
  assert.match(keyB, UUID_V4);
});

test('4. returning to Job A after switching to Job B does not resurrect the old pending key', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const keyA1 = controller.get(JOB_A);
  controller.onFailure(JOB_A, undefined); // A left pending/ambiguous
  controller.get(JOB_B); // switch away — synchronously discards A's pending state
  const keyA2 = controller.get(JOB_A); // back to A
  assert.notEqual(
    keyA2,
    keyA1,
    'switching away and back must start a fresh attempt for A, not resurrect the original key'
  );
});

test('switching jobs synchronously discards the previous pending attempt, not merely on next tick or via cleanup', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  controller.get(JOB_A);
  // No await, no microtask, no effect cleanup — get() for a different job
  // must discard/replace synchronously, in the same call.
  const keyB = controller.get(JOB_B);
  const keyBAgain = controller.get(JOB_B);
  assert.equal(keyBAgain, keyB, 'Job B must now own the single pending slot immediately');
});

test('a stale onSuccess() for an already-superseded job does not clear the newer job\'s pending key', () => {
  // Simulates: Job A's request is in flight, the caller switches to Job B
  // before A's response arrives, and A's request *then* resolves
  // successfully. The stale resolution must not wipe out B's now-current
  // pending attempt.
  const controller = createServiceReportDraftAttemptKeyController();
  controller.get(JOB_A);
  const keyB = controller.get(JOB_B);
  controller.onSuccess(JOB_A); // stale — A is no longer the pending job
  assert.equal(controller.get(JOB_B), keyB);
});

test('a stale onFailure() for an already-superseded job does not clear the newer job\'s pending key', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  controller.get(JOB_A);
  const keyB = controller.get(JOB_B);
  controller.onFailure(JOB_A, 409); // stale conclusive failure for the superseded job A
  assert.equal(controller.get(JOB_B), keyB, "B's pending key must be untouched by A's stale outcome");
});

test('a full transport-retry-then-success sequence for one job: reuse, then reuse, then clear', () => {
  const controller = createServiceReportDraftAttemptKeyController();
  const attempt = controller.get(JOB_A);
  controller.onFailure(JOB_A, undefined); // simulated network failure
  assert.equal(controller.get(JOB_A), attempt); // retry 1 reuses
  controller.onFailure(JOB_A, 500); // simulated ambiguous server error
  assert.equal(controller.get(JOB_A), attempt); // retry 2 still reuses
  controller.onSuccess(JOB_A); // the retry finally lands
  const nextLogicalAttempt = controller.get(JOB_A);
  assert.notEqual(nextLogicalAttempt, attempt);
});

test('two independent controller instances (simulating two different hook mounts) never share pending-key state', () => {
  const controllerX = createServiceReportDraftAttemptKeyController();
  const controllerY = createServiceReportDraftAttemptKeyController();

  const keyX = controllerX.get(JOB_A);
  const keyY = controllerY.get(JOB_A);
  assert.notEqual(keyX, keyY);

  controllerX.onFailure(JOB_A, 409);
  assert.equal(controllerY.get(JOB_A), keyY);
});

test('a caller-supplied key generator is honored (proves get() never bypasses it)', () => {
  let calls = 0;
  const controller = createServiceReportDraftAttemptKeyController(() => `fixed-key-${++calls}`);
  const first = controller.get(JOB_A);
  const second = controller.get(JOB_A);
  assert.equal(first, 'fixed-key-1');
  assert.equal(second, 'fixed-key-1');
  assert.equal(calls, 1);
  controller.onSuccess(JOB_A);
  const third = controller.get(JOB_A);
  assert.equal(third, 'fixed-key-2');
  assert.equal(calls, 2);
});
