import { useLayoutEffect, useRef, useState } from 'react';
import type { ServiceJob, ServiceReportHistoryItem } from '../../../types';
import type { TrustedPrintResult } from '../../../repositories/types';
import {
  getReturnFormAvailability,
  loadReturnFormTrustedPrint,
  type ReturnFormAvailability,
  type ReturnFormTrustedPrint,
} from './productReturnFormUi';

export interface ReturnFormPreviewGuard {
  availability: ReturnFormAvailability;
  printablePreview: ReturnFormTrustedPrint | null;
  verify(): Promise<ReturnFormTrustedPrint>;
  clear(): void;
}

function reportHistoryKey(reports: readonly ServiceReportHistoryItem[]): string {
  return reports
    .map((report) =>
      [
        report.id,
        report.updatedAt,
        report.status,
        report.sourceSchemaVersion,
        'contentRevision' in report ? (report.contentRevision ?? '') : '',
        'approvalState' in report ? (report.approvalState ?? '') : '',
      ].join(':')
    )
    .join('|');
}

export function useReturnFormPreviewGuard(input: {
  serviceJob: ServiceJob;
  reports: readonly ServiceReportHistoryItem[];
  trustedPrint: (
    reportId: string,
    mode?: 'normal' | 'diagnostic'
  ) => Promise<TrustedPrintResult>;
  isHistoryLoading: boolean;
  isHistoryStale: boolean;
  historyError: Error | null;
}): ReturnFormPreviewGuard {
  const availability = getReturnFormAvailability(input.serviceJob, input.reports);
  const latestReportId = availability.ready ? availability.latestReport.id : null;
  const historyKey = reportHistoryKey(input.reports);
  const historyReady =
    !input.isHistoryLoading &&
    !input.isHistoryStale &&
    input.historyError === null &&
    availability.ready;

  const [preview, setPreview] = useState<{
    reportId: string;
    historyKey: string;
    trustedPrint: ReturnFormTrustedPrint;
  } | null>(null);
  const requestGeneration = useRef(0);
  const gateRef = useRef({
    historyReady,
    latestReportId,
    historyKey,
  });

  useLayoutEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    gateRef.current = { historyReady, latestReportId, historyKey };
    queueMicrotask(() => {
      if (!active) return;
      setPreview((current) => {
        if (
          current &&
          historyReady &&
          current.reportId === latestReportId &&
          current.historyKey === historyKey
        ) {
          return current;
        }
        return null;
      });
    });
    return () => {
      active = false;
    };
  }, [historyReady, historyKey, latestReportId]);

  const printablePreview =
    preview &&
    historyReady &&
    preview.reportId === latestReportId &&
    preview.historyKey === historyKey
      ? preview.trustedPrint
      : null;

  const verify = async (): Promise<ReturnFormTrustedPrint> => {
    if (!historyReady || !availability.ready) {
      throw new Error('กรุณารีเฟรชประวัติใบรายงานให้เป็นปัจจุบันก่อนออกใบรับคืนสินค้า');
    }

    const requestedReportId = availability.latestReport.id;
    const requestedHistoryKey = historyKey;
    const generation = ++requestGeneration.current;
    const verified = await loadReturnFormTrustedPrint(
      input.serviceJob,
      input.reports,
      input.trustedPrint
    );
    const currentGate = gateRef.current;

    if (
      generation !== requestGeneration.current ||
      !currentGate.historyReady ||
      currentGate.latestReportId !== requestedReportId ||
      currentGate.historyKey !== requestedHistoryKey ||
      verified.report.id !== requestedReportId
    ) {
      throw new Error(
        'ประวัติใบรายงานมีการเปลี่ยนแปลง กรุณาตรวจสอบใบรายงานล่าสุดก่อนพิมพ์อีกครั้ง'
      );
    }

    setPreview({
      reportId: requestedReportId,
      historyKey: requestedHistoryKey,
      trustedPrint: verified,
    });
    return verified;
  };

  const clear = () => {
    requestGeneration.current += 1;
    setPreview(null);
  };

  return { availability, printablePreview, verify, clear };
}
