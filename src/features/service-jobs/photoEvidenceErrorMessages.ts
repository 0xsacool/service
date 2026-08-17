import {
  ImageDecodeError,
  ImageTooLargeError,
  type PhotoSubmissionValidationFailure,
} from '../../services/imageEvidenceProcessing';

const DECODE_ERROR_MESSAGE = 'ไม่สามารถประมวลผลรูปภาพนี้ได้ กรุณาลองไฟล์รูปภาพอื่น';
const TOO_LARGE_ERROR_MESSAGE = 'รูปภาพนี้มีขนาดใหญ่เกินไป แม้จะบีบอัดแล้ว กรุณาลองรูปภาพอื่น';
const AGGREGATE_TOO_LARGE_MESSAGE =
  'รูปภาพทั้งหมดที่เลือกมีขนาดรวมใหญ่เกินไป กรุณาลบบางรูปก่อนเพิ่มรูปใหม่';
const TOO_MANY_PHOTOS_MESSAGE = 'เลือกรูปภาพได้สูงสุด 10 รูปต่องานบริการ';
const GENERIC_PROCESSING_ERROR_MESSAGE = 'ไม่สามารถเพิ่มรูปภาพนี้ได้ กรุณาลองอีกครั้ง';

// Only known, safe, actionable local image conditions get a specific
// message — an unrecognized error still falls back to a generic photo-scoped
// message, never the raw error, matching serviceJobCreateErrorMessage's
// existing "never leak internal detail" convention.
export function photoProcessingErrorMessage(error: unknown): string {
  if (error instanceof ImageDecodeError) return DECODE_ERROR_MESSAGE;
  if (error instanceof ImageTooLargeError) return TOO_LARGE_ERROR_MESSAGE;
  return GENERIC_PROCESSING_ERROR_MESSAGE;
}

export function photoValidationErrorMessage(
  reason: PhotoSubmissionValidationFailure['reason']
): string {
  switch (reason) {
    case 'photo-too-large':
      return TOO_LARGE_ERROR_MESSAGE;
    case 'aggregate-too-large':
      return AGGREGATE_TOO_LARGE_MESSAGE;
    case 'too-many-photos':
      return TOO_MANY_PHOTOS_MESSAGE;
  }
}
