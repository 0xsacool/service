import type { ServiceJobStatus } from '../types';
import { isTerminalServiceJobStatus } from '../validation';

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTrustworthyServiceJobClosedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function needsTrustedClosedAt(
  currentStatus: ServiceJobStatus,
  storedClosedAt: unknown,
  nextStatus: ServiceJobStatus
): boolean {
  return (
    !isTerminalServiceJobStatus(currentStatus) &&
    isTerminalServiceJobStatus(nextStatus) &&
    (storedClosedAt === null || storedClosedAt === undefined)
  );
}
