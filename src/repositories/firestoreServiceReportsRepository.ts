import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { ServiceJob, ServiceReport, ServiceReportDraftPatch } from '../types';
import { editableServiceReportFields, orderServiceReports } from '../services/serviceReport';
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

async function readReport(reportId: string): Promise<ServiceReport | undefined> {
  const snapshot = await getDocFromServer(reportReference(reportId));
  if (!snapshot.exists()) return undefined;
  return fromFirestoreData(snapshot.id, snapshot.data()) ?? undefined;
}

// F5d-66 — parses the Worker's { report } response body or throws the
// Worker's own { error } message; used by both createDraft() and
// finalize() below, the only two operations this repository delegates to
// the privileged Worker transaction (see DECISIONS.md #036/#040).
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

export async function createFirestoreServiceReportsRepository(
  serviceJobs: ServiceJobsRepository,
  tokenProvider: WorkerTokenProvider
): Promise<ServiceReportsRepository> {
  const reportsById = new Map<string, ServiceReport>();
  const subscribedJobIds = new Set<string>();
  const subscribedReportIds = new Set<string>();

  const subscribeToServiceJob = (serviceJobId: string): void => {
    if (subscribedJobIds.has(serviceJobId)) return;
    subscribedJobIds.add(serviceJobId);
    void onSnapshot(
      query(
        collection(getFirestoreDb(), SERVICE_REPORTS_COLLECTION),
        where('serviceJobId', '==', serviceJobId)
      ),
      (snapshot) => {
        for (const [reportId, report] of reportsById) {
          if (report.serviceJobId === serviceJobId) reportsById.delete(reportId);
        }
        snapshot.forEach((document) => {
          const report = fromFirestoreData(document.id, document.data(), serviceJobId);
          if (report?.serviceJobId === serviceJobId) reportsById.set(report.id, report);
        });
      },
      (err) => {
        recordFirestoreInitFailure(
          describeFirestoreInitError(err, 'serviceReports', 'listener')
        );
        for (const [reportId, report] of reportsById) {
          if (report.serviceJobId === serviceJobId) reportsById.delete(reportId);
        }
      }
    );
  };

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
    listForServiceJob(serviceJobId) {
      if (!serviceJobs.getById(serviceJobId)) return [];
      subscribeToServiceJob(serviceJobId);
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

    async updateDraft(reportId, patch: ServiceReportDraftPatch) {
      const reference = reportReference(reportId);
      await runTransaction(getFirestoreDb(), async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) {
          throw new Error(`Cannot update Service Report "${reportId}": no report exists`);
        }
        const existing = fromFirestoreData(snapshot.id, snapshot.data());
        if (!existing) {
          throw new Error(`Cannot update malformed Service Report "${reportId}"`);
        }
        editableServiceReportFields(patch);
        if (existing.status !== 'draft') {
          throw new Error('Final Service Reports are immutable through ordinary updates');
        }
        transaction.update(reference, {
          ...editableServiceReportFields(patch),
          updatedAt: serverTimestamp(),
        });
      });
      const updated = await readReport(reportId);
      if (!updated) {
        throw new Error(`Firestore did not return updated Service Report "${reportId}"`);
      }
      reportsById.set(reportId, updated);
      return updated;
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
  };
}
