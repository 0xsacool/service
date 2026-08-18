import type { ServiceJob } from '../types';

// F5d-69 / DECISIONS.md #041 — canonical customer-level channel storage does
// not exist (#013 remains only partially implemented); a customer's contact
// history is derived in memory from their own real Service Jobs, never
// fabricated and never written back to a customer document. Shared by the
// New Service Job intake prefill (deterministic "most recent known channel")
// and Universal Search's projection ("most recent non-null contact
// channel"), so the one ordering rule neither can drift from the other:
// createdAt DESC, then job id DESC as a deterministic tiebreak for same-day
// jobs (createdAt is a plain YYYY-MM-DD date with no time component — see
// bangkokTime.ts — so two jobs opened the same day compare equal on
// createdAt alone). Never depends on array/cache iteration order.
export function compareServiceJobsByRecency(a: ServiceJob, b: ServiceJob): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

// `jobs` must already be scoped to one customer (e.g. pre-filtered by
// canonical phone) — this function does no customer matching of its own.
export function mostRecentJobWithContactChannel(jobs: ServiceJob[]): ServiceJob | null {
  let best: ServiceJob | null = null;
  for (const job of jobs) {
    if (!job.contactChannel) continue;
    if (!best || compareServiceJobsByRecency(job, best) < 0) best = job;
  }
  return best;
}
