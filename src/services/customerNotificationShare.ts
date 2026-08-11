import type { ServiceJob } from '../types';
import { normalizePublicTrackingCodeInput } from './publicTrackingCode';
import { statusLabel } from './serviceJobPresentation';

export type CustomerNotificationShareResult = 'shared' | 'copied' | 'cancelled';

export interface CustomerNotificationShareEnvironment {
  share?: (data: { text: string }) => Promise<void>;
  clipboard?: {
    writeText: (text: string) => Promise<void>;
  };
}

export function buildCustomerNotificationMessage(
  job: ServiceJob,
  publicTrackingCode?: string
): string {
  const normalizedCode = publicTrackingCode
    ? normalizePublicTrackingCodeInput(publicTrackingCode)
    : null;
  const trackingLines = normalizedCode ? [`รหัสติดตาม: ${normalizedCode}`, ''] : [];
  return [
    'อัปเดตสถานะงานบริการ',
    '',
    `เลขที่งาน: ${job.id}`,
    `สินค้า: ${job.product}`,
    `สถานะปัจจุบัน: ${statusLabel(job.status)}`,
    '',
    ...trackingLines,
    'สามารถติดตามสถานะงานบริการได้จากลิงก์ที่ได้รับจากเจ้าหน้าที่',
  ].join('\n');
}

function getBrowserShareEnvironment(): CustomerNotificationShareEnvironment {
  if (typeof navigator === 'undefined') return {};
  return navigator;
}

function isShareCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export async function shareCustomerNotification(
  message: string,
  environment: CustomerNotificationShareEnvironment = getBrowserShareEnvironment()
): Promise<CustomerNotificationShareResult> {
  if (environment.share) {
    try {
      await environment.share({ text: message });
      return 'shared';
    } catch (error) {
      if (isShareCancelled(error)) return 'cancelled';
      throw error;
    }
  }

  if (!environment.clipboard) {
    throw new Error('ไม่พบช่องทางแชร์หรือคัดลอกข้อความบนอุปกรณ์นี้');
  }

  await environment.clipboard.writeText(message);
  return 'copied';
}
