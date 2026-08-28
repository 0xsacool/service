import { Timestamp, type DocumentData } from 'firebase/firestore';
import type {
  ResultStatus,
  ServiceAction,
  ServiceReport,
  ServiceReportDocument,
  ServiceReportPart,
  ServiceReportSnapshot,
} from '../../types';
import { isValidServiceReport } from '../../services/serviceReport';
import { parseServiceReportV2 } from '../../services/serviceReportV2';

export const SERVICE_REPORTS_COLLECTION = 'serviceReports';

export interface ServiceReportFirestoreFields {
  serviceJobId: string;
  reportNo: string;
  status: 'draft' | 'final';
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  technician: string;
  customerReportedProblem: string;
  inspectionFindings: string;
  serviceActions: ServiceAction[];
  parts: ServiceReportPart[];
  technicianRemark: string;
  resultStatus: ResultStatus | null;
  resultDetail: string;
  evidenceAttachmentIds: string[];
  claimNo: string | null;
  factoryReference: string | null;
  snapshot: ServiceReportSnapshot | null;
}

function readTimestamp(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return null;
}

export function toFirestoreFields(entry: ServiceReport): ServiceReportFirestoreFields {
  return {
    serviceJobId: entry.serviceJobId,
    reportNo: entry.reportNo,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    finalizedAt: entry.finalizedAt,
    technician: entry.technician,
    customerReportedProblem: entry.customerReportedProblem,
    inspectionFindings: entry.inspectionFindings,
    serviceActions: entry.serviceActions,
    parts: entry.parts,
    technicianRemark: entry.technicianRemark,
    resultStatus: entry.resultStatus,
    resultDetail: entry.resultDetail,
    evidenceAttachmentIds: entry.evidenceAttachmentIds,
    claimNo: entry.claimNo,
    factoryReference: entry.factoryReference,
    snapshot: entry.snapshot,
  };
}

export function fromFirestoreData(
  documentId: string,
  data: DocumentData,
  expectedServiceJobId?: string
): ServiceReportDocument | null {
  if (expectedServiceJobId !== undefined && data.serviceJobId !== expectedServiceJobId) {
    return null;
  }
  if (data.schemaVersion === 2) {
    const timestampFields = new Set([
      'createdAt',
      'updatedAt',
      'finalizedAt',
      'approvalDecidedAt',
    ]);
    const canonical = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        timestampFields.has(key) && value instanceof Timestamp
          ? value.toDate().toISOString()
          : value,
      ])
    );
    return parseServiceReportV2(documentId, canonical);
  }
  const createdAt = readTimestamp(data.createdAt);
  const updatedAt = readTimestamp(data.updatedAt);
  const finalizedAt = data.finalizedAt === null ? null : readTimestamp(data.finalizedAt);
  if (!createdAt || !updatedAt || (data.finalizedAt !== null && !finalizedAt)) {
    return null;
  }

  const report: ServiceReport = {
    id: documentId,
    serviceJobId: data.serviceJobId,
    reportNo: data.reportNo,
    status: data.status,
    createdAt,
    updatedAt,
    finalizedAt,
    technician: data.technician,
    customerReportedProblem: data.customerReportedProblem,
    inspectionFindings: data.inspectionFindings,
    serviceActions: data.serviceActions,
    parts: data.parts,
    technicianRemark: data.technicianRemark,
    resultStatus: data.resultStatus,
    resultDetail: data.resultDetail,
    evidenceAttachmentIds: data.evidenceAttachmentIds,
    claimNo: data.claimNo,
    factoryReference: data.factoryReference,
    snapshot: data.snapshot,
  };

  return isValidServiceReport(report) ? report : null;
}
