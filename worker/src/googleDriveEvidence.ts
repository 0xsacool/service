import type { Env } from './env.ts';
import type {
  EvidenceArchiveItem,
  EvidenceArchiveStatus,
  EvidenceArchiveUploadSession,
} from '../../src/types/evidenceArchive.ts';
import {
  EVIDENCE_ARCHIVE_RETENTION_DAYS,
  EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES,
  evidenceArchiveDeleteAfter,
  type EvidenceArchiveSessionRequest,
} from '../../src/services/evidenceArchive.ts';

const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_MARKER_KEY = 'serviceTechArchiveRoot';
const ROOT_MARKER_VALUE = 'v1';
const JOB_MARKER_KEY = 'serviceTechJobId';
const KIND_MARKER_KEY = 'serviceTechKind';
const KIND_JOB_FOLDER = 'job-folder';
const KIND_EVIDENCE = 'evidence';
const ARCHIVE_ID_KEY = 'serviceTechArchiveId';
const UPLOADED_BY_KEY = 'serviceTechUploadedBy';
const DELETE_AFTER_KEY = 'serviceTechDeleteAfter';
const SOURCE_SIZE_KEY = 'serviceTechSourceSizeBytes';
const COMPRESSED_KEY = 'serviceTechCompressed';

interface DriveTokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

interface DriveFileList {
  files?: DriveFile[];
}

interface FetchDependencies {
  fetch: typeof fetch;
}

const browserFetch: FetchDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
};

let cachedDriveToken:
  | { accessToken: string; expiresAtMs: number; refreshTokenMarker: string }
  | null = null;

export class GoogleDriveNotConfiguredError extends Error {
  constructor() {
    super('Google Drive archive is not configured');
    this.name = 'GoogleDriveNotConfiguredError';
  }
}

export class GoogleDriveRequestError extends Error {
  public readonly operation: string;
  public readonly status: number;

  constructor(operation: string, status: number) {
    super(`Google Drive request failed during ${operation}`);
    this.name = 'GoogleDriveRequestError';
    this.operation = operation;
    this.status = status;
  }
}

function driveConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_DRIVE_CLIENT_ID?.trim() &&
      env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() &&
      env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()
  );
}

function refreshTokenMarker(env: Env): string {
  const token = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? '';
  return `${env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? ''}:${token.slice(-12)}:${token.length}`;
}

async function getDriveAccessToken(
  env: Env,
  dependencies: FetchDependencies,
  now = new Date()
): Promise<string> {
  if (!driveConfigured(env)) throw new GoogleDriveNotConfiguredError();

  const marker = refreshTokenMarker(env);
  if (
    cachedDriveToken &&
    cachedDriveToken.refreshTokenMarker === marker &&
    cachedDriveToken.expiresAtMs > now.getTime() + 60_000
  ) {
    return cachedDriveToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_DRIVE_CLIENT_ID!.trim(),
    client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET!.trim(),
    refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN!.trim(),
    grant_type: 'refresh_token',
  });

  const response = await dependencies.fetch(
    env.GOOGLE_DRIVE_TOKEN_ENDPOINT?.trim() || DEFAULT_TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  if (!response.ok) {
    throw new GoogleDriveRequestError('token_refresh', response.status);
  }
  const token = (await response.json()) as Partial<DriveTokenResponse>;
  if (
    typeof token.access_token !== 'string' ||
    typeof token.expires_in !== 'number' ||
    token.expires_in <= 0
  ) {
    throw new GoogleDriveRequestError('token_refresh_shape', 502);
  }

  cachedDriveToken = {
    accessToken: token.access_token,
    expiresAtMs: now.getTime() + token.expires_in * 1000,
    refreshTokenMarker: marker,
  };
  return token.access_token;
}

function queryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveJson<T>(
  dependencies: FetchDependencies,
  token: string,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await dependencies.fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new GoogleDriveRequestError('drive_api', response.status);
  }
  return (await response.json()) as T;
}

