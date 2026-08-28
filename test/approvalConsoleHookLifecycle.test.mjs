import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Phase 6R-A.2 — D24/D25 browser lifecycle behavior (Phase 4R.5R Finding 2).
//
// These are behavioral tests: the real, unmodified useServiceReports,
// useApprovalQueue, and useApprovalReview are mounted and driven through real
// effects, real re-renders, real promises, and real AbortControllers. Nothing
// here asserts on source text, and nothing here re-implements the hooks' logic.
//
// The seam: `react` is aliased to test/support/hookRuntime.mjs, a minimal hooks
// dispatcher. That file documents what it is and is not. The repositories under
// test are injected by assigning onto the live `repositories` object, so the
// hooks reach them through their ordinary import.

const RUNTIME = fileURLToPath(new URL('./support/hookRuntime.mjs', import.meta.url));

class VisibilityDocument extends EventTarget {
  constructor() {
    super();
    this.visibilityState = 'visible';
  }
}

globalThis.window = new EventTarget();
globalThis.document = new VisibilityDocument();

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { react: RUNTIME } },
  // Nothing in this suite is served to a browser; leaving discovery on makes
  // the client dependency optimizer chase react/jsx-runtime through the alias.
  optimizeDeps: { noDiscovery: true, include: [] },
  // This suite is the only one that alters the Vite config, so it must not
  // share node_modules/.vite with the rest: root node --test runs test files
  // concurrently, and a config-triggered re-optimize would delete the shared
  // dep cache out from under whichever sibling suite is reading it.
  cacheDir: join(tmpdir(), 'service-approval-console-hook-runtime'),
});
after(() => vite.close());

// Every SSR module load happens up front, before any test is registered, so a
// top-level await cannot race the after() hook that closes the Vite runner.
const { deferred, mountHook } = await vite.ssrLoadModule(RUNTIME);
const { useServiceReports } = await vite.ssrLoadModule('/src/hooks/useServiceReports.ts');
const { ApprovalDecisionGuardError, useApprovalQueue, useApprovalReview } =
  await vite.ssrLoadModule('/src/hooks/useApprovalConsoleReads.ts');
const { repositories } = await vite.ssrLoadModule(
  '/src/repositories/repositoryProvider.ts'
);

const DIGEST = `sha256:v1:${'0'.repeat(64)}`;

// useServiceReports keeps a module-level history cache keyed by Service Job, so
// every test mints its own Service Job identity rather than sharing one.
let jobSeq = 0;
const nextJobId = () => `BRN-2026-${String((jobSeq += 1)).padStart(6, '0')}`;

function historyRow(id, jobId, createdAt = '2026-01-01T00:00:00.000Z') {
  return { id, serviceJobId: jobId, reportNo: 'FR-2026-000001', createdAt };
}

function reportDocument(id, jobId) {
  return {
    id,
    serviceJobId: jobId,
    reportNo: 'FR-2026-000002',
    status: 'draft',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    finalizedAt: null,
    technician: 'QA Technician',
    customerReportedProblem: 'Problem',
    inspectionFindings: '',
    serviceActions: [],
    parts: [],
    technicianRemark: '',
    resultStatus: null,
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
  };
}

function pendingReview(jobId, reportId) {
  return {
    reviewVersion: 1,
    reportId,
    serviceJobId: jobId,
    reportNo: 'FR-2026-000001',
    createdAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: '2026-02-01T00:00:00.000Z',
    approvalState: 'pending',
    predecessorReportId: null,
    createdBy: { role: 'technician', displayName: 'QA Technician' },
    finalizedBy: { role: 'technician', displayName: 'QA Technician' },
    content: {},
    snapshot: {},
    finalizedFromRevision: 1,
    finalContentDigest: DIGEST,
  };
}

