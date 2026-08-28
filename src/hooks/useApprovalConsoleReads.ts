import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repositories } from '../repositories/repositoryProvider';
import type {
  ApprovalQueueItemV1,
  ApprovalQueuePageV1,
  ApprovalQueueRequest,
  ApprovalReviewV1,
} from '../types/serviceReportWorkerReads';

export function normalizeApprovalQueueRequest(
  request: ApprovalQueueRequest
): ApprovalQueueRequest {
  if (request.mode === 'queue') return { ...request };
  if (request.mode === 'report-number') {
    return { ...request, reportNo: request.reportNo.trim().toUpperCase() };
  }
  return { ...request, trackingReference: request.trackingReference.trim() };
}

export function approvalQueueCacheKey(request: ApprovalQueueRequest): string {
  const normalized = normalizeApprovalQueueRequest(request);
  const search = normalized.mode === 'queue'
    ? null
    : normalized.mode === 'report-number'
      ? normalized.reportNo
      : normalized.trackingReference;
  return JSON.stringify([
    normalized.mode,
    search,
    normalized.pageSize ?? 25,
    normalized.cursor ?? null,
  ]);
}

function requestFromCacheKey(key: string): ApprovalQueueRequest {
  const [mode, search, pageSize, cursor] = JSON.parse(key) as [
    ApprovalQueueRequest['mode'],
    string | null,
    number,
    string | null,
  ];
  const common = {
    pageSize,
    ...(cursor === null ? {} : { cursor }),
  };
  if (mode === 'queue') return { mode, ...common };
  if (mode === 'report-number') return { mode, reportNo: search!, ...common };
  return { mode, trackingReference: search!, ...common };
}

export function appendUniqueApprovalItems(
  current: readonly ApprovalQueueItemV1[],
  incoming: readonly ApprovalQueueItemV1[]
): ApprovalQueueItemV1[] {
  const result = [...current];
  const seen = new Set(current.map((item) => item.reportId));
  for (const item of incoming) {
    if (!seen.has(item.reportId)) {
      seen.add(item.reportId);
      result.push(item);
    }
  }
  return result;
}

interface QueueSnapshot {
  key: string;
  page: ApprovalQueuePageV1 | null;
  error: Error | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isStale: boolean;
}

const emptyQueue = (key: string): QueueSnapshot => ({
  key,
  page: null,
  error: null,
  isLoading: true,
  isLoadingMore: false,
  isStale: false,
});

