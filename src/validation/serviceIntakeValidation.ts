import type { ServiceIntakeData } from '../types';
import { isValidCalendarDate, isValidHttpsUrl } from '../utils/serviceEventValidation';

// Minimum bar for "intake complete enough to move to Save & Print": the
// staff member must have recorded what's wrong, via free text or at least
// one quick-problem chip. Accessories, internal notes, and photos are all
// explicitly optional per Sprint 3's scope, so they don't gate the reveal.
// F5d-69's contact/order/evidence fields are recommended, not required
// (DECISIONS.md #041), so they never gate this reveal either — only
// serviceIntakeMetadataError() below blocks an actual save, and only when
// an entered value is genuinely invalid, never merely absent.
export function isServiceIntakeComplete(intake: ServiceIntakeData): boolean {
  return intake.problemDescription.trim().length > 0 || intake.problemChips.length > 0;
}

// F5d-69 — the one pre-send gate for the contact/order/evidence fields,
// mirroring the same checks their own edit sections show inline: a blank
// value is never an error (every one of these fields is optional), but a
// non-blank value that fails real calendar/URL validity must block the
// save rather than reach the Worker/Rules and fail the whole write over one
// bad field. Shared by New Service Job intake (below) and Service Job
// Details' save path (ServiceJobDetails.tsx), which both narrow their own
// state down to this exact shape before calling it.
export function serviceEventMetadataDraftError(draft: {
  purchaseDate: string;
  orderDeliveredDate: string;
  externalEvidenceUrl: string;
}): string | null {
  if (draft.purchaseDate !== '' && !isValidCalendarDate(draft.purchaseDate)) {
    return 'วันที่ซื้อไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }
  if (draft.orderDeliveredDate !== '' && !isValidCalendarDate(draft.orderDeliveredDate)) {
    return 'วันที่ลูกค้าได้รับสินค้าไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }
  if (
    draft.externalEvidenceUrl.trim() !== '' &&
    !isValidHttpsUrl(draft.externalEvidenceUrl.trim())
  ) {
    return 'ลิงก์หลักฐานเพิ่มเติมต้องเป็นลิงก์ https:// ที่ถูกต้อง';
  }
  return null;
}

export function serviceIntakeMetadataError(intake: ServiceIntakeData): string | null {
  return serviceEventMetadataDraftError(intake);
}