// Every repository call is recorded and left pending until the test decides
// when — and whether — it settles. That is what makes late responses, aborts,
// and same-tick dispatch observable.
function installRepositories() {
  const history = [];
  const drafts = [];
  const decisions = [];
  const reviews = [];
  const queues = [];
  repositories.serviceJobs = { ...repositories.serviceJobs, getById: () => undefined };
  repositories.serviceReports = {
    ...repositories.serviceReports,
    fetchHistoryForServiceJob(serviceJobId, signal) {
      const call = { serviceJobId, signal, ...deferred() };
      history.push(call);
      return call.promise;
    },
    createDraft(serviceJobId, input, attemptKey) {
      const call = { serviceJobId, input, attemptKey, ...deferred() };
      drafts.push(call);
      return call.promise;
    },
    decideV2(reportId, decision, rejectionReason, expectedFinalDigest, idempotencyKey) {
      const call = {
        reportId,
        decision,
        rejectionReason,
        expectedFinalDigest,
        idempotencyKey,
        ...deferred(),
      };
      decisions.push(call);
      return call.promise;
    },
  };
  repositories.approvalConsole = {
    fetchApprovalReview(serviceJobId, reportId, signal) {
      const call = { serviceJobId, reportId, signal, ...deferred() };
      reviews.push(call);
      return call.promise;
    },
    fetchPendingApprovalQueue(request, signal) {
      const call = { request, signal, ...deferred() };
      queues.push(call);
      return call.promise;
    },
  };
  return { history, drafts, decisions, reviews, queues };
}

function mountHistory(jobId) {
  return mountHook((props) => useServiceReports(props.jobId), { jobId });
}

function mountReview(jobId, reportId, onDecisionCommitted = () => {}) {
  return mountHook(
    (props) => useApprovalReview(props.jobId, props.reportId, onDecisionCommitted),
    { jobId, reportId }
  );
}

// ---------------------------------------------------------------------------
// D24 — ordinary Service Report history lifecycle
// ---------------------------------------------------------------------------

test('D24: a late Job A response cannot overwrite Job B, and Job A is aborted', async () => {
  const repository = installRepositories();
  const jobA = nextJobId();
  const jobB = nextJobId();
  const host = mountHistory(jobA);
  await host.flush();
  assert.equal(repository.history.length, 1);
  assert.equal(repository.history[0].serviceJobId, jobA);

  host.rerender({ jobId: jobB });
  await host.flush();
  assert.equal(repository.history.length, 2, 'switching Service Job starts its own fetch');
  assert.equal(repository.history[1].serviceJobId, jobB);
  assert.equal(
    repository.history[0].signal.aborted,
    true,
    "Job A's request is aborted when the selection moves to Job B"
  );

  repository.history[1].resolve([historyRow('report-b', jobB)]);
  await host.flush();
  assert.deepEqual(host.result().reports.map((report) => report.id), ['report-b']);

  repository.history[0].resolve([historyRow('report-a', jobA)]);
  await host.flush();
  assert.deepEqual(
    host.result().reports.map((report) => report.id),
    ['report-b'],
    'the late Job A response must never present as Job B state'
  );
  assert.equal(host.result().isHistoryStale, false);
  assert.equal(host.result().historyError, null);
  host.unmount();
});

test('D24: a focus event triggers an authoritative refresh', async () => {
  const repository = installRepositories();
  const host = mountHistory(nextJobId());
  await host.flush();
  repository.history[0].resolve([]);
  await host.flush();
  assert.equal(repository.history.length, 1);

  globalThis.window.dispatchEvent(new Event('focus'));
  await host.flush();
  assert.equal(repository.history.length, 2, 'focus refetches authoritative history');
  host.unmount();
});

test('D24: returning to visible refreshes, staying hidden does not', async () => {
  const repository = installRepositories();
  const host = mountHistory(nextJobId());
  await host.flush();
  repository.history[0].resolve([]);
  await host.flush();

  globalThis.document.visibilityState = 'hidden';
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  await host.flush();
  assert.equal(repository.history.length, 1, 'hiding the tab must not refetch');

  globalThis.document.visibilityState = 'visible';
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  await host.flush();
  assert.equal(repository.history.length, 2, 'returning to visible refetches');
  host.unmount();
});

test('D24: manual refresh triggers an authoritative refetch', async () => {
  const repository = installRepositories();
  const host = mountHistory(nextJobId());
  await host.flush();
  repository.history[0].resolve([]);
  await host.flush();

  host.result().refresh();
  await host.flush();
  assert.equal(repository.history.length, 2);
  host.unmount();
});