async function findFolder(
  dependencies: FetchDependencies,
  token: string,
  markerKey: string,
  markerValue: string
): Promise<DriveFile | null> {
  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    `appProperties has { key='${queryLiteral(markerKey)}' and value='${queryLiteral(markerValue)}' }`,
  ].join(' and ');
  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.set('q', q);
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('pageSize', '10');
  url.searchParams.set('fields', 'files(id,name,mimeType,appProperties)');
  const result = await driveJson<DriveFileList>(
    dependencies,
    token,
    url.toString()
  );
  return result.files?.[0] ?? null;
}

async function createFolder(
  dependencies: FetchDependencies,
  token: string,
  input: {
    name: string;
    parents?: string[];
    appProperties: Record<string, string>;
  }
): Promise<DriveFile> {
  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.set('fields', 'id,name,mimeType,appProperties');
  return await driveJson<DriveFile>(dependencies, token, url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(input.parents ? { parents: input.parents } : {}),
      appProperties: input.appProperties,
    }),
  });
}

async function ensureRootFolder(
  dependencies: FetchDependencies,
  token: string
): Promise<string> {
  const existing = await findFolder(
    dependencies,
    token,
    ROOT_MARKER_KEY,
    ROOT_MARKER_VALUE
  );
  if (existing?.id) return existing.id;

  const created = await createFolder(dependencies, token, {
    name: 'Service Tech Archive',
    appProperties: { [ROOT_MARKER_KEY]: ROOT_MARKER_VALUE },
  });
  if (!created.id) throw new GoogleDriveRequestError('create_root_folder', 502);
  return created.id;
}

async function ensureJobFolder(
  dependencies: FetchDependencies,
  token: string,
  jobId: string
): Promise<string> {
  const existing = await findFolder(dependencies, token, JOB_MARKER_KEY, jobId);
  if (existing?.id && existing.appProperties?.[KIND_MARKER_KEY] === KIND_JOB_FOLDER) {
    return existing.id;
  }

  const rootId = await ensureRootFolder(dependencies, token);
  const created = await createFolder(dependencies, token, {
    name: jobId,
    parents: [rootId],
    appProperties: {
      [JOB_MARKER_KEY]: jobId,
      [KIND_MARKER_KEY]: KIND_JOB_FOLDER,
    },
  });
  if (!created.id) throw new GoogleDriveRequestError('create_job_folder', 502);
  return created.id;
}

function toArchiveItem(jobId: string, file: DriveFile): EvidenceArchiveItem | null {
  const props = file.appProperties ?? {};
  const archiveId = props[ARCHIVE_ID_KEY];
  const uploadedBy = props[UPLOADED_BY_KEY];
  const deleteAfter = props[DELETE_AFTER_KEY];
  const sourceSizeText = props[SOURCE_SIZE_KEY];
  const compressedText = props[COMPRESSED_KEY];
  const sizeBytes = Number(file.size);
  const sourceSizeBytes = Number(sourceSizeText);

  if (
    !file.id ||
    !archiveId ||
    props[JOB_MARKER_KEY] !== jobId ||
    props[KIND_MARKER_KEY] !== KIND_EVIDENCE ||
    !file.name ||
    !file.mimeType ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !Number.isSafeInteger(sourceSizeBytes) ||
    sourceSizeBytes <= 0 ||
    !file.createdTime ||
    !uploadedBy ||
    !deleteAfter ||
    (compressedText !== 'true' && compressedText !== 'false')
  ) {
    return null;
  }

  return {
    archiveId,
    jobId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes,
    sourceSizeBytes,
    uploadedAt: file.createdTime,
    uploadedBy,
    deleteAfter,
    compressed: compressedText === 'true',
  };
}

export interface GoogleDriveEvidenceGateway {
  status(): EvidenceArchiveStatus;
  listForJob(jobId: string): Promise<EvidenceArchiveItem[]>;
  createUploadSession(
    jobId: string,
    uploadedBy: string,
    request: EvidenceArchiveSessionRequest
  ): Promise<EvidenceArchiveUploadSession>;
  download(
    jobId: string,
    archiveId: string
  ): Promise<{ item: EvidenceArchiveItem; response: Response }>;
}

