import {
  collection,
  doc,
  getDocs,
  getDocFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type {
  BrandId,
  ServiceJob,
  ServiceReport,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import {
  createServiceReportDraft,
  editableServiceReportFields,
  finalizeServiceReport,
  formatServiceReportNumber,
  orderServiceReports,
} from '../services/serviceReport';
import { bangkokNumberingYear } from '../services/bangkokTime';
import type { ServiceJobsRepository, ServiceReportsRepository } from './types';
import {
  fromFirestoreData as fromServiceJobFirestoreData,
  SERVICE_JOBS_COLLECTION,
} from './firestore/serviceJobMapping';
import {
  fromFirestoreData,
  SERVICE_REPORTS_COLLECTION,
  toFirestoreFields,
} from './firestore/serviceReportMapping';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';

const NUMBER_SEQUENCES_COLLECTION = 'numberSequences';
const REPORT_DOCUMENT_TYPE = 'repair_report';

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

function sequenceReference(brandId: BrandId, year: number) {
  return doc(
    getFirestoreDb(),
    NUMBER_SEQUENCES_COLLECTION,
    `${brandId}__${REPORT_DOCUMENT_TYPE}__${year}`
  );
}

async function allocateFirestoreReportNumber(
  brandId: BrandId,
  year: number
): Promise<string> {
  let sequence = 0;
  await runTransaction(getFirestoreDb(), async (transaction) => {
    const reference = sequenceReference(brandId, year);
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? snapshot.data().currentValue : 0;
    if (!Number.isInteger(current) || current < 0 || current >= 999999) {
      throw new Error(
        'Firestore Service Report number sequence is malformed or exhausted'
      );
    }
    sequence = current + 1;
    transaction.set(
      reference,
      {
        brandId,
        documentType: REPORT_DOCUMENT_TYPE,
        year,
        currentValue: sequence,
      },
      { merge: true }
    );
  });
  return formatServiceReportNumber(year, sequence);
}

export async function createFirestoreServiceReportsRepository(
  serviceJobs: ServiceJobsRepository
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

    async createDraft(serviceJobId, input: ServiceReportDraftInput = {}) {
      const serviceJob = requireServiceJob(serviceJobs, serviceJobId);
      if (!serviceJob.brandId) {
        throw new Error(
          `Cannot create Service Report without Service Job brand "${serviceJobId}"`
        );
      }
      const existingReports = await getDocs(
        query(
          collection(getFirestoreDb(), SERVICE_REPORTS_COLLECTION),
          where('serviceJobId', '==', serviceJobId)
        )
      );
      const hasActiveDraft = existingReports.docs.some(
        (document) => fromFirestoreData(document.id, document.data())?.status === 'draft'
      );
      if (hasActiveDraft) {
        throw new Error(
          `Cannot create Service Report: Service Job "${serviceJobId}" already has an active draft`
        );
      }
      const reportId = crypto.randomUUID();
      const reportNo = await allocateFirestoreReportNumber(
        serviceJob.brandId,
        bangkokNumberingYear(new Date())
      );
      const draft = createServiceReportDraft(reportId, reportNo, serviceJob, input);
      await setDoc(reportReference(reportId), {
        ...toFirestoreFields(draft),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        finalizedAt: null,
      });
      const committed = await readReport(reportId);
      if (!committed) {
        throw new Error(`Firestore did not return created Service Report "${reportId}"`);
      }
      reportsById.set(reportId, committed);
      return committed;
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

    async finalize(reportId) {
      const reportRef = reportReference(reportId);
      await runTransaction(getFirestoreDb(), async (transaction) => {
        const reportSnapshot = await transaction.get(reportRef);
        if (!reportSnapshot.exists()) {
          throw new Error(
            `Cannot finalize Service Report "${reportId}": no report exists`
          );
        }
        const report = fromFirestoreData(reportSnapshot.id, reportSnapshot.data());
        if (!report) {
          throw new Error(`Cannot finalize malformed Service Report "${reportId}"`);
        }
        const jobRef = doc(
          getFirestoreDb(),
          SERVICE_JOBS_COLLECTION,
          report.serviceJobId
        );
        const jobSnapshot = await transaction.get(jobRef);
        if (!jobSnapshot.exists()) {
          throw new Error(
            `Cannot finalize Service Report: parent Service Job is missing`
          );
        }
        const serviceJob = fromServiceJobFirestoreData(
          report.serviceJobId,
          jobSnapshot.data()
        );
        const finalized = finalizeServiceReport(report, serviceJob);
        transaction.update(reportRef, {
          status: finalized.status,
          finalizedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          snapshot: finalized.snapshot,
        });
      });
      const finalized = await readReport(reportId);
      if (!finalized) {
        throw new Error(
          `Firestore did not return finalized Service Report "${reportId}"`
        );
      }
      reportsById.set(reportId, finalized);
      return finalized;
    },
  };
}
