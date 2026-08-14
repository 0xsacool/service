import { filesBackendConfiguration, type FilesBackendKind } from './filesBackend';

export const APPROVED_PRODUCTION_FILES_WORKER_URL =
  'https://service-tech-files-worker.sacool-spizy.workers.dev';

export type FilesWorkerUrlConfiguration =
  | { valid: true; baseUrl: string | null; error: null }
  | { valid: false; baseUrl: null; error: string };

function parseWorkerOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveFilesWorkerUrlConfiguration(
  raw: string | undefined,
  isProduction: boolean,
  filesBackendKind: FilesBackendKind | null
): FilesWorkerUrlConfiguration {
  if (filesBackendKind !== 'worker') {
    return { valid: true, baseUrl: null, error: null };
  }

  const trimmed = raw?.trim();
  if (!trimmed) {
    return {
      valid: false,
      baseUrl: null,
      error: 'VITE_FILES_WORKER_URL is required when VITE_FILES_BACKEND=worker.',
    };
  }

  const origin = parseWorkerOrigin(trimmed);
  if (!origin) {
    return {
      valid: false,
      baseUrl: null,
      error: 'VITE_FILES_WORKER_URL must be a valid Worker origin.',
    };
  }

  if (isProduction && origin !== APPROVED_PRODUCTION_FILES_WORKER_URL) {
    return {
      valid: false,
      baseUrl: null,
      error: 'Production VITE_FILES_WORKER_URL is not the approved Worker origin.',
    };
  }

  return { valid: true, baseUrl: origin, error: null };
}

export const filesWorkerUrlConfiguration = resolveFilesWorkerUrlConfiguration(
  import.meta.env.VITE_FILES_WORKER_URL,
  import.meta.env.PROD,
  filesBackendConfiguration.kind
);

export function getFilesWorkerBaseUrl(): string {
  if (!filesWorkerUrlConfiguration.valid || !filesWorkerUrlConfiguration.baseUrl) {
    throw new Error(
      filesWorkerUrlConfiguration.error ?? 'Files Worker URL is not configured.'
    );
  }
  return filesWorkerUrlConfiguration.baseUrl;
}
