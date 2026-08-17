import { finalizeServiceReport } from '../../src/services/serviceReport.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';
import type { ActiveDraftLock } from './serviceReportCreation.ts';

// Thrown when the report doesn't exist, or exists but under a different
// Service Job than the URL claims — the second case is treated identically
// to "not found" rather than a distinct 403/leak, matching this Worker's
// existing fail-closed convention for authorization mismatches.
export class ServiceReportNotFoundError extends Error {}
// Thrown when a report is still 'draft' but its active-draft lock is
// missing or points at a different report — a genuine data inconsistency
// (create-draft always creates the lock atomically with the report), never
// silently repaired here.
export class ActiveDraftLockInconsistentError extends Error {}
// Wraps finalizeServiceReport()'s own completeness-gate rejection (Decision
// #034) in a distinctly classifiable type so the route handler can map it
// to 400 without parsing error message text.
export class ServiceReportIncompleteError extends Error {}

export interface ServiceReportFinalizationDataAccess {
  beginTransaction(): Promise<AllocationTransaction>;
  getServiceReport(
    transaction: AllocationTransaction,
    reportId: string
  ): Promise<ServiceReport | null>;
  getActiveDraftLock(
    transaction: AllocationTransaction,
    serviceJobId: string
  ): Promise<ActiveDraftLock | null>;
  getServiceJob(transaction: AllocationTransaction, id: string): Promise<ServiceJob | null>;
  commitFinalization(
    transaction: AllocationTransaction,
    input: { serviceJobId: string; finalized: ServiceReport }
  ): Promise<void>;
}

export async function finalizeServiceReportTransaction(input: {
  serviceJobId: string;
  reportId: string;
  dataAccess: ServiceReportFinalizationDataAccess;
  now?: () => Date;
}): Promise<ServiceReport> {
  const now = input.now ?? (() => new Date());
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginTransaction();

    const report = await input.dataAccess.getServiceReport(transaction, input.reportId);
    if (!report || report.serviceJobId !== input.serviceJobId) {
      throw new ServiceReportNotFoundError(
        `Service Report "${input.reportId}" does not exist for Service Job "${input.serviceJobId}"`
      );
    }

    // Idempotent: a retried/duplicate finalize call for an already-final
    // report returns the existing final report unchanged rather than
    // erroring or attempting a second mutation.
    if (report.status === 'final') {
      return report;
    }

    const lock = await input.dataAccess.getActiveDraftLock(transaction, input.serviceJobId);
    if (!lock || lock.draftReportId !== report.id) {
      throw new ActiveDraftLockInconsistentError(
        `Active draft lock for Service Job "${input.serviceJobId}" is missing or does not match Service Report "${report.id}"`
      );
    }

    const serviceJob = await input.dataAccess.getServiceJob(transaction, input.serviceJobId);
    if (!serviceJob) {
      throw new ServiceReportNotFoundError(
        `Service Job "${input.serviceJobId}" does not exist`
      );
    }

    let finalized: ServiceReport;
    try {
      finalized = finalizeServiceReport(report, serviceJob, now());
    } catch (error) {
      throw new ServiceReportIncompleteError(
        error instanceof Error ? error.message : 'Service Report is incomplete'
      );
    }

    try {
      await input.dataAccess.commitFinalization(transaction, {
        serviceJobId: input.serviceJobId,
        finalized,
      });
      return finalized;
    } catch (error) {
      if (error instanceof TransactionConflictError && attempt + 1 < MAX_TRANSACTION_RETRIES)
        continue;
      throw error;
    }
  }
  throw new Error('Service Report finalization transaction retries exhausted');
}
