export const SERVICE_ACTIONS = [
  'repair',
  'replace-part',
  'replace-product',
  'claim-factory',
  'return-to-customer',
] as const;

export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export const RESULT_STATUSES = [
  'repaired',
  'awaiting-part',
  'sent-for-claim',
  'replaced',
  'returned',
  'unable-to-repair',
] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface ServiceReportPart {
  description: string;
  partNo: string | null;
  quantity: number;
  remark: string;
}

export interface ServiceReportSnapshot {
  trackingReference: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  brandCode: string;
  brandName: string;
  productName: string;
  modelOrSku: string | null;
  serialNumber: string;
  customerReportedProblem: string;
}

export interface ServiceReport {
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

export type ServiceReportDraftInput = Partial<
  Pick<
    ServiceReport,
    | 'technician'
    | 'customerReportedProblem'
    | 'inspectionFindings'
    | 'serviceActions'
    | 'parts'
    | 'technicianRemark'
    | 'resultStatus'
    | 'resultDetail'
    | 'evidenceAttachmentIds'
    | 'claimNo'
    | 'factoryReference'
  >
>;

export type ServiceReportDraftPatch = ServiceReportDraftInput;
