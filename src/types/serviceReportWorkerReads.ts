import type { CanonicalAttachmentKey } from './attachment';
import type {
  ResultStatus,
  ServiceAction,
  ServiceReportPart,
  ServiceReportSnapshot,
} from './serviceReport';
import type {
  ApprovalState,
  FinalContentDigest,
  StaffRole,
  WarrantyOutcome,
} from './serviceReportV2';

interface ServiceReportHistoryItemBaseV1 {
  historyItemVersion: 1;
  sourceSchemaVersion: 1 | 2;
  id: string;
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

export interface ServiceReportHistoryItemLegacyV1
  extends ServiceReportHistoryItemBaseV1 {
  sourceSchemaVersion: 1;
}

export interface ServiceReportHistoryItemV2 extends ServiceReportHistoryItemBaseV1 {
  sourceSchemaVersion: 2;
  warrantyOutcome: WarrantyOutcome;
  approvalState: ApprovalState;
  contentRevision: number;
  finalContentDigest: FinalContentDigest | null;
  predecessorReportId: string | null;
}

export type ServiceReportHistoryItem =
  | ServiceReportHistoryItemLegacyV1
  | ServiceReportHistoryItemV2;

export interface ServiceReportHistoryV1 {
  serviceJobId: string;
  reports: readonly ServiceReportHistoryItem[];
}

export type ApprovalQueueMode = 'queue' | 'report-number' | 'tracking-reference';

export interface ApprovalQueueItemV1 {
  queueItemVersion: 1;
  reportId: string;
  serviceJobId: string;
  reportNo: string;
  trackingReference: string;
  finalizedAt: string;
  approvalState: 'pending';
  predecessorReportId: string | null;
  technician: string;
  finalizedByDisplayName: string | null;
  warrantyOutcome: WarrantyOutcome;
  customerName: string;
  productName: string;
  modelOrSku: string | null;
  serialNumber: string;
  customerReportedProblem: string;
  resultStatus: ResultStatus | null;
  finalContentDigest: FinalContentDigest;
  evidenceCount: number;
}

export interface ApprovalQueuePageV1 {
  queueContractVersion: 1;
  mode: ApprovalQueueMode;
  normalizedSearch: string | null;
  pageSize: number;
  items: readonly ApprovalQueueItemV1[];
  nextCursor: string | null;
}

export interface ApprovalReviewV1 {
  reviewVersion: 1;
  reportId: string;
  serviceJobId: string;
  reportNo: string;
  createdAt: string;
  finalizedAt: string;
  approvalState: 'pending';
  predecessorReportId: string | null;
  createdBy: { role: StaffRole; displayName: string | null };
  finalizedBy: { role: StaffRole; displayName: string | null };
  content: {
    technician: string;
    customerReportedProblem: string;
    inspectionFindings: string;
    serviceActions: readonly ServiceAction[];
    parts: readonly ServiceReportPart[];
    technicianRemark: string;
    resultStatus: ResultStatus | null;
    resultDetail: string;
    evidenceAttachmentIds: readonly CanonicalAttachmentKey[];
    claimNo: string | null;
    factoryReference: string | null;
    warrantyOutcome: WarrantyOutcome;
  };
  snapshot: ServiceReportSnapshot;
  finalizedFromRevision: number;
  finalContentDigest: FinalContentDigest;
}

export type ApprovalQueueRequest =
  | { mode: 'queue'; pageSize?: number; cursor?: string }
  | { mode: 'report-number'; reportNo: string; pageSize?: number; cursor?: string }
  | {
      mode: 'tracking-reference';
      trackingReference: string;
      pageSize?: number;
      cursor?: string;
    };
