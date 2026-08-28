import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

// Every SSR module load happens here, before any test is registered: a
// top-level await further down the file would race the after() hook that
// closes the Vite runner once the registered tests finish.
const {
  appendUniqueApprovalItems,
  approvalQueueCacheKey,
  normalizeApprovalQueueRequest,
  ApprovalDecisionGuardError,
  evaluateApprovalDecisionGuard,
} = await vite.ssrLoadModule('/src/hooks/useApprovalConsoleReads.ts');

const { projectHistoryState } = await vite.ssrLoadModule('/src/hooks/useServiceReports.ts');

test('report-number queue identity is normalized before caching', () => {
  const first = { mode: 'report-number', reportNo: ' fr-2026-000001 ', pageSize: 25 };
  const second = { mode: 'report-number', reportNo: 'FR-2026-000001', pageSize: 25 };
  assert.equal(approvalQueueCacheKey(first), approvalQueueCacheKey(second));
  assert.equal(normalizeApprovalQueueRequest(first).reportNo, 'FR-2026-000001');
});

test('tracking-reference identity trims but preserves case', () => {
  const normalized = normalizeApprovalQueueRequest({
    mode: 'tracking-reference',
    trackingReference: ' AbC_123 ',
  });
  assert.equal(normalized.trackingReference, 'AbC_123');
  assert.notEqual(
    approvalQueueCacheKey(normalized),
    approvalQueueCacheKey({
      mode: 'tracking-reference',
      trackingReference: 'abc_123',
    })
  );
});

test('mode, page size, and cursor are independent cache dimensions', () => {
  const base = approvalQueueCacheKey({ mode: 'queue' });
  assert.notEqual(base, approvalQueueCacheKey({ mode: 'queue', pageSize: 50 }));
  assert.notEqual(base, approvalQueueCacheKey({ mode: 'queue', cursor: 'cursor-a' }));
  assert.notEqual(
    approvalQueueCacheKey({ mode: 'report-number', reportNo: 'FR-2026-000001' }),
    approvalQueueCacheKey({
      mode: 'tracking-reference',
      trackingReference: 'FR-2026-000001',
    })
  );
});

test('page append preserves documentary order and drops duplicate report identities', () => {
  const item = (reportId) => ({ reportId });
  assert.deepEqual(
    appendUniqueApprovalItems(
      [item('report-a'), item('report-b')],
      [item('report-b'), item('report-c'), item('report-c')]
    ).map((entry) => entry.reportId),
    ['report-a', 'report-b', 'report-c']
  );
});

const JOB = 'BRN-2026-000001';
const REPORT = 'report-a';
const DIGEST = `sha256:v1:${'0'.repeat(64)}`;

function guardInput(overrides = {}) {
  return {
    review: {
      serviceJobId: JOB,
      reportId: REPORT,
      approvalState: 'pending',
      finalContentDigest: DIGEST,
    },
    requestedServiceJobId: JOB,
    requestedReportId: REPORT,
    isLoading: false,
    isStale: false,
    isDeciding: false,
    loadedGeneration: 4,
    currentGeneration: 4,
    decision: 'approved',
    rejectionReason: null,
    ...overrides,
  };
}

test('D25 guard admits only a loaded, current, pending, identity-matched review', () => {
  assert.equal(evaluateApprovalDecisionGuard(guardInput()), null);
  assert.equal(
    evaluateApprovalDecisionGuard(
      guardInput({ decision: 'rejected', rejectionReason: 'ไม่ผ่านการตรวจ' })
    ),
    null
  );
});

