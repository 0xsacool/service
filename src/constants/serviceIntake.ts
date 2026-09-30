import type { ServiceIntakeData } from '../types';

export interface ServiceIntakeChipOption {
  value: string;
  label: string;
}

// Persisted values intentionally remain the existing English canonical strings
// so old Service Jobs, reports and search/summary behavior stay compatible.
// Only the staff-facing labels are localized to Thai.
export const PROBLEM_CHIPS: readonly ServiceIntakeChipOption[] = [
  { value: "Won't power on", label: 'เปิดเครื่องไม่ติด' },
  { value: 'No heating', label: 'ไม่ร้อน' },
  { value: 'Fan not spinning', label: 'พัดลมไม่หมุน' },
  { value: 'Error Code', label: 'ขึ้นรหัสผิดพลาด' },
  { value: 'Broken', label: 'แตก / หัก' },
  { value: 'Other', label: 'อื่น ๆ' },
] as const;

export const OTHER_ACCESSORY_VALUE = 'Other';
export const OTHER_ACCESSORY_PREFIX = 'Other: ';

export const ACCESSORY_CHIPS: readonly ServiceIntakeChipOption[] = [
  { value: 'Main Unit', label: 'ตัวเครื่อง' },
  { value: 'Power Cord', label: 'สายไฟ' },
  { value: 'Lid', label: 'ฝาปิด' },
  { value: 'Tray', label: 'ถาด' },
  { value: 'Manual', label: 'คู่มือ' },
  { value: 'Box', label: 'กล่อง' },
  { value: 'Measuring Cup', label: 'ถ้วยตวง' },
  { value: OTHER_ACCESSORY_VALUE, label: 'อื่น ๆ' },
] as const;

export function isOtherAccessorySelection(value: string): boolean {
  return value === OTHER_ACCESSORY_VALUE || value.startsWith(OTHER_ACCESSORY_PREFIX);
}

export function getOtherAccessoryText(accessories: readonly string[]): string {
  const custom = accessories.find((value) => value.startsWith(OTHER_ACCESSORY_PREFIX));
  return custom ? custom.slice(OTHER_ACCESSORY_PREFIX.length) : '';
}

export function normalizeServiceIntakeAccessories(
  accessories: readonly string[]
): string[] {
  return accessories.map((value) =>
    value.startsWith(OTHER_ACCESSORY_PREFIX)
      ? `${OTHER_ACCESSORY_PREFIX}${value.slice(OTHER_ACCESSORY_PREFIX.length).trim()}`
      : value
  );
}

export const RECOMMENDED_PHOTO_CHECKLIST = [
  'ตัวสินค้า',
  'จุดที่เสียหาย',
  'หมายเลขเครื่อง',
] as const;

// Factory, not a shared constant object — every call returns fresh arrays so
// resetting intake state (Change Customer / Change Product) can never leak
// a mutation across separate drafts.
export function createEmptyServiceIntake(): ServiceIntakeData {
  return {
    problemDescription: '',
    problemChips: [],
    accessories: [],
    internalNotes: '',
    photos: [],
    contactChannel: null,
    contactChannelIdentity: '',
    orderNumber: '',
    purchaseDate: '',
    orderDeliveredDate: '',
    externalEvidenceUrl: '',
    externalEvidenceNote: '',
  };
}
