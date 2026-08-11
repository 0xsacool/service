import { useState } from 'react';
import type {
  ServiceReport,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import { orderServiceReports } from '../services/serviceReport';
import { repositories } from '../repositories/repositoryProvider';

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
  const reports = orderServiceReports(
    repositories.serviceReports.listForServiceJob(serviceJobId)
  );
  const refresh = () => setRevision((value) => value + 1);

  const createDraft = async (input: ServiceReportDraftInput = {}) => {
    const report = await repositories.serviceReports.createDraft(serviceJobId, input);
    refresh();
    return report;
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
