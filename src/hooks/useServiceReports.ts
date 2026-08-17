import { useRef, useState } from 'react';
import type {
  ServiceReport,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import { orderServiceReports } from '../services/serviceReport';
import { repositories } from '../repositories/repositoryProvider';
import { WorkerServiceReportError } from '../repositories/types';
import { createServiceReportDraftAttemptKeyController } from './serviceReportDraftAttemptKey';

export interface UseServiceReportsResult {
  reports: ServiceReport[];
  latestReport: ServiceReport | undefined;
  activeDraft: ServiceReport | undefined;
  refresh: () => void;
  createDraft: (input?: ServiceReportDraftInput) => Promise<ServiceReport>;
  updateDraft: (
    reportId: string,
    patch: ServiceReportDraftPatch
  ) => Promise<ServiceReport>;
  finalize: (reportId: string) => Promise<ServiceReport>;
}

export function useServiceReports(serviceJobId: string): UseServiceReportsResult {
  const [, setRevision] = useState(0);
  // One controller per hook instance (useRef, never module-global). The
  // controller itself is serviceJobId-aware (Phase 2B-R2) rather than
  // relying on this hook always being remounted per Service Job — passing
  // the current serviceJobId into every call is what keeps a pending key
  // correctly scoped even if React reuses this component instance across a
  // serviceJobId prop change. See serviceReportDraftAttemptKey.ts for the
  // full ownership/lifetime reasoning and its own direct unit tests.
  const attemptKey = useRef(createServiceReportDraftAttemptKeyController()).current;
  const reports = orderServiceReports(
    repositories.serviceReports.listForServiceJob(serviceJobId)
  );
  const refresh = () => setRevision((value) => value + 1);

  const createDraft = async (input: ServiceReportDraftInput = {}) => {
    const key = attemptKey.get(serviceJobId);
    try {
      const report = await repositories.serviceReports.createDraft(serviceJobId, input, key);
      attemptKey.onSuccess(serviceJobId);
      refresh();
      return report;
    } catch (error) {
      attemptKey.onFailure(
        serviceJobId,
        error instanceof WorkerServiceReportError ? error.status : undefined
      );
      throw error;
    }
  };

  const updateDraft = async (reportId: string, patch: ServiceReportDraftPatch) => {
    const report = await repositories.serviceReports.updateDraft(reportId, patch);
    refresh();
    return report;
  };

  const finalize = async (reportId: string) => {
    const report = await repositories.serviceReports.finalize(reportId);
    refresh();
    return report;
  };

  return {
    reports,
    latestReport: reports.at(-1),
    activeDraft: reports.find((report) => report.status === 'draft'),
    refresh,
    createDraft,
    updateDraft,
    finalize,
  };
}