export function createGoogleDriveEvidenceGateway(
  env: Env,
  dependencies: FetchDependencies = browserFetch
): GoogleDriveEvidenceGateway {
  return {
    status() {
      return {
        configured: driveConfigured(env),
        retentionDays: EVIDENCE_ARCHIVE_RETENTION_DAYS,
        targetMaxBytes: EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES,
      };
    },

    async listForJob(jobId) {
      const token = await getDriveAccessToken(env, dependencies);
      const q = [
        'trashed = false',
        `appProperties has { key='${JOB_MARKER_KEY}' and value='${queryLiteral(jobId)}' }`,
        `appProperties has { key='${KIND_MARKER_KEY}' and value='${KIND_EVIDENCE}' }`,
      ].join(' and ');
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set('q', q);
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('pageSize', '100');
      url.searchParams.set(
        'fields',
        'files(id,name,mimeType,size,createdTime,appProperties)'
      );
      url.searchParams.set('orderBy', 'createdTime desc');

      const result = await driveJson<DriveFileList>(
        dependencies,
        token,
        url.toString()
      );
      return (result.files ?? [])
        .map((file) => toArchiveItem(jobId, file))
        .filter((item): item is EvidenceArchiveItem => item !== null);
    },

    async createUploadSession(jobId, uploadedBy, request) {
      const token = await getDriveAccessToken(env, dependencies);
      const jobFolderId = await ensureJobFolder(dependencies, token, jobId);
      const archiveId = crypto.randomUUID();
      const now = new Date();
      const deleteAfter = evidenceArchiveDeleteAfter(now);
      const url = new URL(`${DRIVE_UPLOAD_BASE}/files`);
      url.searchParams.set('uploadType', 'resumable');
      url.searchParams.set(
        'fields',
        'id,name,mimeType,size,createdTime,appProperties'
      );

      const response = await dependencies.fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': request.mimeType,
          'X-Upload-Content-Length': String(request.sizeBytes),
        },
        body: JSON.stringify({
          name: request.fileName,
          parents: [jobFolderId],
          appProperties: {
            [JOB_MARKER_KEY]: jobId,
            [KIND_MARKER_KEY]: KIND_EVIDENCE,
            [ARCHIVE_ID_KEY]: archiveId,
            [UPLOADED_BY_KEY]: uploadedBy,
            [DELETE_AFTER_KEY]: deleteAfter,
            [SOURCE_SIZE_KEY]: String(request.sourceSizeBytes),
            [COMPRESSED_KEY]: String(request.compressed),
          },
        }),
      });
      if (!response.ok) {
        throw new GoogleDriveRequestError('resumable_session', response.status);
      }
      const uploadUrl = response.headers.get('Location');
      if (!uploadUrl?.startsWith('https://')) {
        throw new GoogleDriveRequestError('resumable_session_location', 502);
      }
      return {
        archiveId,
        uploadUrl,
        expiresAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      };
    },

    async download(jobId, archiveId) {
      const items = await this.listForJob(jobId);
      const item = items.find((candidate) => candidate.archiveId === archiveId);
      if (!item) throw new GoogleDriveRequestError('evidence_not_found', 404);

      const token = await getDriveAccessToken(env, dependencies);
      const q = [
        'trashed = false',
        `appProperties has { key='${JOB_MARKER_KEY}' and value='${queryLiteral(jobId)}' }`,
        `appProperties has { key='${ARCHIVE_ID_KEY}' and value='${queryLiteral(archiveId)}' }`,
      ].join(' and ');
      const findUrl = new URL(`${DRIVE_API_BASE}/files`);
      findUrl.searchParams.set('q', q);
      findUrl.searchParams.set('spaces', 'drive');
      findUrl.searchParams.set('pageSize', '2');
      findUrl.searchParams.set('fields', 'files(id,appProperties)');
      const found = await driveJson<DriveFileList>(
        dependencies,
        token,
        findUrl.toString()
      );
      const fileId = found.files?.[0]?.id;
      if (!fileId) throw new GoogleDriveRequestError('evidence_not_found', 404);

      const response = await dependencies.fetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok || !response.body) {
        throw new GoogleDriveRequestError('download', response.status);
      }
      return { item, response };
    },
  };
}

export function __resetGoogleDriveTokenCacheForTests(): void {
  cachedDriveToken = null;
}
