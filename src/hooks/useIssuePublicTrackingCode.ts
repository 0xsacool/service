import type { ServiceJob } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseIssuePublicTrackingCodeResult {
  issuePublicTrackingCode: (id: string) => Promise<{ code: string; job: ServiceJob }>;
  // F5d-69G Phase 2-FIX — read the job's CURRENT persisted state on demand.
  // Used only after an ambiguous issuance failure, so staff can be shown the
  // truthful difference between "still inactive" and "active but the secret
  // was never delivered". Deliberately a function called at the moment it is
  // needed rather than a value captured at render time, so it can never
  // return a stale pre-issuance snapshot.
  readServiceJob: (id: string) => ServiceJob | undefined;
}

// F5d-69G — the only path to staff-triggered issue/rotate, matching every
// other data-access hook's business-logic/persistence split (DECISIONS.md
// #006). Public tracking issuance is deliberately NOT part of Service Job
// creation: the SRV code is a one-way bearer secret, and issuing it inside an
// idempotent create leaves it committed-but-unknowable if that response is
// lost. Keeping issuance explicit means a lost response is always recoverable
// by rotating again, with no plaintext ever stored anywhere.
export function useIssuePublicTrackingCode(): UseIssuePublicTrackingCodeResult {
  const issuePublicTrackingCode = async (id: string) => {
    return await repositories.serviceJobs.issuePublicTrackingCode(id);
  };

  const readServiceJob = (id: string) => repositories.serviceJobs.getById(id);

  return { issuePublicTrackingCode, readServiceJob };
}