test('D24: a successful mutation triggers an authoritative history refetch', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountHistory(jobId);
  await host.flush();
  repository.history[0].resolve([]);
  await host.flush();

  const created = host.result().createDraft();
  await host.flush();
  assert.equal(repository.drafts.length, 1, 'the mutation is dispatched');
  assert.equal(repository.history.length, 1, 'no refetch before the mutation settles');

  repository.drafts[0].resolve(reportDocument('report-new', jobId));
  await host.flush();
  assert.equal(
    repository.history.length,
    2,
    'the authoritative history is refetched after the mutation succeeds'
  );
  assert.equal(
    host.result().isHistoryStale,
    true,
    'the provisional row reads as stale until the refetch lands'
  );

  repository.history[1].resolve([historyRow('report-new', jobId)]);
  await host.flush();
  await created;
  assert.equal(host.result().isHistoryStale, false);
  host.unmount();
});

test('D24: a failed refetch preserves last-known data as stale and errored', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountHistory(jobId);
  await host.flush();
  repository.history[0].resolve([historyRow('report-known', jobId)]);
  await host.flush();
  assert.deepEqual(host.result().reports.map((report) => report.id), ['report-known']);

  host.result().refresh();
  await host.flush();
  repository.history[1].reject(new Error('history refresh failed'));
  await host.flush();

  const failed = host.result();
  assert.deepEqual(
    failed.reports.map((report) => report.id),
    ['report-known'],
    'last-known data is preserved, not cleared'
  );
  assert.equal(failed.isHistoryStale, true);
  assert.equal(failed.isHistoryLoading, false);
  assert.ok(failed.historyError instanceof Error);

  failed.refresh();
  await host.flush();
  repository.history[2].resolve([historyRow('report-known', jobId)]);
  await host.flush();
  const recovered = host.result();
  assert.equal(recovered.isHistoryStale, false, 'a successful refresh clears staleness');
  assert.equal(recovered.historyError, null, 'a successful refresh clears the error');
  host.unmount();
});

test('D24: unmount aborts the in-flight request and publishes no further state', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountHistory(jobId);
  await host.flush();
  const renders = host.renders();

  host.unmount();
  assert.equal(repository.history[0].signal.aborted, true, 'unmount aborts the request');

  repository.history[0].resolve([historyRow('report-late', jobId)]);
  await host.flush();
  assert.equal(host.renders(), renders, 'an obsolete response publishes no state');
});

// ---------------------------------------------------------------------------
// D25 — Approval Console read and decision lifecycle
// ---------------------------------------------------------------------------

test('D25: queue selection loads exactly the requested review', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();
  assert.equal(repository.reviews.length, 1);
  assert.equal(repository.reviews[0].serviceJobId, jobId);
  assert.equal(repository.reviews[0].reportId, 'report-one');

  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();
  assert.equal(host.result().review.reportId, 'report-one');
  assert.equal(host.result().decisionEnabled, true);
  host.unmount();
});

test('D25: changing selection invalidates the prior review, which cannot land late', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();

  host.rerender({ jobId, reportId: 'report-two' });
  await host.flush();
  assert.equal(repository.reviews.length, 2);
  assert.equal(repository.reviews[0].signal.aborted, true);
  assert.equal(host.result().review, null, 'the prior review is invalidated immediately');
  assert.equal(host.result().isLoading, true);
  assert.equal(host.result().decisionEnabled, false);

  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();
  assert.equal(
    host.result().review,
    null,
    'the late prior review must never become the current review'
  );

  repository.reviews[1].resolve(pendingReview(jobId, 'report-two'));
  await host.flush();
  assert.equal(host.result().review.reportId, 'report-two');
  host.unmount();
});

test('D25: a stale review cannot decide', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  host.result().refresh();
  await host.flush();
  repository.reviews[1].reject(new Error('review refresh failed'));
  await host.flush();

  const stale = host.result();
  assert.equal(stale.isStale, true);
  assert.equal(stale.decisionEnabled, false);
  await assert.rejects(
    stale.decide('approved', null),
    (error) =>
      error instanceof ApprovalDecisionGuardError && error.reason === 'review-stale'
  );
  assert.equal(repository.decisions.length, 0, 'a stale review dispatches no mutation');
  host.unmount();
});

test('D25: a superseded generation cannot decide after the selection moves on', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();
  // Captured while report-one was current: this is the "old in-flight decision"
  // a reviewer could still be holding when the selection moves.
  const beforeTransition = host.result();

  host.rerender({ jobId, reportId: 'report-two' });
  await host.flush();

  await assert.rejects(
    beforeTransition.decide('approved', null),
    (error) =>
      error instanceof ApprovalDecisionGuardError && error.reason === 'review-superseded'
  );
  assert.equal(
    repository.decisions.length,
    0,
    'an old generation must not authorize a decision against a new review'
  );
  host.unmount();
});

