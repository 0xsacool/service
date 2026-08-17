// F5d-66 Phase 2B-R — the create-draft Idempotency-Key lifecycle, extracted
// out of useServiceReports.ts as a small, framework-independent state
// machine so it can be unit-tested directly (this project has no React
// hook-rendering test harness — see test/f5d66ServiceReportDraftAttemptKey.
// test.mjs) rather than only proven by source-text inspection.
//
// F5d-66 Phase 2B-R2 — a single useServiceReports() hook instance is
// created once per mounted component (useRef), but React does not
// guarantee that component stays mounted for exactly one serviceJobId: the
// same component instance can be reused across a serviceJobId prop change
// (e.g. client-side route navigation between two Service Job Details pages
// that doesn't happen to remount the component). A controller that only
// tracked "is a key pending" without recording *which* Service Job it
// belongs to would incorrectly let a pending key allocated for Job A leak
// into a create-draft call for Job B. Every method now takes the calling
// serviceJobId explicitly and the controller stores {serviceJobId, key}
// together — the fix holds regardless of remount behavior, since it's
// re-checked on every call rather than assumed from component lifecycle.
//
// Ownership: a controller instance belongs to exactly one useServiceReports
// hook instance (created once via useRef). Never module-global.
//
// Lifecycle: one key per logical create-draft attempt, scoped to one
// serviceJobId. get(serviceJobId) lazily generates a key only if none is
// pending *for that exact serviceJobId*; a call for a different
// serviceJobId synchronously discards whatever was pending and starts a
// fresh attempt for the new job — never resurrected later just by calling
// get() with the original serviceJobId again. onSuccess()/onFailure() only
// mutate state if the pending attempt still belongs to the serviceJobId
// they were called with, guarding against a stale async response (from a
// request issued before the caller switched jobs) clearing or misreading
// a different job's now-current pending attempt.
const CONCLUSIVE_CREATE_DRAFT_STATUSES = new Set([400, 401, 403, 409]);

export interface ServiceReportDraftAttemptKeyController {
  get(serviceJobId: string): string;
  onSuccess(serviceJobId: string): void;
  onFailure(serviceJobId: string, status: number | undefined): void;
}

interface PendingAttempt {
  serviceJobId: string;
  key: string;
}

export function createServiceReportDraftAttemptKeyController(
  generateKey: () => string = () => crypto.randomUUID()
): ServiceReportDraftAttemptKeyController {
  let pending: PendingAttempt | null = null;
  return {
    get(serviceJobId) {
      if (!pending || pending.serviceJobId !== serviceJobId) {
        pending = { serviceJobId, key: generateKey() };
      }
      return pending.key;
    },
    onSuccess(serviceJobId) {
      if (pending && pending.serviceJobId === serviceJobId) {
        pending = null;
      }
    },
    onFailure(serviceJobId, status) {
      if (
        pending &&
        pending.serviceJobId === serviceJobId &&
        status !== undefined &&
        CONCLUSIVE_CREATE_DRAFT_STATUSES.has(status)
      ) {
        pending = null;
      }
    },
  };
}
