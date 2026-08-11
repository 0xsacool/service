import type { ServiceJobStatus } from '../../types';
import { backendKind } from '../../config/backend';
import { normalizePublicTrackingCodeInput } from '../../services/publicTrackingCode';

const PUBLIC_TRACKING_STATUSES: readonly ServiceJobStatus[] = [
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
const SAFE_TRACKING_REFERENCE = /^[a-zA-Z0-9_-]+$/;
const SAFE_PUBLIC_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_PUBLIC_TRACKING_RESPONSE_BYTES = 16 * 1024;

export interface PublicTrackingTimelineEvent {
  status: ServiceJobStatus;
  occurredAt: string;
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

export type PublicTrackingLookup =
  { kind: 'found'; record: PublicTrackingDto } | { kind: 'unavailable' };

export interface PublicTrackingGateway {
  lookup(trackingReference: string, token: string): Promise<PublicTrackingLookup>;
  lookupByCode(code: string): Promise<PublicTrackingLookup>;
}

interface PublicTrackingFetchDependencies {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}

function isPublicTrackingStatus(value: unknown): value is ServiceJobStatus {
  return (
    typeof value === 'string' &&
    (PUBLIC_TRACKING_STATUSES as readonly string[]).includes(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePublicTimeline(value: unknown): PublicTrackingTimelineEvent[] | null {
  if (!Array.isArray(value)) return null;
  const timeline: PublicTrackingTimelineEvent[] = [];
  for (const event of value) {
    if (!isRecord(event)) return null;
    const { status, occurredAt } = event;
    if (!isPublicTrackingStatus(status) || !isTimestamp(occurredAt)) return null;
    timeline.push({ status, occurredAt });
  }
  return timeline;
}

export function parsePublicTrackingDto(value: unknown): PublicTrackingDto | null {
  if (!isRecord(value)) return null;
  const data = value;
  const timeline = parsePublicTimeline(data.publicTimeline);
  if (
    typeof data.trackingReference !== 'string' ||
    !SAFE_TRACKING_REFERENCE.test(data.trackingReference) ||
    !isPublicTrackingStatus(data.status) ||
    typeof data.productName !== 'string' ||
    !data.productName.trim() ||
    (data.productModelOrSku !== null && typeof data.productModelOrSku !== 'string') ||
    (data.maskedSerial !== null && typeof data.maskedSerial !== 'string') ||
    timeline === null ||
    (data.lastUpdatedAt !== null && !isTimestamp(data.lastUpdatedAt))
  ) {
    return null;
  }
  return {
    trackingReference: data.trackingReference,
    status: data.status,
    productName: data.productName,
    productModelOrSku: data.productModelOrSku,
    maskedSerial: data.maskedSerial,
    publicTimeline: timeline,
    lastUpdatedAt: data.lastUpdatedAt,
  };
}

function readPublicTrackingWorkerUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_TRACKING_WORKER_URL?.trim();
  return (configured || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

async function readBoundedJson(response: Response): Promise<unknown | null> {
  const declaredSize = Number(response.headers.get('Content-Length'));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_PUBLIC_TRACKING_RESPONSE_BYTES
  ) {
    return null;
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PUBLIC_TRACKING_RESPONSE_BYTES) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function requestPublicTrackingDto(
  fetch: typeof globalThis.fetch,
  url: string,
  body: { token: string } | { code: string }
): Promise<PublicTrackingLookup> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { kind: 'unavailable' };
    const record = parsePublicTrackingDto(await readBoundedJson(response));
    return record ? { kind: 'found', record } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export function createPublicTrackingGateway(
  dependencies: PublicTrackingFetchDependencies
): PublicTrackingGateway {
  const baseUrl = dependencies.baseUrl.replace(/\/+$/, '');
  return {
    async lookup(trackingReference, token) {
      if (
        !SAFE_TRACKING_REFERENCE.test(trackingReference) ||
        !SAFE_PUBLIC_TOKEN.test(token)
      ) {
        return { kind: 'unavailable' };
      }
      return requestPublicTrackingDto(
        dependencies.fetch,
        `${baseUrl}/public/tracking/${encodeURIComponent(trackingReference)}`,
        { token }
      );
    },
    async lookupByCode(code) {
      const normalizedCode = normalizePublicTrackingCodeInput(code);
      if (!normalizedCode) return { kind: 'unavailable' };
      return requestPublicTrackingDto(dependencies.fetch, `${baseUrl}/public/tracking`, {
        code: normalizedCode,
      });
    },
  };
}

const unavailablePublicTrackingGateway: PublicTrackingGateway = {
  async lookup() {
    return { kind: 'unavailable' };
  },
  async lookupByCode() {
    return { kind: 'unavailable' };
  },
};

export function getPublicTrackingGateway(): PublicTrackingGateway {
  if (backendKind === null || backendKind === 'mock') {
    return unavailablePublicTrackingGateway;
  }
  return createPublicTrackingGateway({
    baseUrl: readPublicTrackingWorkerUrl(),
    fetch: globalThis.fetch,
  });
}
