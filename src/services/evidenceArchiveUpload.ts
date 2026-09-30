import type { EvidenceArchiveRepository } from '../repositories/types';
import type { PreparedEvidenceArchiveFile } from '../types';

export interface EvidenceArchiveUploadProgress {
  loadedBytes: number;
  totalBytes: number;
  ratio: number;
}

export async function uploadPreparedEvidenceArchiveFile(input: {
  jobId: string;
  file: PreparedEvidenceArchiveFile;
  repository: EvidenceArchiveRepository;
  onProgress?: (progress: EvidenceArchiveUploadProgress) => void;
  xhrFactory?: () => XMLHttpRequest;
}): Promise<string> {
  const session = await input.repository.createUploadSession(input.jobId, {
    version: 1,
    fileName: input.file.name,
    mimeType: input.file.mimeType,
    sizeBytes: input.file.preparedSizeBytes,
    sourceSizeBytes: input.file.sourceSizeBytes,
    compressed: input.file.compressed,
  });

  const xhr = (input.xhrFactory ?? (() => new XMLHttpRequest()))();

  await new Promise<void>((resolve, reject) => {
    xhr.open('PUT', session.uploadUrl, true);
    xhr.setRequestHeader('Content-Type', input.file.mimeType);

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : input.file.preparedSizeBytes;
      input.onProgress?.({
        loadedBytes: event.loaded,
        totalBytes: total,
        ratio: total > 0 ? Math.min(1, event.loaded / total) : 0,
      });
    };

    xhr.onerror = () => {
      reject(new Error('การอัปโหลดไป Google Drive ขาดการเชื่อมต่อ'));
    };
    xhr.onabort = () => {
      reject(new Error('การอัปโหลดถูกยกเลิก'));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.({
          loadedBytes: input.file.preparedSizeBytes,
          totalBytes: input.file.preparedSizeBytes,
          ratio: 1,
        });
        resolve();
      } else {
        reject(
          new Error(`Google Drive ปฏิเสธการอัปโหลด (HTTP ${xhr.status || 'unknown'})`)
        );
      }
    };

    xhr.send(input.file.blob);
  });

  return session.archiveId;
}
