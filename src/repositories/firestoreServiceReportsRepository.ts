import {
  doc,
  getDocFromServer,
  onSnapshot,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type {
  ServiceJob,
  ServiceReport,
  ServiceReportDocument,
  ServiceReportDraftPatch,
  ServiceReportV2,
  ServiceReportV2Content,
  ServiceReportV2DraftPatch,
  FinalContentDigest,
} from '../types';
import { editableServiceReportFields, isValidServiceReport, orderServiceReports } from '../services/serviceReport';
import {
  isServiceReportV2,
  normalizeServiceReportV2DraftPatch,
  parseServiceReportV2,
} from '../services/serviceReportV2';
import type { ServiceJobsRepository, ServiceReportsRepository } from './types';
import { fromFirestoreData, SERVICE_REPORTS_COLLECTION } from './firestore/serviceReportMapping';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';
import type { WorkerTokenProvider } from '../auth/workerTokenProvider';
import { fetchWithWorkerToken } from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import { WorkerServiceReportError } from './types';
import {
  createWorkerServiceReportHistoryRepository,
} from './workerServiceReportReadRepository';

function reportReference(reportId: string) {
  return doc(getFirestoreDb(), SERVICE_REPORTS_COLLECTION, reportId);
}

function requireServiceJob(
  serviceJobs: ServiceJobsRepository,
  serviceJobId: string
): ServiceJob {
  const serviceJob = serviceJobs.getById(serviceJobId);
  if (!serviceJob) {
    throw new Error(`Cannot use Service Report: no Service Job "${serviceJobId}" exists`);
  }
  return serviceJob;
}

async function readReport(reportId: string): Promise<ServiceReportDocument | undefined> {
  const snapshot = await getDocFromServer(reportReference(reportId));
  if (!snapshot.exists()) return undefined;
  return fromFirestoreData(snapshot.id, snapshot.data()) ?? undefined;
}

async function readWorkerReportResponse(response: Response): Promise<ServiceReport> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Worker Service Report request failed (${response.status})`;
    throw new WorkerServiceReportError(message, response.status);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('report' in body) ||
    !body.report ||
    typeof body.report !== 'object'
  ) {
    throw new Error('Worker returned malformed Service Report');
  }
  return body.report as ServiceReport;
}

function parseReturnedV2Report(value: unknown): ServiceReportV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id : candidate.reportId;
  if (typeof id !== 'string') return null;
  const persisted = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => key !== 'id')
  );
  return parseServiceReportV2(id, persisted);
}

async function readWorkerV2Data<T>(
  response: Response,
  parseData: (value: unknown) => T | null
): Promise<{ data: T; replayed: boolean }> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body && body.error &&
      typeof body.error === 'object' ? body.error as Record<string, unknown> : null;
    throw new WorkerServiceReportError(
      typeof error?.message === 'string' ? error.message : `Worker Service Report request failed (${response.status})`,
      response.status,
      typeof error?.code === 'string' ? error.code : null,
      error?.retryClass === 'never' || error?.retryClass === 'reload' ||
      error?.retryClass === 'same-idempotency-key' || error?.retryClass === 'operator'
        ? error.retryClass
        : null
    );
  }
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true ||
      !('data' in body) || typeof (body as { replayed?: unknown }).replayed !== 'boolean') {
    throw new Error('Worker returned a malformed V2 success envelope');
  }
  const parsed = parseData((body as { data: unknown }).data);
  if (!parsed) throw new Error('Worker returned malformed V2 operation data');
  return { data: parsed, replayed: (body as unknown as { replayed: boolean }).replayed };
}

function reportFromV2Payload(value: unknown): ServiceReportV2 | null {
  return value && typeof value === 'object' && 'report' in value
    ? parseReturnedV2Report((value as { report: unknown }).report)
    : null;
}

async function postV2(
  tokenProvider: WorkerTokenProvider,
  path: string,
  body: unknown,
  idempotencyKey?: string
): Promise<Response> {
  return fetchWithWorkerToken(tokenProvider, `${getFilesWorkerBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}
interface PendingDraftSaveRequest {
  fingerprint: string;
  serviceJobId: string;
  path: string;
  body: unknown;
}

async function runDraftSaveAttempt<T>(
  attempts: Map<string, PendingDraftSaveRequest>,
  idempotencyKey: string,
  fingerprint: string,
  prepare: () => Promise<Omit<PendingDraftSaveRequest, 'fingerprint'>>,
  send: (request: PendingDraftSaveRequest) => Promise<T>
): Promise<T> {
  let pending = attempts.get(idempotencyKey);
  if (pending && pending.fingerprint !== fingerprint) {
    throw new WorkerServiceReportError(
      'The idempotency key is already bound to a different draft save',
      409,
      'idempotency_mismatch'
    );
  }
  if (!pending) {
    const request = await prepare();
    pending = { fingerprint, ...request };
    attempts.set(idempotencyKey, pending);
  }
  try {
    const result = await send(pending);
    attempts.delete(idempotencyKey);
    return result;
  } catch (error) {
    // A 4xx is a definitive rejection. Network failures, malformed success
    // envelopes, and 5xx responses remain ambiguous and must reuse this key.
    if (error instanceof WorkerServiceReportError && error.status >= 400 && error.status < 500) {
      attempts.delete(idempotencyKey);
    }
    throw error;
  }
}

export async function createFirestoreServiceReportsRepository(
  serviceJobs: ServiceJobsRepository,
  tokenProvider: WorkerTokenProvider
): Promise<ServiceReportsRepository> {
  const reportsById = new Map<string, ServiceReportDocument>();
  const subscribedReportIds = new Set<string>();
  const pendingDraftSaveRequests = new Map<string, PendingDraftSaveRequest>();
  const historyRepository = createWorkerServiceReportHistoryRepository(tokenProvider);

  const subscribeToReport = (reportId: string): void => {
    if (subscribedReportIds.has(reportId)) return;
    subscribedReportIds.add(reportId);
    void onSnapshot(
      reportReference(reportId),
      (snapshot) => {
        const report = snapshot.exists()
          ? fromFirestoreData(snapshot.id, snapshot.data())
          : null;
        if (!report) {
          reportsById.delete(reportId);
          return;
        }
        if (!serviceJobs.getById(report.serviceJobId)) {
          reportsById.delete(reportId);
          return;
        }
        reportsById.set(report.id, report);
      },
      (err) => {
        recordFirestoreInitFailure(
          describeFirestoreInitError(err, 'serviceReports', 'listener')
        );
        reportsById.delete(reportId);
      }
    );
  };

  return {
    async fetchHistoryForServiceJob(serviceJobId, signal) {
      const history = await historyRepository.fetchHistoryForServiceJob(serviceJobId, signal);
      // Worker history contains projections, not complete report documents. Drop
      // full-document cache entries for this job so the next save must perform
      // an authoritative server read instead of trusting an older revision.
      for (const [reportId, report] of reportsById) {
        if (report.serviceJobId === serviceJobId) reportsById.delete(reportId);
      }
      return history;
    },

    listForServiceJob(serviceJobId) {
      if (!serviceJobs.getById(serviceJobId)) return [];
      return orderServiceReports(
        Array.from(reportsById.values()).filter(
          (report) => report.serviceJobId === serviceJobId
        )
      );
    },

    getById(reportId) {
      subscribeToReport(reportId);
      return reportsById.get(reportId);
    },

    // F5d-66 — Worker-mediated (DECISIONS.md #036/#040): FR-{YYYY}-{SEQ}
    // allocation and the one-active-draft lock both require a privileged
    // transaction the browser must never perform itself. requireServiceJob()
    // below is a fast local pre-check only — the Worker independently
    // re-verifies brand ownership and is the actual enforcement boundary.
    async createDraft(serviceJobId, input = {}, idempotencyKey) {
      requireServiceJob(serviceJobs, serviceJobId);
      const key = idempotencyKey ?? crypto.randomUUID();
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${getFilesWorkerBaseUrl()}/service-jobs/${encodeURIComponent(serviceJobId)}/service-reports`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({ input }),
        }
      );
      const report = await readWorkerReportResponse(response);
      reportsById.set(report.id, report);
      return report;
    },

    async updateDraft(reportId, patch: ServiceReportDraftPatch, expectedUpdatedAt, idempotencyKey) {
      const normalizedPatch = editableServiceReportFields(patch);
      const expected = expectedUpdatedAt ?? reportsById.get(reportId)?.updatedAt;
      const key = idempotencyKey ?? crypto.randomUUID();
      const fingerprint = JSON.stringify([reportId, expected ?? null, normalizedPatch]);
      return runDraftSaveAttempt(
        pendingDraftSaveRequests, key, fingerprint,
        async () => {
          const current = await readReport(reportId);
          if (!current || isServiceReportV2(current)) {
            throw new Error('Cannot update a missing or mismatched V1 Service Report');
          }
          if (current.status !== 'draft') {
            throw new Error('Final Service Reports are immutable through ordinary updates');
          }
          if (expected && current.updatedAt !== expected) {
            throw new WorkerServiceReportError('The V1 draft timestamp is stale', 412, 'stale_updated_at', 'reload');
          }
          return {
            serviceJobId: current.serviceJobId,
            path: `/service-jobs/${encodeURIComponent(current.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/legacy-draft-save`,
            body: { contractVersion: 1, expectedUpdatedAt: current.updatedAt, patch: normalizedPatch },
          };
        },
        async (request) => {
          const response = await postV2(tokenProvider, request.path, request.body, key);
          const result = await readWorkerV2Data(response, (value) => {
            if (!value || typeof value !== 'object' || !('report' in value)) return null;
            const report = value.report;
            return isValidServiceReport(report) && !('schemaVersion' in report) &&
              report.id === reportId && report.serviceJobId === request.serviceJobId
              ? report : null;
          });
          reportsById.set(reportId, result.data);
          return result.data;
        }
      );
    },

    // F5d-66 — also Worker-mediated: the only other operation that touches
    // the shared active-draft lock, which must clear atomically and
    // correctly with the draft->final transition (DECISIONS.md #040).
    // serviceJobId is resolved locally (cache, falling back to a direct
    // read) purely to build the request URL — the Worker independently
    // re-derives and re-verifies it server-side from the report document.
    async finalize(reportId) {
      const cached = reportsById.get(reportId);
      const report = cached ?? (await readReport(reportId));
      if (!report) {
        throw new Error(`Cannot finalize Service Report "${reportId}": no report exists`);
      }
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${getFilesWorkerBaseUrl()}/service-jobs/${encodeURIComponent(report.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/finalize`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const finalized = await readWorkerReportResponse(response);
      reportsById.set(finalized.id, finalized);
      return finalized;
    },

    async createDraftV2(
      serviceJobId: string,
      content: ServiceReportV2Content,
      idempotencyKey: string
    ) {
      requireServiceJob(serviceJobs, serviceJobId);
      const response = await postV2(
        tokenProvider,
        `/service-jobs/${encodeURIComponent(serviceJobId)}/service-reports`,
        { contractVersion: 2, content },
        idempotencyKey
      );
      const result = await readWorkerV2Data(response, reportFromV2Payload);
      reportsById.set(result.data.id, result.data);
      return result.data;
    },

    async updateDraftV2(
      reportId: string,
      expectedContentRevision: number,
      patch: ServiceReportV2DraftPatch,
      idempotencyKey?: string
    ) {
      const normalizedPatch = normalizeServiceReportV2DraftPatch(patch);
      if (!normalizedPatch) throw new Error('A non-empty V2 draft patch is required');
      const key = idempotencyKey ?? crypto.randomUUID();
      const fingerprint = JSON.stringify([reportId, expectedContentRevision, normalizedPatch]);
      return runDraftSaveAttempt(
        pendingDraftSaveRequests, key, fingerprint,
        async () => {
          const current = await readReport(reportId);
          if (!current || !isServiceReportV2(current)) {
            throw new Error('Cannot update a missing or mismatched V2 Service Report');
          }
          if (current.status !== 'draft' || current.approvalState !== 'not-submitted') {
            throw new Error('Only a V2 draft that has not been submitted may be edited');
          }
          if (current.contentRevision !== expectedContentRevision) {
            throw new WorkerServiceReportError('The draft revision is stale', 412, 'stale_revision', 'reload');
          }
          return {
            serviceJobId: current.serviceJobId,
            path: `/service-jobs/${encodeURIComponent(current.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/draft-save`,
            body: { contractVersion: 2, expectedContentRevision, patch: normalizedPatch },
          };
        },
        async (request) => {
          const response = await postV2(tokenProvider, request.path, request.body, key);
          const result = await readWorkerV2Data(response, (value) => {
            const report = reportFromV2Payload(value);
            return report && report.id === reportId && report.serviceJobId === request.serviceJobId
              ? report : null;
          });
          reportsById.set(reportId, result.data);
          return result.data;
        }
      );
    },

    async finalizeV2(reportId, expectedContentRevision, idempotencyKey) {
      const report = reportsById.get(reportId) ?? await readReport(reportId);
      if (!report || !isServiceReportV2(report)) throw new Error(`Cannot finalize V2 Service Report "${reportId}"`);
      const response = await postV2(
        tokenProvider,
        `/service-jobs/${encodeURIComponent(report.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/finalize`,
        { contractVersion: 2, expectedContentRevision },
        idempotencyKey
      );
      const result = await readWorkerV2Data(response, reportFromV2Payload);
      reportsById.set(reportId, result.data);
      return result.data;
    },

    async decideV2(
      reportId: string,
      decision: 'approved' | 'rejected',
      rejectionReason: string | null,
      expectedFinalDigest: FinalContentDigest,
      idempotencyKey: string
    ) {
      const report = reportsById.get(reportId) ?? await readReport(reportId);
      if (!report || !isServiceReportV2(report)) throw new Error(`Cannot decide V2 Service Report "${reportId}"`);
      const response = await postV2(
        tokenProvider,
        `/service-jobs/${encodeURIComponent(report.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/approval-decision`,
        { contractVersion: 2, decision, rejectionReason, expectedFinalDigest },
        idempotencyKey
      );
      const result = await readWorkerV2Data(response, (value) =>
        value && typeof value === 'object' && 'report' in value
          ? parseReturnedV2Report((value as { report: unknown }).report)
          : null
      );
      reportsById.set(reportId, result.data);
      return result.data;
    },

    async createSuccessorV2(
      predecessorReportId: string,
      expectedPredecessorDigest: FinalContentDigest,
      confirmedOmittedEvidenceAttachmentIds: string[],
      idempotencyKey: string
    ) {
      const predecessor = reportsById.get(predecessorReportId) ?? await readReport(predecessorReportId);
      if (!predecessor || !isServiceReportV2(predecessor)) throw new Error(`Cannot create successor for "${predecessorReportId}"`);
      const response = await postV2(
        tokenProvider,
        `/service-jobs/${encodeURIComponent(predecessor.serviceJobId)}/service-reports/${encodeURIComponent(predecessorReportId)}/successor`,
        { contractVersion: 2, expectedPredecessorDigest, confirmedOmittedEvidenceAttachmentIds },
        idempotencyKey
      );
      const result = await readWorkerV2Data(response, reportFromV2Payload);
      reportsById.set(result.data.id, result.data);
      return result.data;
    },

    async trustedPrint(reportId, contractVersion, mode) {
      const report = reportsById.get(reportId) ?? await readReport(reportId);
      if (!report) throw new Error(`Cannot print Service Report "${reportId}"`);
      const response = await postV2(
        tokenProvider,
        `/service-jobs/${encodeURIComponent(report.serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/trusted-print`,
        { contractVersion, mode }
      );
      const result = await readWorkerV2Data(response, (value) => {
        if (!value || typeof value !== 'object' || !('report' in value) || !('printState' in value)) return null;
        const payload = value as Record<string, unknown>;
        const parsedReport = contractVersion === 2
          ? parseReturnedV2Report(payload.report)
          : payload.report as ServiceReport;
        return parsedReport ? { ...payload, report: parsedReport } as import('./types').TrustedPrintResult : null;
      });
      return result.data;
    },
  };
}
