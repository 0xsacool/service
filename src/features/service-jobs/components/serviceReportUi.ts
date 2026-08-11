import type { ServiceJob, ServiceReport, ServiceReportDraftPatch } from '../../../types';
import { orderServiceReports } from '../../../services/serviceReport';

export const SERVICE_ACTION_LABELS = {
  repair: 'ซ่อม',
  'replace-part': 'เปลี่ยนอะไหล่',
  'replace-product': 'เปลี่ยนสินค้า',
  'claim-factory': 'ส่งเคลมโรงงาน',
  'return-to-customer': 'ส่งคืนลูกค้า',
} as const;

export const RESULT_STATUS_LABELS = {
  repaired: 'ซ่อมเสร็จแล้ว',
  'awaiting-part': 'รออะไหล่',
  'sent-for-claim': 'ส่งเคลมแล้ว',
  replaced: 'เปลี่ยนแล้ว',
  returned: 'ส่งคืนแล้ว',
  'unable-to-repair': 'ไม่สามารถซ่อมได้',
} as const;

export function getLatestServiceReport(
  reports: ServiceReport[]
): ServiceReport | undefined {
  return orderServiceReports(reports).at(-1);
}

export function getReportHistory(reports: ServiceReport[]): ServiceReport[] {
  const ordered = orderServiceReports(reports);
  return ordered.slice(0, -1).reverse();
}

export function getActiveDraft(reports: ServiceReport[]): ServiceReport | undefined {
  return reports.find((report) => report.status === 'draft');
}

export function toDraftPatch(report: ServiceReport): ServiceReportDraftPatch {
  return {
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
  };
}

export interface ServiceReportDisplayContext {
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

export function getReportDisplayContext(
  report: ServiceReport,
  serviceJob: ServiceJob
): ServiceReportDisplayContext {
  if (report.status === 'final' && report.snapshot) return report.snapshot;
  return {
    trackingReference: serviceJob.id,
    customerName: serviceJob.customerName,
    customerPhone: serviceJob.customerPhone,
    customerEmail: serviceJob.customerEmail,
    brandCode:
      serviceJob.brandId === 'bruno-thailand'
        ? 'BRN'
        : serviceJob.brandId === 'join-lux-club'
          ? 'JLC'
          : '—',
    brandName:
      serviceJob.brandId === 'bruno-thailand'
        ? 'Bruno Thailand'
        : serviceJob.brandId === 'join-lux-club'
          ? 'Join Lux Club'
          : '—',
    productName: serviceJob.product,
    modelOrSku: null,
    serialNumber: serviceJob.serialNumber,
    customerReportedProblem: report.customerReportedProblem,
  };
}
