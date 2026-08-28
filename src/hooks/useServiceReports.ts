import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FinalContentDigest,
  ServiceReportDocument,
  ServiceReportHistoryItem,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import { orderServiceReports } from '../services/serviceReport';
import { defaultContent, isServiceReportV2 } from '../services/serviceReportV2';
import { canonicalizeEvidenceKeys } from '../services/evidenceOmission';
import { isServiceReportV2ClientEnabled } from '../config/serviceReportV2';
import { repositories } from '../repositories/repositoryProvider';
import { WorkerServiceReportError, type TrustedPrintResult } from '../repositories/types';
import { createServiceReportDraftAttemptKeyController } from './serviceReportDraftAttemptKey';

export interface UseServiceReportsResult {
  reports: ServiceReportHistoryItem[];
  latestReport: ServiceReportHistoryItem | undefined;
  activeDraft: ServiceReportHistoryItem | undefined;
  isHistoryLoading: boolean;
  isHistoryStale: boolean;
  historyError: Error | null;
  refresh: () => void;
  createDraft: (input?: ServiceReportDraftInput) => Promise<ServiceReportDocument>;
  updateDraft: (
    reportId: string,
    patch: ServiceReportDraftPatch
  ) => Promise<ServiceReportDocument>;
  finalize: (reportId: string, expectedContentRevision?: number) => Promise<ServiceReportDocument>;
  // D25: there is deliberately no decide() here. A terminal approval decision
  // is only legitimate when bound to an exact ApprovalReviewV1 the reviewer
  // actually loaded and saw, so the only decision surface is
  // useApprovalReview().decide in useApprovalConsoleReads.ts. Ordinary history
  // displays terminal state; it never issues a generic approve/reject command.
  createSuccessor: (
    predecessorReportId: string,
    expectedPredecessorDigest: FinalContentDigest,
    confirmedOmittedEvidenceAttachmentIds?: string[]
  ) => Promise<ServiceReportDocument>;
  trustedPrint: (
    reportId: string,
    mode?: 'normal' | 'diagnostic'
  ) => Promise<TrustedPrintResult>;
}

const historyCache = new Map<string, readonly ServiceReportHistoryItem[]>();

function projectHistoryItem(report: ServiceReportDocument): ServiceReportHistoryItem {
  const common = {
    historyItemVersion: 1 as const,
    id: report.id,
    serviceJobId: report.serviceJobId,
    reportNo: report.reportNo,
    status: report.status,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    finalizedAt: report.finalizedAt,
    technician: report.technician,
    customerReportedProblem: report.customerReportedProblem,
    inspectionFindings: report.inspectionFindings,
    serviceActions: [...report.serviceActions],
    parts: report.parts.map((part) => ({ ...part })),
    technicianRemark: report.technicianRemark,
    resultStatus: report.resultStatus,
    resultDetail: report.resultDetail,
    evidenceAttachmentIds: [...report.evidenceAttachmentIds],
    claimNo: report.claimNo,
    factoryReference: report.factoryReference,
    snapshot: report.snapshot ? { ...report.snapshot } : null,
  };
  return isServiceReportV2(report)
    ? {
        ...common,
        sourceSchemaVersion: 2,
        warrantyOutcome: report.warrantyOutcome,
        approvalState: report.approvalState,
        contentRevision: report.contentRevision,
        finalContentDigest: report.finalContentDigest,
        predecessorReportId: report.predecessorReportId,
      }
    : { ...common, sourceSchemaVersion: 1 };
}

export interface HistoryStateProjection {
  isHistoryLoading: boolean;
  isHistoryStale: boolean;
  historyError: Error | null;
}

// D24 cross-job fencing, extracted as a pure function so the "a late response
// for job A must never present as job B's state" rule is directly testable
// without a React renderer. Until the loaded job matches the requested job,
// the caller is told it is still loading — never shown another job's staleness
// or error as if it belonged to this one.
export function projectHistoryState(input: {
  requestedServiceJobId: string;
  loadedServiceJobId: string | null;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
}): HistoryStateProjection {
  const matches = input.loadedServiceJobId === input.requestedServiceJobId;
  return {
    isHistoryLoading: matches ? input.isLoading : true,
    isHistoryStale: matches ? input.isStale : false,
    historyError: matches ? input.error : null,
  };
}

