export const EVIDENCE_ARCHIVE_RETENTION_DAYS = 365;
export const EVIDENCE_ARCHIVE_TARGET_BYTES = 45 * 1024 * 1024;
export const EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES = 55 * 1024 * 1024;
export const EVIDENCE_ARCHIVE_MAX_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
export const EVIDENCE_ARCHIVE_MAX_VIDEO_DURATION_SECONDS = 30 * 60;
export const EVIDENCE_ARCHIVE_MAX_FILE_NAME_CHARS = 180;

export interface EvidenceArchiveSessionRequest {
  version: 1;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceSizeBytes: number;
  compressed: boolean;
}

function safeFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > EVIDENCE_ARCHIVE_MAX_FILE_NAME_CHARS
  ) {
    return null;
  }
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 0x1f) || code === 0x7f || char === '/' || char === '\\') {
      return null;
    }
  }
  return normalized;
}

export function isAllowedEvidenceArchiveMimeType(value: string): boolean {
  return (
    value.startsWith('video/') ||
    value.startsWith('image/') ||
    value === 'application/pdf'
  );
}

export function parseEvidenceArchiveSessionRequest(
  input: unknown
): EvidenceArchiveSessionRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const allowed = new Set([
    'version',
    'fileName',
    'mimeType',
    'sizeBytes',
    'sourceSizeBytes',
    'compressed',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key)) || raw.version !== 1) {
    return null;
  }
  const fileName = safeFileName(raw.fileName);
  const mimeType =
    typeof raw.mimeType === 'string' && isAllowedEvidenceArchiveMimeType(raw.mimeType)
      ? raw.mimeType
      : null;
  const sizeBytes =
    typeof raw.sizeBytes === 'number' &&
    Number.isSafeInteger(raw.sizeBytes) &&
    raw.sizeBytes > 0 &&
    raw.sizeBytes <= EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES
      ? raw.sizeBytes
      : null;
  const sourceSizeBytes =
    typeof raw.sourceSizeBytes === 'number' &&
    Number.isSafeInteger(raw.sourceSizeBytes) &&
    raw.sourceSizeBytes > 0 &&
    raw.sourceSizeBytes <= EVIDENCE_ARCHIVE_MAX_SOURCE_BYTES
      ? raw.sourceSizeBytes
      : null;
  if (
    !fileName ||
    !mimeType ||
    sizeBytes === null ||
    sourceSizeBytes === null ||
    typeof raw.compressed !== 'boolean' ||
    (raw.compressed && sourceSizeBytes < sizeBytes)
  ) {
    return null;
  }
  return {
    version: 1,
    fileName,
    mimeType,
    sizeBytes,
    sourceSizeBytes,
    compressed: raw.compressed,
  };
}

export function evidenceArchiveDeleteAfter(
  now: Date,
  retentionDays = EVIDENCE_ARCHIVE_RETENTION_DAYS
): string {
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export function evidenceArchiveFileNameWithMp4Extension(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem || 'evidence'}.mp4`;
}