export interface ApprovalQueueState {
  items: readonly ApprovalQueueItemV1[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isStale: boolean;
  error: Error | null;
  // Phase 6R-B.2 (SF-4) — true only once a Worker page has actually been
  // received for the current request identity. `items.length === 0` cannot
  // distinguish "the Worker authoritatively reports nothing pending" from
  // "nothing has loaded yet, or the request failed", and rendering the empty
  // state for the latter presents a failure as a confirmed empty queue.
  hasAuthoritativeData: boolean;
  refresh(): void;
  loadMore(): void;
}

export function useApprovalQueue(request: ApprovalQueueRequest): ApprovalQueueState {
  const requestKey = approvalQueueCacheKey(request);
  const normalized = useMemo(() => requestFromCacheKey(requestKey), [requestKey]);
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(() => emptyQueue(requestKey));
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const visible = snapshot.key === requestKey ? snapshot : emptyQueue(requestKey);

  const fetchPage = useCallback(async (
    currentRequest: ApprovalQueueRequest,
    key: string,
    append: boolean,
    cursor: string | null
  ): Promise<void> => {
    activeRequest.current?.abort();
    const abort = new AbortController();
    activeRequest.current = abort;
    const run = ++generation.current;
    setSnapshot((current) => ({
      ...(current.key === key ? current : emptyQueue(key)),
      isLoading: !append,
      isLoadingMore: append,
    }));
    try {
      const nextRequest = cursor
        ? { ...currentRequest, cursor } as ApprovalQueueRequest
        : { ...currentRequest, cursor: undefined } as ApprovalQueueRequest;
      const result = await repositories.approvalConsole.fetchPendingApprovalQueue(
        nextRequest,
        abort.signal
      );
      if (run !== generation.current) return;
      setSnapshot((current) => ({
        key,
        page: append && current.key === key && current.page
          ? {
              ...result,
              items: appendUniqueApprovalItems(current.page.items, result.items),
            }
          : result,
        error: null,
        isLoading: false,
        isLoadingMore: false,
        isStale: false,
      }));
    } catch (caught) {
      if (abort.signal.aborted || run !== generation.current) return;
      setSnapshot((current) => ({
        ...(current.key === key ? current : emptyQueue(key)),
        error: caught instanceof Error ? caught : new Error('Approval queue refresh failed'),
        isLoading: false,
        isLoadingMore: false,
        isStale: current.key === key && current.page !== null,
      }));
    }
  }, []);

  useEffect(() => {
    const scheduled = queueMicrotask(() => void fetchPage(normalized, requestKey, false, normalized.cursor ?? null));
    return () => {
      void scheduled;
      generation.current += 1;
      activeRequest.current?.abort();
    };
  }, [fetchPage, normalized, requestKey]);

  useEffect(() => {
    const refresh = () => void fetchPage(normalized, requestKey, false, normalized.cursor ?? null);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [fetchPage, normalized, requestKey]);

  return {
    items: visible.page?.items ?? [],
    nextCursor: visible.page?.nextCursor ?? null,
    isLoading: visible.isLoading,
    isLoadingMore: visible.isLoadingMore,
    isStale: visible.isStale,
    error: visible.error,
    hasAuthoritativeData: visible.page !== null,
    refresh: () => void fetchPage(normalized, requestKey, false, normalized.cursor ?? null),
    loadMore: () => {
      if (visible.page?.nextCursor && !visible.isLoadingMore) {
        void fetchPage(normalized, requestKey, true, visible.page.nextCursor);
      }
    },
  };
}

export type ApprovalDecisionGuardReason =
  | 'review-missing'
  | 'review-loading'
  | 'review-stale'
  | 'review-superseded'
  | 'review-identity-mismatch'
  | 'review-not-pending'
  | 'decision-in-flight'
  | 'decision-invalid'
  | 'rejection-reason-required'
  | 'rejection-reason-not-allowed';

// D25: refused locally, before any Worker call, with a machine-readable reason
// the UI can branch on. A disabled button is a convenience, not the boundary —
// this is the boundary.
export class ApprovalDecisionGuardError extends Error {
  readonly reason: ApprovalDecisionGuardReason;

  constructor(reason: ApprovalDecisionGuardReason) {
    super(`Approval decision refused: ${reason}`);
    this.name = 'ApprovalDecisionGuardError';
    this.reason = reason;
  }
}

export interface ApprovalDecisionGuardInput {
  review: Pick<
    ApprovalReviewV1,
    'serviceJobId' | 'reportId' | 'approvalState' | 'finalContentDigest'
  > | null;
  requestedServiceJobId: string;
  requestedReportId: string;
  isLoading: boolean;
  isStale: boolean;
  isDeciding: boolean;
  loadedGeneration: number;
  currentGeneration: number;
  decision: 'approved' | 'rejected';
  rejectionReason: string | null;
}

// Extracted as a pure function (same pattern as serviceReportDraftAttemptKey)
// so the D25 decision boundary is exhaustively unit-testable without a React
// renderer, and so the rule set cannot drift from what decide() enforces.
// Returns null when the decision may proceed.
export function evaluateApprovalDecisionGuard(
  input: ApprovalDecisionGuardInput
): ApprovalDecisionGuardReason | null {
  if (!input.review) return 'review-missing';
  if (input.isLoading) return 'review-loading';
  if (input.isStale) return 'review-stale';
  if (input.loadedGeneration !== input.currentGeneration) return 'review-superseded';
  if (
    input.review.serviceJobId !== input.requestedServiceJobId ||
    input.review.reportId !== input.requestedReportId
  ) {
    return 'review-identity-mismatch';
  }
  if (input.review.approvalState !== 'pending') return 'review-not-pending';
  if (input.isDeciding) return 'decision-in-flight';
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    return 'decision-invalid';
  }
  if (input.decision === 'rejected' && (input.rejectionReason ?? '').trim().length === 0) {
    return 'rejection-reason-required';
  }
  if (input.decision === 'approved' && input.rejectionReason !== null) {
    return 'rejection-reason-not-allowed';
  }
  return null;
}

interface ReviewSnapshot {
  identity: string;
  review: ApprovalReviewV1 | null;
  error: Error | null;
  isLoading: boolean;
  isStale: boolean;
  // The fetch generation this review was loaded by. If a newer fetch has since
  // started, this no longer describes what the reviewer is looking at.
  loadedGeneration: number;
}

const emptyReview = (identity: string): ReviewSnapshot => ({
  identity,
  review: null,
  error: null,
  isLoading: true,
  isStale: false,
  loadedGeneration: -1,
});

export interface ApprovalReviewState {
  review: ApprovalReviewV1 | null;
  decisionEnabled: boolean;
  isLoading: boolean;
  isDeciding: boolean;
  isStale: boolean;
  error: Error | null;
  refresh(): void;
  decide(decision: 'approved' | 'rejected', rejectionReason: string | null): Promise<void>;
}

export function useApprovalReview(
  serviceJobId: string,
  reportId: string,
  onDecisionCommitted: () => void
): ApprovalReviewState {
  const identity = `${serviceJobId}\0${reportId}`;
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>(() => emptyReview(identity));
  const [decidingIdentity, setDecidingIdentity] = useState<string | null>(null);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  // Decision ownership is claimed synchronously, in a ref, because React state
  // cannot express it: two decide() calls in the same tick share one render
  // closure, so both would read an idle isDeciding and both would dispatch a
  // terminal Worker mutation. decidingIdentity below drives rendering only.
  const decisionInFlight = useRef<string | null>(null);
  const visible = snapshot.identity === identity ? snapshot : emptyReview(identity);
  const isDeciding = decidingIdentity === identity;

  const fetchReview = useCallback(async (
    jobId: string,
    currentReportId: string,
    currentIdentity: string
  ): Promise<void> => {
    activeRequest.current?.abort();
    const abort = new AbortController();
    activeRequest.current = abort;
    const run = ++generation.current;
    setSnapshot((current) => ({
      ...(current.identity === currentIdentity ? current : emptyReview(currentIdentity)),
      isLoading: true,
    }));
    try {
      const result = await repositories.approvalConsole.fetchApprovalReview(
        jobId,
        currentReportId,
        abort.signal
      );
      if (run !== generation.current) return;
      setSnapshot({
        identity: currentIdentity,
        review: result,
        error: null,
        isLoading: false,
        isStale: false,
        loadedGeneration: run,
      });
    } catch (caught) {
      if (abort.signal.aborted || run !== generation.current) return;
      setSnapshot((current) => ({
        ...(current.identity === currentIdentity ? current : emptyReview(currentIdentity)),
        error: caught instanceof Error ? caught : new Error('Approval review refresh failed'),
        isLoading: false,
        isStale: current.identity === currentIdentity && current.review !== null,
      }));
    }
  }, []);

  useEffect(() => {
    const scheduled = queueMicrotask(
      () => void fetchReview(serviceJobId, reportId, identity)
    );
    return () => {
      void scheduled;
      generation.current += 1;
      activeRequest.current?.abort();
    };
  }, [fetchReview, identity, reportId, serviceJobId]);

  useEffect(() => {
    const refresh = () => void fetchReview(serviceJobId, reportId, identity);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [fetchReview, identity, reportId, serviceJobId]);

  // D25 decision boundary. Every condition is checked HERE, before the Worker
  // mutation is dispatched — never delegated to a disabled control. The digest
  // is read off the displayed review; decide() takes no digest parameter, so a
  // caller cannot substitute one.
  const decide = async (
    decision: 'approved' | 'rejected',
    rejectionReason: string | null
  ): Promise<void> => {
    const review = visible.review;
    const refusal = evaluateApprovalDecisionGuard({
      review,
      requestedServiceJobId: serviceJobId,
      requestedReportId: reportId,
      isLoading: visible.isLoading,
      isStale: visible.isStale,
      isDeciding: isDeciding || decisionInFlight.current === identity,
      loadedGeneration: visible.loadedGeneration,
      currentGeneration: generation.current,
      decision,
      rejectionReason,
    });
    if (refusal !== null || review === null) {
      throw new ApprovalDecisionGuardError(refusal ?? 'review-missing');
    }
    decisionInFlight.current = identity;
    setDecidingIdentity(identity);
    try {
      await repositories.serviceReports.decideV2(
        review.reportId,
        decision,
        rejectionReason,
        review.finalContentDigest,
        crypto.randomUUID()
      );
      // D25: a completed decision owns the displayed review state only while
      // the review on screen is still the one it was dispatched for. Once the
      // reviewer has moved to another report, this completion must leave that
      // report's loaded state exactly as it found it.
      setSnapshot((current) => (
        current.identity === identity
          ? { ...current, error: null, isLoading: false, isStale: true }
          : current
      ));
      // Queue invalidation follows the committed mutation, not the selection,
      // so it still fires when the reviewer has moved on.
      onDecisionCommitted();
    } catch (caught) {
      const failure = caught instanceof Error
        ? caught
        : new Error('Approval decision failed');
      setSnapshot((current) => (
        current.identity === identity
          ? { ...current, error: failure, isStale: true }
          : current
      ));
      throw caught;
    } finally {
      // Ownership-checked so a release can never clear a latch a later identity
      // has since claimed.
      if (decisionInFlight.current === identity) decisionInFlight.current = null;
      setDecidingIdentity((current) => current === identity ? null : current);
    }
  };

  return {
    review: visible.review,
    // Derived from the same guard decide() enforces, so a control can never be
    // enabled for a decision the boundary would refuse. Probed with a valid
    // approve shape so only the non-decision-specific rules apply.
    decisionEnabled: evaluateApprovalDecisionGuard({
      review: visible.review,
      requestedServiceJobId: serviceJobId,
      requestedReportId: reportId,
      isLoading: visible.isLoading,
      isStale: visible.isStale,
      isDeciding,
      loadedGeneration: visible.loadedGeneration,
      currentGeneration: generation.current,
      decision: 'approved',
      rejectionReason: null,
    }) === null,
    isLoading: visible.isLoading,
    isDeciding,
    isStale: visible.isStale,
    error: visible.error,
    refresh: () => void fetchReview(serviceJobId, reportId, identity),
    decide,
  };
}
