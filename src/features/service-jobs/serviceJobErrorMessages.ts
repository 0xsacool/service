const CREATE_ERROR_MESSAGE = 'ไม่สามารถสร้างงานบริการได้ กรุณาลองอีกครั้ง';
const UPDATE_ERROR_MESSAGE = 'ไม่สามารถบันทึกการเปลี่ยนแปลงได้ กรุณาลองอีกครั้ง';

export function serviceJobCreateErrorMessage(error: unknown): string {
  void error;
  return CREATE_ERROR_MESSAGE;
}

export function serviceJobUpdateErrorMessage(error: unknown): string {
  void error;
  return UPDATE_ERROR_MESSAGE;
}
