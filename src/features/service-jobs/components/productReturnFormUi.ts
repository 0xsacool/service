import type {
  ServiceJob,
  ServiceReportApprovalEvent,
  ServiceReportHistoryItem,
  ServiceReportV2Final,
} from '../../../types';
import type { TrustedPrintResult } from '../../../repositories/types';
import { orderServiceReports } from '../../../services/serviceReport';
import { hasTrustedReturnFormMetadata } from '../../../services/productReturnForm';

export interface ReturnFormTrustedPrint extends TrustedPrintResult {
  printState: 'v2-approved';
  report: ServiceReportV2Final;
  event: ServiceReportApprovalEvent;
}

export type ReturnFormAvailability =
  | { ready: true; latestReport: ServiceReportHistoryItem }
  | { ready: false; reason: string };

export function getReturnFormAvailability(
  serviceJob: ServiceJob,
  reports: readonly ServiceReportHistoryItem[]
): ReturnFormAvailability {
  if (!hasTrustedReturnFormMetadata(serviceJob)) {
    return {
      ready: false,
      reason:
        serviceJob.status === 'Completed'
          ? 'งานบริการนี้เป็นข้อมูลเดิมที่ไม่มีเลขที่ใบรับคืนหรือเวลารับคืนที่ระบบยืนยันได้'
          : 'ใบรับคืนสินค้าออกได้เมื่องานบริการอยู่ในสถานะเสร็จสิ้นแล้วเท่านั้น',
    };
  }

  const latestReport = orderServiceReports(reports).at(-1);
  if (!latestReport) {
    return {
      ready: false,
      reason: 'ยังไม่มีใบรายงานการตรวจสอบและซ่อมสำหรับยืนยันการคืนสินค้า',
    };
  }

  return { ready: true, latestReport };
}

export function assertReturnFormTrustedPrint(
  serviceJob: ServiceJob,
  expectedReportId: string,
  result: TrustedPrintResult
): ReturnFormTrustedPrint {
  const report = result.report;
  if (
    result.printState !== 'v2-approved' ||
    result.event === null ||
    !('schemaVersion' in report) ||
    report.schemaVersion !== 2 ||
    report.status !== 'final' ||
    report.id !== expectedReportId ||
    report.reportId !== expectedReportId ||
    report.serviceJobId !== serviceJob.id
  ) {
    throw new Error(
      'ใบรายงานล่าสุดยังไม่ผ่านการอนุมัติและตรวจสอบสำหรับการออกใบรับคืนสินค้า'
    );
  }

  return result as ReturnFormTrustedPrint;
}

export async function loadReturnFormTrustedPrint(
  serviceJob: ServiceJob,
  reports: readonly ServiceReportHistoryItem[],
  load: (reportId: string, mode?: 'normal' | 'diagnostic') => Promise<TrustedPrintResult>
): Promise<ReturnFormTrustedPrint> {
  const availability = getReturnFormAvailability(serviceJob, reports);
  if (!availability.ready) {
    throw new Error(availability.reason);
  }

  const result = await load(availability.latestReport.id, 'normal');
  return assertReturnFormTrustedPrint(serviceJob, availability.latestReport.id, result);
}