test('D25: two same-tick decisions dispatch exactly one Worker mutation', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const { decide } = host.result();
  // Both calls happen synchronously, before any re-render can observe the
  // first. React state alone cannot separate them.
  const first = decide('approved', null);
  const second = decide('approved', null);

  await assert.rejects(
    second,
    (error) =>
      error instanceof ApprovalDecisionGuardError && error.reason === 'decision-in-flight'
  );
  assert.equal(
    repository.decisions.length,
    1,
    'the second same-tick decision must dispatch no mutation'
  );
  assert.equal(repository.decisions[0].expectedFinalDigest, DIGEST);
  assert.equal(repository.decisions[0].reportId, 'report-one');

  repository.decisions[0].resolve({});
  await first;
  await host.flush();
  assert.equal(repository.decisions.length, 1);
  host.unmount();
});

test('D25: a failed mutation releases the latch and a valid retry dispatches once', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  const host = mountReview(jobId, 'report-one');
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const attempt = host.result().decide('approved', null);
  assert.equal(repository.decisions.length, 1);
  repository.decisions[0].reject(new Error('worker unavailable'));
  await assert.rejects(attempt, (error) => error.message === 'worker unavailable');
  await host.flush();

  const afterFailure = host.result();
  assert.ok(afterFailure.error instanceof Error, 'the failure is surfaced, not swallowed');
  assert.equal(afterFailure.isStale, true);
  assert.equal(afterFailure.isDeciding, false);
  // The latch released: this refusal is staleness, not a stuck in-flight claim.
  await assert.rejects(
    afterFailure.decide('approved', null),
    (error) => error.reason === 'review-stale'
  );
  assert.equal(repository.decisions.length, 1);

  afterFailure.refresh();
  await host.flush();
  repository.reviews[1].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const retry = host.result().decide('approved', null);
  assert.equal(
    repository.decisions.length,
    2,
    'a valid retry after a released latch dispatches exactly one more mutation'
  );
  repository.decisions[1].resolve({});
  await retry;
  host.unmount();
});

test('D25: a committed decision refreshes queue state and marks the review stale', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  let committed = 0;
  const host = mountReview(jobId, 'report-one', () => {
    committed += 1;
  });
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const attempt = host.result().decide('rejected', 'ไม่ผ่านการตรวจ');
  assert.equal(repository.decisions[0].decision, 'rejected');
  assert.equal(repository.decisions[0].rejectionReason, 'ไม่ผ่านการตรวจ');
  repository.decisions[0].resolve({});
  await attempt;
  await host.flush();

  assert.equal(committed, 1, 'the queue is told to refresh exactly once');
  assert.equal(host.result().isStale, true, 'the decided review is no longer authoritative');
  assert.equal(host.result().decisionEnabled, false);
  host.unmount();
});

test('D25: the queue loads its exact request and refreshes on focus and on demand', async () => {
  const repository = installRepositories();
  const host = mountHook((props) => useApprovalQueue(props.request), {
    request: { mode: 'report-number', reportNo: ' fr-2026-000001 ' },
  });
  await host.flush();
  assert.equal(repository.queues.length, 1);
  assert.equal(
    repository.queues[0].request.reportNo,
    'FR-2026-000001',
    'the queue request is normalized before it reaches the Worker'
  );

  repository.queues[0].resolve({
    queueContractVersion: 1,
    mode: 'report-number',
    normalizedSearch: 'FR-2026-000001',
    pageSize: 25,
    items: [{ queueItemVersion: 1, reportId: 'report-one' }],
    nextCursor: null,
  });
  await host.flush();
  assert.deepEqual(host.result().items.map((item) => item.reportId), ['report-one']);
  assert.equal(host.result().isLoading, false);

  globalThis.window.dispatchEvent(new Event('focus'));
  await host.flush();
  assert.equal(repository.queues.length, 2, 'focus refreshes the queue');

  repository.queues[1].reject(new Error('queue refresh failed'));
  await host.flush();
  assert.ok(host.result().error instanceof Error);
  assert.equal(host.result().isStale, true, 'the last-known page is kept, marked stale');
  assert.deepEqual(host.result().items.map((item) => item.reportId), ['report-one']);
  host.unmount();
});