test('D25 guard refuses every unbound or superseded review state', () => {
  const cases = [
    ['review-missing', { review: null }],
    ['review-loading', { isLoading: true }],
    ['review-stale', { isStale: true }],
    ['review-superseded', { loadedGeneration: 3, currentGeneration: 4 }],
    ['decision-in-flight', { isDeciding: true }],
    ['review-not-pending', { review: { serviceJobId: JOB, reportId: REPORT, approvalState: 'approved', finalContentDigest: DIGEST } }],
    ['review-not-pending', { review: { serviceJobId: JOB, reportId: REPORT, approvalState: 'rejected', finalContentDigest: DIGEST } }],
    ['review-identity-mismatch', { requestedReportId: 'report-other' }],
    ['review-identity-mismatch', { requestedServiceJobId: 'BRN-2026-000999' }],
    ['decision-invalid', { decision: 'maybe' }],
    ['rejection-reason-required', { decision: 'rejected', rejectionReason: null }],
    ['rejection-reason-required', { decision: 'rejected', rejectionReason: '   ' }],
    ['rejection-reason-not-allowed', { decision: 'approved', rejectionReason: 'unexpected' }],
  ];
  for (const [expected, overrides] of cases) {
    assert.equal(
      evaluateApprovalDecisionGuard(guardInput(overrides)),
      expected,
      `expected ${expected} for ${JSON.stringify(overrides)}`
    );
  }
});

test('D25 guard refusal precedes identity and decision checks when the review is unusable', () => {
  // A stale review for the WRONG report must refuse on staleness, never fall
  // through to a check that could pass.
  assert.equal(
    evaluateApprovalDecisionGuard(guardInput({ isStale: true, requestedReportId: 'other' })),
    'review-stale'
  );
  assert.equal(
    evaluateApprovalDecisionGuard(guardInput({ review: null, decision: 'maybe' })),
    'review-missing'
  );
});

test('the guard error carries a stable machine-readable reason for the UI', () => {
  const error = new ApprovalDecisionGuardError('review-stale');
  assert.equal(error.reason, 'review-stale');
  assert.equal(error.name, 'ApprovalDecisionGuardError');
  assert.ok(error instanceof Error);
});

// ---------------------------------------------------------------------------
// Phase 6R-A.1 — D24 browser lifecycle behavior (Phase 4R.5 Finding 5)
// ---------------------------------------------------------------------------

test('D24: a late response for job A can never present as job B state', () => {
  // Job A resolved (loaded A, stale, errored). The component is now on job B.
  const staleError = new Error('job A refresh failed');
  const projected = projectHistoryState({
    requestedServiceJobId: 'job-B',
    loadedServiceJobId: 'job-A',
    isLoading: false,
    isStale: true,
    error: staleError,
  });
  assert.equal(projected.isHistoryLoading, true, 'job B still reads as loading');
  assert.equal(projected.isHistoryStale, false, "job A's staleness must not leak to B");
  assert.equal(projected.historyError, null, "job A's error must not leak to B");
});

test('D24: state is only surfaced once the loaded job matches the requested job', () => {
  const error = new Error('history refresh failed');
  const matched = projectHistoryState({
    requestedServiceJobId: 'job-A',
    loadedServiceJobId: 'job-A',
    isLoading: false,
    isStale: true,
    error,
  });
  assert.equal(matched.isHistoryLoading, false);
  assert.equal(matched.isHistoryStale, true);
  assert.equal(matched.historyError, error);

  const never = projectHistoryState({
    requestedServiceJobId: 'job-A',
    loadedServiceJobId: null,
    isLoading: false,
    isStale: false,
    error: null,
  });
  assert.equal(never.isHistoryLoading, true, 'a job never loaded reads as loading');
});

test('D24: a failed authoritative refetch is stale and errored, never silently current', () => {
  const error = new Error('authoritative refetch failed');
  const projected = projectHistoryState({
    requestedServiceJobId: 'job-A',
    loadedServiceJobId: 'job-A',
    isLoading: false,
    isStale: true,
    error,
  });
  assert.equal(projected.isHistoryStale, true);
  assert.notEqual(projected.historyError, null);
  assert.equal(
    projected.isHistoryStale && projected.historyError !== null,
    true,
    'a failed refetch must be visibly represented, not indistinguishable from fresh data'
  );
});

test('D24: a successful refresh clears both stale and error', () => {
  const projected = projectHistoryState({
    requestedServiceJobId: 'job-A',
    loadedServiceJobId: 'job-A',
    isLoading: false,
    isStale: false,
    error: null,
  });
  assert.deepEqual(projected, {
    isHistoryLoading: false,
    isHistoryStale: false,
    historyError: null,
  });
});