export function useServiceReports(serviceJobId: string): UseServiceReportsResult {
  const [storedReports, setReports] = useState<ServiceReportHistoryItem[]>(() =>
    [...(historyCache.get(serviceJobId) ?? [])]
  );
  const [reportsJobId, setReportsJobId] = useState(serviceJobId);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isHistoryStale, setIsHistoryStale] = useState(false);
  const [historyError, setHistoryError] = useState<Error | null>(null);
  const historyGeneration = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  // One controller per hook instance (useRef, never module-global). The
  // controller itself is serviceJobId-aware (Phase 2B-R2) rather than
  // relying on this hook always being remounted per Service Job — passing
  // the current serviceJobId into every call is what keeps a pending key
  // correctly scoped even if React reuses this component instance across a
  // serviceJobId prop change. See serviceReportDraftAttemptKey.ts for the
  // full ownership/lifetime reasoning and its own direct unit tests.
  const attemptKey = useRef(createServiceReportDraftAttemptKeyController()).current;
  const operationKeys = useRef(new Map<string, string>()).current;
  const reports = reportsJobId === serviceJobId
    ? storedReports
    : [...(historyCache.get(serviceJobId) ?? [])];
  const refreshHistory = useCallback(async (): Promise<void> => {
    historyAbort.current?.abort();
    const abort = new AbortController();
    historyAbort.current = abort;
    const generation = ++historyGeneration.current;
    setIsHistoryLoading(true);
    try {
      const fetched = await repositories.serviceReports.fetchHistoryForServiceJob(
        serviceJobId,
        abort.signal
      );
      if (generation !== historyGeneration.current) return;
      const ordered = orderServiceReports(fetched);
      historyCache.set(serviceJobId, ordered);
      setReports(ordered);
      setReportsJobId(serviceJobId);
      setHistoryError(null);
      setIsHistoryStale(false);
    } catch (error) {
      if (abort.signal.aborted || generation !== historyGeneration.current) return;
      setReportsJobId(serviceJobId);
      setReports([...(historyCache.get(serviceJobId) ?? [])]);
      setHistoryError(
        error instanceof Error ? error : new Error('Service Report history refresh failed')
      );
      setIsHistoryStale(true);
    } finally {
      if (generation === historyGeneration.current) setIsHistoryLoading(false);
    }
  }, [serviceJobId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshHistory();
    });
    return () => {
      cancelled = true;
      historyGeneration.current += 1;
      historyAbort.current?.abort();
    };
  }, [serviceJobId, refreshHistory]);

  useEffect(() => {
    const refreshOnFocus = () => void refreshHistory();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshHistory();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshHistory]);

  const applyProvisional = (report: ServiceReportDocument): void => {
    setReportsJobId(serviceJobId);
    setReports((current) => {
      const currentForJob = reportsJobId === serviceJobId
        ? current
        : [...(historyCache.get(serviceJobId) ?? [])];
      const next = orderServiceReports([
        ...currentForJob.filter((item) => item.id !== report.id),
        projectHistoryItem(report),
      ]);
      historyCache.set(serviceJobId, next);
      return next;
    });
    setIsHistoryStale(true);
  };

  const refresh = () => void refreshHistory();

  const createDraft = async (input: ServiceReportDraftInput = {}) => {
    const key = attemptKey.get(serviceJobId);
    try {
      const serviceJob = repositories.serviceJobs.getById(serviceJobId);
      const report = isServiceReportV2ClientEnabled() && serviceJob
        ? await repositories.serviceReports.createDraftV2(
            serviceJobId,
            {
              ...defaultContent(),
              technician: input.technician ?? serviceJob.technician,
              customerReportedProblem: input.customerReportedProblem ?? serviceJob.issue,
              inspectionFindings: input.inspectionFindings ?? '',
              serviceActions: input.serviceActions ?? [],
              parts: input.parts ?? [],
              technicianRemark: input.technicianRemark ?? '',
              resultStatus: input.resultStatus ?? null,
              resultDetail: input.resultDetail ?? '',
              evidenceAttachmentIds: input.evidenceAttachmentIds ?? [],
              claimNo: input.claimNo ?? null,
              factoryReference: input.factoryReference ?? null,
              warrantyOutcome: serviceJob.warranty ? 'covered' : 'undetermined',
            },
            key
          )
        : await repositories.serviceReports.createDraft(serviceJobId, input, key);
      attemptKey.onSuccess(serviceJobId);
      applyProvisional(report);
      await refreshHistory();
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
    const current = reports.find((item) => item.id === reportId);
    const report = current?.sourceSchemaVersion === 2
      ? await repositories.serviceReports.updateDraftV2(
          reportId, current.contentRevision, patch
        )
      : await repositories.serviceReports.updateDraft(reportId, patch);
    applyProvisional(report);
    await refreshHistory();
    return report;
  };

  const operationKey = (scope: string): string => {
    const existing = operationKeys.get(scope);
    if (existing) return existing;
    const created = crypto.randomUUID();
    operationKeys.set(scope, created);
    return created;
  };

  const runIdempotent = async <T>(scope: string, operation: (key: string) => Promise<T>) => {
    try {
      const result = await operation(operationKey(scope));
      operationKeys.delete(scope);
      return result;
    } catch (error) {
      if (error instanceof WorkerServiceReportError && error.status >= 400 && error.status < 500) {
        operationKeys.delete(scope);
      }
      throw error;
    }
  };

  const finalize = async (reportId: string, expectedContentRevision?: number) => {
    const current = reports.find((item) => item.id === reportId);
    const report = current?.sourceSchemaVersion === 2
      ? await runIdempotent(
          `finalize:${reportId}:${expectedContentRevision ?? current.contentRevision}`,
          (key) => repositories.serviceReports.finalizeV2(
            reportId,
            expectedContentRevision ?? current.contentRevision,
            key
          )
        )
      : await repositories.serviceReports.finalize(reportId);
    applyProvisional(report);
    await refreshHistory();
    return report;
  };

  const createSuccessor = async (
    predecessorReportId: string,
    expectedPredecessorDigest: FinalContentDigest,
    confirmedOmittedEvidenceAttachmentIds: string[] = []
  ) => {
    // The omission list is a set, so a reordered array is the SAME attempt and
    // must reuse the same key — otherwise a re-render that reorders the array
    // would mint a new key and defeat replay of an in-flight request.
    const omitted = canonicalizeEvidenceKeys(confirmedOmittedEvidenceAttachmentIds);
    const scope = `successor:${predecessorReportId}:${expectedPredecessorDigest}:${omitted.join('\0')}`;
    const report = await runIdempotent(scope, (key) =>
      repositories.serviceReports.createSuccessorV2(
        predecessorReportId,
        expectedPredecessorDigest,
        omitted,
        key
      )
    );
    applyProvisional(report);
    await refreshHistory();
    return report;
  };

  const trustedPrint = async (reportId: string, mode: 'normal' | 'diagnostic' = 'normal') => {
    const report = reports.find((item) => item.id === reportId);
    return repositories.serviceReports.trustedPrint(
      reportId,
      report?.sourceSchemaVersion === 2 ? 2 : 1,
      mode
    );
  };

  return {
    reports,
    latestReport: reports.at(-1),
    activeDraft: reports.find((report) => report.status === 'draft'),
    ...projectHistoryState({
      requestedServiceJobId: serviceJobId,
      loadedServiceJobId: reportsJobId,
      isLoading: isHistoryLoading,
      isStale: isHistoryStale,
      error: historyError,
    }),
    refresh,
    createDraft,
    updateDraft,
    finalize,
    createSuccessor,
    trustedPrint,
  };
}