// ---------------------------------------------------------------------------
// Phase 6R-B.2 (SF-4) — hasAuthoritativeData is the flag ApprovalQueueList uses
// to decide whether it may claim the queue is empty. items.length === 0 cannot
// carry that meaning, so the flag's own transitions are driven here, at the
// hook, against the real Worker-response interleavings the list can face.
// ---------------------------------------------------------------------------

test('SF-4: hasAuthoritativeData is false until a Worker page actually lands', async () => {
  const repository = installRepositories();
  const host = mountHook((props) => useApprovalQueue(props.request), {
    request: { mode: 'queue', pageSize: 25 },
  });
  await host.flush();
  assert.equal(host.result().hasAuthoritativeData, false, 'nothing has loaded yet');
  assert.equal(host.result().isLoading, true);
  assert.equal(host.result().error, null);

  repository.queues[0].resolve({
    queueContractVersion: 1,
    mode: 'queue',
    normalizedSearch: null,
    pageSize: 25,
    items: [],
    nextCursor: null,
  });
  await host.flush();
  assert.equal(
    host.result().hasAuthoritativeData,
    true,
    'an authoritatively empty page still counts as data'
  );
  assert.deepEqual(host.result().items, []);
  assert.equal(host.result().error, null);
  host.unmount();
});

test('SF-4: a failed first request leaves hasAuthoritativeData false alongside the error', async () => {
  const repository = installRepositories();
  const host = mountHook((props) => useApprovalQueue(props.request), {
    request: { mode: 'queue', pageSize: 25 },
  });
  await host.flush();
  repository.queues[0].reject(new Error('worker unavailable'));
  await host.flush();

  assert.ok(host.result().error instanceof Error);
  assert.equal(
    host.result().hasAuthoritativeData,
    false,
    'a failure never confers authority to report an empty queue'
  );
  assert.deepEqual(host.result().items, []);
  assert.equal(host.result().isStale, false, 'there is no last-known page to be stale');
  host.unmount();
});

test('SF-4: a failed refresh keeps hasAuthoritativeData true so retained items stay legitimate', async () => {
  const repository = installRepositories();
  const host = mountHook((props) => useApprovalQueue(props.request), {
    request: { mode: 'queue', pageSize: 25 },
  });
  await host.flush();
  repository.queues[0].resolve({
    queueContractVersion: 1,
    mode: 'queue',
    normalizedSearch: null,
    pageSize: 25,
    items: [{ queueItemVersion: 1, reportId: 'report-one' }],
    nextCursor: null,
  });
  await host.flush();
  assert.equal(host.result().hasAuthoritativeData, true);

  host.result().refresh();
  await host.flush();
  repository.queues[1].reject(new Error('refresh failed'));
  await host.flush();

  assert.ok(host.result().error instanceof Error);
  assert.equal(host.result().hasAuthoritativeData, true);
  assert.equal(host.result().isStale, true);
  assert.deepEqual(host.result().items.map((item) => item.reportId), ['report-one']);
  host.unmount();
});

test('SF-4: switching to a new request identity resets authority until that request lands', async () => {
  const repository = installRepositories();
  const host = mountHook((props) => useApprovalQueue(props.request), {
    request: { mode: 'queue', pageSize: 25 },
  });
  await host.flush();
  repository.queues[0].resolve({
    queueContractVersion: 1,
    mode: 'queue',
    normalizedSearch: null,
    pageSize: 25,
    items: [{ queueItemVersion: 1, reportId: 'report-one' }],
    nextCursor: null,
  });
  await host.flush();
  assert.equal(host.result().hasAuthoritativeData, true);

  host.rerender({ request: { mode: 'report-number', reportNo: 'FR-2026-000009', pageSize: 25 } });
  assert.equal(
    host.result().hasAuthoritativeData,
    false,
    'the previous request\'s page says nothing about the new one'
  );
  assert.deepEqual(host.result().items, [], 'and its items are not shown under the new identity');
  host.unmount();
});

// ---------------------------------------------------------------------------
// Phase 6R-A.3 — D25 cross-selection decision completion (Phase 4R.5R2 finding)
//
// A decision dispatched for report A can still be in flight when the reviewer
// moves to report B. Its completion owns the displayed review state only while
// the review on screen is still A's. These drive the real hook through that
// interleaving rather than asserting on the publication code.
// ---------------------------------------------------------------------------

