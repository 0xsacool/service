import type { WarrantyStatus } from '../types';

export function addMonths(isoDate: string, months: number): string {
  const date = new Date(isoDate);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function warrantyStatusFor(warrantyExpiresAt: string): WarrantyStatus {
  return new Date(warrantyExpiresAt).getTime() >= Date.now()
    ? 'in_warranty'
    : 'out_of_warranty';
}
