import {
  fetchWithWorkerToken,
  type WorkerTokenProvider,
} from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import type {
  EvidenceArchiveItem,
  EvidenceArchiveStatus,
  EvidenceArchiveUploadSession,
} from '../types';
import type { EvidenceArchiveRepository } from './types';
import type { EvidenceArchiveSessionRequest } from '../services/evidenceArchive';

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export function createWorkerEvidenceArchiveRepository(
  tokenProvider: WorkerTokenProvider
): EvidenceArchiveRepository {
  const baseUrl = getFilesWorkerBaseUrl();

  const request = async (path: string, init: RequestInit): Promise<Response> => {
    const response = await fetchWithWorkerToken(tokenProvider, `${baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`Evidence archive request failed: ${await readError(response)}`);
    }
    return response;
  };

  return {
    async getStatus(): Promise<EvidenceArchiveStatus> {
      const response = await request('/evidence-archive/status', {
        method: 'GET',
      });
      return await readJson<EvidenceArchiveStatus>(response);
    },

    async listForJob(jobId: string): Promise<EvidenceArchiveItem[]> {
      const response = await request(
        `/service-jobs/${encodeURIComponent(jobId)}/evidence-archive`,
        { method: 'GET' }
      );
      const body = await readJson<{ items?: EvidenceArchiveItem[] }>(response);
      return Array.isArray(body.items) ? body.items : [];
    },

    async createUploadSession(
      jobId: string,
      sessionRequest: EvidenceArchiveSessionRequest
    ): Promise<EvidenceArchiveUploadSession> {
      const response = await request(
        `/service-jobs/${encodeURIComponent(jobId)}/evidence-archive/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionRequest),
        }
      );
      return await readJson<EvidenceArchiveUploadSession>(response);
    },

    async download(jobId: string, archiveId: string): Promise<Blob> {
      const response = await request(
        `/service-jobs/${encodeURIComponent(jobId)}/evidence-archive/${encodeURIComponent(archiveId)}/download`,
        { method: 'GET' }
      );
      return await response.blob();
    },
  };
}
