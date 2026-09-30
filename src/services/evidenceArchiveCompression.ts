import type { PreparedEvidenceArchiveFile } from '../types/evidenceArchive';
import {
  EVIDENCE_ARCHIVE_MAX_SOURCE_BYTES,
  EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES,
  EVIDENCE_ARCHIVE_MAX_VIDEO_DURATION_SECONDS,
  EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES,
  EVIDENCE_ARCHIVE_TARGET_BYTES,
  evidenceArchiveFileNameWithMp4Extension,
  isAllowedEvidenceArchiveMimeType,
} from './evidenceArchive';

export type EvidenceCompressionStage = 'inspecting' | 'compressing' | 'ready';

export interface EvidenceCompressionProgress {
  stage: EvidenceCompressionStage;
  progress: number;
}

export type EvidenceCompressionErrorCode =
  | 'unsupported_type'
  | 'source_too_large'
  | 'video_too_long'
  | 'codec_unavailable'
  | 'conversion_failed'
  | 'output_too_large';

export class EvidenceCompressionError extends Error {
  public readonly code: EvidenceCompressionErrorCode;

  constructor(
    code: EvidenceCompressionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'EvidenceCompressionError';
    this.code = code;
  }
}

function report(
  callback: ((progress: EvidenceCompressionProgress) => void) | undefined,
  stage: EvidenceCompressionStage,
  progress: number
): void {
  callback?.({ stage, progress: Math.min(1, Math.max(0, progress)) });
}

export async function prepareEvidenceArchiveFile(
  file: File,
  onProgress?: (progress: EvidenceCompressionProgress) => void
): Promise<PreparedEvidenceArchiveFile> {
  report(onProgress, 'inspecting', 0);

  if (!isAllowedEvidenceArchiveMimeType(file.type)) {
    throw new EvidenceCompressionError(
      'unsupported_type',
      'รองรับเฉพาะวิดีโอ รูปภาพ และ PDF'
    );
  }
  if (file.size <= 0 || file.size > EVIDENCE_ARCHIVE_MAX_SOURCE_BYTES) {
    throw new EvidenceCompressionError(
      'source_too_large',
      'ไฟล์ต้นฉบับมีขนาดใหญ่เกินกว่าที่ระบบรองรับ'
    );
  }

  if (!file.type.startsWith('video/')) {
    if (file.size > EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES) {
      throw new EvidenceCompressionError(
        'output_too_large',
        'ไฟล์รูปภาพหรือ PDF ต้องมีขนาดไม่เกิน 55 MB'
      );
    }
    report(onProgress, 'ready', 1);
    return {
      blob: file,
      name: file.name,
      mimeType: file.type,
      sourceSizeBytes: file.size,
      preparedSizeBytes: file.size,
      compressed: false,
      durationSeconds: null,
    };
  }

  if (file.size <= EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES) {
    report(onProgress, 'ready', 1);
    return {
      blob: file,
      name: file.name,
      mimeType: file.type,
      sourceSizeBytes: file.size,
      preparedSizeBytes: file.size,
      compressed: false,
      durationSeconds: null,
    };
  }

  report(onProgress, 'inspecting', 0.25);

  const media = await import('mediabunny');
  const input = new media.Input({
    formats: media.ALL_FORMATS,
    source: new media.BlobSource(file),
  });
  const durationSeconds = await input.computeDuration();
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new EvidenceCompressionError(
      'conversion_failed',
      'ไม่สามารถอ่านระยะเวลาของวิดีโอนี้ได้'
    );
  }
  if (durationSeconds > EVIDENCE_ARCHIVE_MAX_VIDEO_DURATION_SECONDS) {
    throw new EvidenceCompressionError(
      'video_too_long',
      'วิดีโอยาวเกิน 30 นาที กรุณาตัดเฉพาะช่วงที่ใช้เป็นหลักฐานก่อน'
    );
  }

  const canEncodeAvc = await media.canEncodeVideo('avc');
  if (!canEncodeAvc) {
    throw new EvidenceCompressionError(
      'codec_unavailable',
      'เบราว์เซอร์นี้ไม่รองรับการบีบวิดีโอ H.264'
    );
  }
  if (!(await media.canEncodeAudio('aac'))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  if (!(await media.canEncodeAudio('aac'))) {
    throw new EvidenceCompressionError(
      'codec_unavailable',
      'เบราว์เซอร์นี้ไม่รองรับการเข้ารหัสเสียง AAC'
    );
  }

  const audioBitrate = 64_000;
  const targetTotalBitrate = Math.floor(
    (EVIDENCE_ARCHIVE_TARGET_BYTES * 8 * 0.9) / durationSeconds
  );
  const videoBitrate = Math.max(
    180_000,
    Math.min(4_000_000, targetTotalBitrate - audioBitrate)
  );
  const targetHeight = durationSeconds <= 10 * 60 ? 720 : 480;

  const target = new media.BufferTarget();
  const output = new media.Output({
    format: new media.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  const conversion = await media.Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      codec: 'avc',
      height: targetHeight,
      fit: 'contain',
      bitrate: videoBitrate,
      keyFrameInterval: 5,
    },
    audio: {
      codec: 'aac',
      bitrate: audioBitrate,
    },
  }).catch((error: unknown) => {
    throw new EvidenceCompressionError(
      'conversion_failed',
      'ไม่สามารถเตรียมการบีบวิดีโอนี้ได้',
      { cause: error }
    );
  });

  if (!conversion.isValid) {
    throw new EvidenceCompressionError(
      'codec_unavailable',
      'รูปแบบวิดีโอนี้ไม่สามารถบีบได้บนเบราว์เซอร์เครื่องนี้'
    );
  }

  conversion.onProgress = (progress: number) =>
    report(onProgress, 'compressing', progress);
  try {
    await conversion.execute();
  } catch (error) {
    throw new EvidenceCompressionError(
      'conversion_failed',
      'การบีบวิดีโอไม่สำเร็จ กรุณาลองใหม่หรือใช้ไฟล์ที่บีบจากเครื่องแล้ว',
      { cause: error }
    );
  }

  if (!target.buffer) {
    throw new EvidenceCompressionError(
      'conversion_failed',
      'ไม่พบไฟล์วิดีโอหลังการบีบอัด'
    );
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  if (blob.size > EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES) {
    throw new EvidenceCompressionError(
      'output_too_large',
      'วิดีโอหลังบีบยังเกิน 55 MB กรุณาตัดวิดีโอให้สั้นลง'
    );
  }

  report(onProgress, 'ready', 1);
  return {
    blob,
    name: evidenceArchiveFileNameWithMp4Extension(file.name),
    mimeType: 'video/mp4',
    sourceSizeBytes: file.size,
    preparedSizeBytes: blob.size,
    compressed: true,
    durationSeconds,
  };
}
