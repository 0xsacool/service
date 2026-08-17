const CREATE_ERROR_MESSAGE = 'ไม่สามารถสร้างงานบริการได้ กรุณาลองอีกครั้ง';
const UPDATE_ERROR_MESSAGE = 'ไม่สามารถบันทึกการเปลี่ยนแปลงได้ กรุณาลองอีกครั้ง';
// F5d-67 Phase 2R — a known, safe, actionable local condition (the whole
// serialized request exceeds the Worker's intake ceiling), distinct from
// serviceJobCreateErrorMessage's generic unknown/internal-error fallback,
// which remains unchanged below.
const INTAKE_TOO_LARGE_MESSAGE =
  'ข้อมูลและรูปภาพที่กรอกมีขนาดรวมใหญ่เกินไป กรุณาลดจำนวนหรือขนาดรูปภาพ';

export function serviceJobCreateErrorMessage(error: unknown): string {
  void error;
  return CREATE_ERROR_MESSAGE;
}

export function serviceJobUpdateErrorMessage(error: unknown): string {
  void error;
  return UPDATE_ERROR_MESSAGE;
}

export function serviceJobIntakeTooLargeMessage(): string {
  return INTAKE_TOO_LARGE_MESSAGE;
}
