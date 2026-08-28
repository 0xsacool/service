import type { ApprovalDecisionGuardReason } from '../../hooks/useApprovalConsoleReads';

// Duplicated from src/features/service-jobs/components/serviceReportUi.ts by
// design: no feature folder in this codebase imports another feature's
// components (service-jobs and master-data never cross-import either), and
// these two label maps are the entire overlap — duplicating two small const
// objects preserves that isolation rather than opening a new cross-feature
// dependency for this phase.
export const SERVICE_ACTION_LABELS = {
  repair: 'ซ่อม',
  'replace-part': 'เปลี่ยนอะไหล่',
  'replace-product': 'เปลี่ยนสินค้า',
  'claim-factory': 'ส่งเคลมโรงงาน',
  'return-to-customer': 'ส่งคืนลูกค้า',
} as const;

export const RESULT_STATUS_LABELS = {
  repaired: 'ซ่อมเสร็จแล้ว',
  'awaiting-part': 'รออะไหล่',
  'sent-for-claim': 'ส่งเคลมแล้ว',
  replaced: 'เปลี่ยนแล้ว',
  returned: 'ส่งคืนแล้ว',
  'unable-to-repair': 'ไม่สามารถซ่อมได้',
} as const;

// D25 — every ApprovalDecisionGuardError.reason mapped to a Thai sentence.
// The guard itself (evaluateApprovalDecisionGuard) remains the authoritative
// boundary; this is presentation only.
export const GUARD_REASON_MESSAGES: Record<ApprovalDecisionGuardReason, string> = {
  'review-missing': 'ยังไม่ได้โหลดข้อมูลใบรายงาน กรุณาลองใหม่',
  'review-loading': 'กำลังโหลดข้อมูลใบรายงาน กรุณารอสักครู่',
  'review-stale': 'ข้อมูลอาจไม่เป็นปัจจุบัน กรุณารีเฟรชก่อนดำเนินการ',
  'review-superseded': 'มีการเปลี่ยนรายการที่เลือกไปแล้ว กรุณาเลือกใหม่',
  'review-identity-mismatch': 'ข้อมูลไม่ตรงกับรายการที่เลือก กรุณาลองใหม่',
  'review-not-pending': 'ใบรายงานนี้ถูกดำเนินการไปแล้ว',
  'decision-in-flight': 'กำลังดำเนินการอยู่ กรุณารอสักครู่',
  'decision-invalid': 'คำขอไม่ถูกต้อง',
  'rejection-reason-required': 'กรุณาระบุเหตุผลในการปฏิเสธ',
  'rejection-reason-not-allowed': 'ไม่ต้องระบุเหตุผลสำหรับการอนุมัติ',
};

// Phase 6R-B.2 (SF-3) — the safe UI error boundary for evidence resolution.
// Everything below getDownloadUrl() can put infrastructure detail into a
// thrown Error's message: workerAttachmentsRepository interpolates the raw
// canonical R2 key into its "no such attachment exists" error, and its
// readErrorMessage() forwards the Worker/provider response body verbatim.
// None of that may reach an approver's screen, so this maps by error TYPE
// only and never reads .message — the returned string is always one of the
// two constants below, which is what makes the privacy property provable
// rather than merely likely.
export const EVIDENCE_ERROR_MESSAGES = {
  cancelled: 'การเปิดหลักฐานถูกยกเลิก',
  unavailable: 'ไม่สามารถเปิดหลักฐานได้ กรุณาลองใหม่อีกครั้ง',
} as const;

export function safeEvidenceErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : null;
  return name === 'AbortError'
    ? EVIDENCE_ERROR_MESSAGES.cancelled
    : EVIDENCE_ERROR_MESSAGES.unavailable;
}
