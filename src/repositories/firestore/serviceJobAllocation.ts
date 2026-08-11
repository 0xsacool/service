import { getBrandCode, type BrandId } from '../../types';
import { bangkokNumberingYear } from '../../services/bangkokTime';

export const SERVICE_JOB_SEQUENCE_WIDTH = 6;
export const MAX_SERVICE_JOB_COLLISION_CHECKS = 32;
const MAX_SEQUENCE_VALUE = 999999;

function formatSequence(prefix: string, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Service Job numbering year is invalid');
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE_VALUE) {
    throw new Error('Service Job number sequence is malformed or exhausted');
  }
  return `${prefix}-${year}-${String(sequence).padStart(SERVICE_JOB_SEQUENCE_WIDTH, '0')}`;
}

export function formatServiceJobTrackingNumber(
  brandId: BrandId,
  year: number,
  sequence: number
): string {
  return formatSequence(getBrandCode(brandId), year, sequence);
}

export function formatServiceRequestNumber(year: number, sequence: number): string {
  return formatSequence('SR', year, sequence);
}

export function nextServiceJobSequence(currentValue: unknown): number {
  const current = currentValue ?? 0;
  if (
    typeof current !== 'number' ||
    !Number.isInteger(current) ||
    current < 0 ||
    current >= MAX_SEQUENCE_VALUE
  ) {
    throw new Error('Service Job number sequence is malformed or exhausted');
  }
  return current + 1;
}

export async function findAvailableServiceJobTrackingNumber(
  brandId: BrandId,
  year: number,
  firstSequence: number,
  isOccupied: (trackingNumber: string) => Promise<boolean>
): Promise<{ trackingNumber: string; sequence: number }> {
  let sequence = firstSequence;
  for (let attempt = 0; attempt < MAX_SERVICE_JOB_COLLISION_CHECKS; attempt += 1) {
    const trackingNumber = formatServiceJobTrackingNumber(brandId, year, sequence);
    if (!(await isOccupied(trackingNumber))) {
      return { trackingNumber, sequence };
    }
    sequence = nextServiceJobSequence(sequence);
  }
  throw new Error(
    `Cannot allocate Service Job number: ${MAX_SERVICE_JOB_COLLISION_CHECKS} occupied candidates`
  );
}

export function serviceJobNumberingYear(createdAt: string): number {
  const date = new Date(`${createdAt}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Service Job createdAt is invalid for numbering');
  }
  return bangkokNumberingYear(date);
}