test('D25: a late decision success cannot overwrite the newly selected review', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  let committed = 0;
  const host = mountReview(jobId, 'report-one', () => {
    committed += 1;
  });
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  // Dispatched while report-one is still current, so the guard legitimately
  // passes; the Worker promise is then held open across the selection change.
  const attempt = host.result().decide('approved', null);
  assert.equal(repository.decisions.length, 1);
  assert.equal(repository.decisions[0].reportId, 'report-one');

  host.rerender({ jobId, reportId: 'report-two' });
  await host.flush();
  repository.reviews[1].resolve(pendingReview(jobId, 'report-two'));
  await host.flush();

  const beforeCompletion = host.result();
  assert.equal(beforeCompletion.review.reportId, 'report-two');
  assert.equal(beforeCompletion.isLoading, false);

  repository.decisions[0].resolve({});
  await attempt;
  await host.flush();

  const afterCompletion = host.result();
  assert.equal(
    afterCompletion.review,
    beforeCompletion.review,
    "the newly selected review's loaded snapshot survives the older completion"
  );
  assert.equal(afterCompletion.review.reportId, 'report-two');
  assert.equal(afterCompletion.isLoading, false, 'report-two must not be reset to loading');
  assert.equal(afterCompletion.isStale, false, "report-one's staleness must not leak");
  assert.equal(afterCompletion.error, null);
  assert.equal(afterCompletion.decisionEnabled, true, 'report-two remains actionable');
  assert.equal(
    committed,
    1,
    'the committed mutation still invalidates the queue after the selection moves'
  );
  assert.equal(repository.decisions.length, 1, 'no second mutation is issued');
  host.unmount();
});

test('D25: a late decision failure cannot corrupt the newly selected review', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  let committed = 0;
  const host = mountReview(jobId, 'report-one', () => {
    committed += 1;
  });
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const attempt = host.result().decide('approved', null);
  assert.equal(repository.decisions.length, 1);

  host.rerender({ jobId, reportId: 'report-two' });
  await host.flush();
  repository.reviews[1].resolve(pendingReview(jobId, 'report-two'));
  await host.flush();
  const beforeFailure = host.result();
  assert.equal(beforeFailure.review.reportId, 'report-two');

  const failure = new Error('worker unavailable');
  repository.decisions[0].reject(failure);
  await assert.rejects(attempt, (error) => error === failure);
  await host.flush();

  const afterFailure = host.result();
  assert.equal(
    afterFailure.review,
    beforeFailure.review,
    "the older decision's failure leaves report-two's snapshot untouched"
  );
  assert.equal(afterFailure.isLoading, false);
  assert.equal(afterFailure.isStale, false);
  assert.equal(
    afterFailure.error,
    null,
    "the older decision's error must not surface as report-two's review error"
  );
  assert.equal(afterFailure.isDeciding, false);
  assert.equal(committed, 0, 'a failed decision commits nothing');

  // The latch released against its own identity, so report-two is still
  // decidable — the failure was reported only to its own caller.
  const retry = afterFailure.decide('approved', null);
  assert.equal(repository.decisions.length, 2, 'report-two remains decidable');
  assert.equal(repository.decisions[1].reportId, 'report-two');
  repository.decisions[1].resolve({});
  await retry;
  await host.flush();
  assert.equal(committed, 1);
  host.unmount();
});

test('D25: a decision completing while its own review is selected still publishes', async () => {
  const repository = installRepositories();
  const jobId = nextJobId();
  let committed = 0;
  const host = mountReview(jobId, 'report-one', () => {
    committed += 1;
  });
  await host.flush();
  repository.reviews[0].resolve(pendingReview(jobId, 'report-one'));
  await host.flush();

  const attempt = host.result().decide('approved', null);
  repository.decisions[0].resolve({});
  await attempt;
  await host.flush();

  const settled = host.result();
  assert.equal(settled.review.reportId, 'report-one', 'the decided review is retained, not emptied');
  assert.equal(settled.isStale, true, 'same-identity completion still marks the review stale');
  assert.equal(settled.isLoading, false);
  assert.equal(settled.error, null);
  assert.equal(settled.isDeciding, false);
  assert.equal(settled.decisionEnabled, false);
  assert.equal(committed, 1);
  await assert.rejects(
    settled.decide('approved', null),
    (error) =>
      error instanceof ApprovalDecisionGuardError && error.reason === 'review-stale'
  );
  assert.equal(repository.decisions.length, 1);
  host.unmount();
});
