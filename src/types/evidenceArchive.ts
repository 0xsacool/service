export interface EvidenceArchiveItem {
  archiveId: string;
  jobId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sourceSizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  deleteAfter: string;
  compressed: boolean;
}

export interface EvidenceArchiveStatus {
  configured: boolean;
  retentionDays: number;
  targetMaxBytes: number;
}

export interface EvidenceArchiveUploadSession {
  archiveId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface PreparedEvidenceArchiveFile {
  blob: Blob;
  name: string;
  mimeType: string;
  sourceSizeBytes: number;
  preparedSizeBytes: number;
  compressed: boolean;
  durationSeconds: number | null;
}
