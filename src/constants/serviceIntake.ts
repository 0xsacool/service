import type { ServiceIntakeData } from '../types';

// Example chip vocabulary as specified for Sprint 3. Note these read as
// small-appliance service categories (heating, fan, lid, tray, measuring
// cup) rather than the consumer-electronics catalog the rest of the mock
// data uses (iPhone/MacBook/AirPods/etc.). Implemented verbatim per spec —
// flagged in the Sprint 3 report as a product-category mismatch worth
// resolving, not silently reconciled here.
export const PROBLEM_CHIPS = [
  "Won't power on",
  'No heating',
  'Fan not spinning',
  'Error Code',
  'Broken',
  'Other',
] as const;

export const ACCESSORY_CHIPS = [
  'Main Unit',
  'Power Cord',
  'Lid',
  'Tray',
  'Manual',
  'Box',
  'Measuring Cup',
  'Other',
] as const;

export const RECOMMENDED_PHOTO_CHECKLIST = [
  'Product',
  'Damaged Area',
  'Serial Number',
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
