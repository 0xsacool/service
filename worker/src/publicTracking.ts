import type { ServiceJobStatus } from '../../src/types/serviceJob.ts';

export interface PublicTrackingTimelineEvent {
  status: ServiceJobStatus;
  occurredAt: string;
}

export interface PublicTrackingServiceJobRecord {
  id: string;
  publicTrackingTokenHash: string | null;
  publicTrackingCodeHash: string | null;
  status: string | null;
  productName: string | null;
  productModelOrSku: string | null;
  serialNumber: string | null;
  timeline: readonly PublicTrackingTimelineEvent[];
  updatedAt: string | null;
}

export interface PublicTrackingCodeLookupRecord {
  serviceJobId: string;
}

export interface PublicTrackingDto {
  trackingReference: string;
  status: ServiceJobStatus;
  productName: string;
  productModelOrSku: string | null;
  maskedSerial: string | null;
  publicTimeline: PublicTrackingTimelineEvent[];
  lastUpdatedAt: string | null;
}

const PUBLIC_STATUSES: readonly ServiceJobStatus[] = [
  'Received',
  'Diagnosing',
  'Awaiting Parts',
  'In Repair',
  'Quality Check',
  'Ready for Pickup',
  'Completed',
  'Cancelled',
  'Rejected',
];

export function isPublicTrackingStatus(value: string | null): value is ServiceJobStatus {
  return value !== null && (PUBLIC_STATUSES as readonly string[]).includes(value);
}

export function maskSerialNumber(serialNumber: string | null): string | null {
  const normalized = serialNumber?.trim() ?? '';
  if (!normalized) return null;
  return `••••${normalized.slice(-4)}`;
}

export function buildPublicTrackingDto(
  record: PublicTrackingServiceJobRecord
): PublicTrackingDto | null {
  if (!isPublicTrackingStatus(record.status) || !record.productName?.trim()) {
    return null;
  }
  return {
    trackingReference: record.id,
    status: record.status,
    productName: record.productName,
    productModelOrSku: record.productModelOrSku,
    maskedSerial: maskSerialNumber(record.serialNumber),
    publicTimeline: [...record.timeline],
    lastUpdatedAt: record.updatedAt,
  };
}
