import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import { parseStaffProfile } from '../src/staffAuthorization.ts';
import {
  GoogleDriveRequestError,
  type GoogleDriveEvidenceGateway,
} from '../src/googleDriveEvidence.ts';
import type { EvidenceArchiveItem } from '../../src/types/evidenceArchive.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Google Drive evidence archive route tests');

interface State {
  staffBrand: 'bruno-thailand' | 'join-lux-club';
  jobBrand: 'bruno-thailand' | 'join-lux-club' | null;
  configured: boolean;
  sessions: number;
  lists: number;
  downloads: number;
  trashes: number;
}

const archived: EvidenceArchiveItem = {
  archiveId: 'archive-1',
  jobId: 'BRN-2026-000001',
  name: 'claim-video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 42 * 1024 * 1024,
  sourceSizeBytes: 220 * 1024 * 1024,
  uploadedAt: '2026-09-30T05:00:00.000Z',
  uploadedBy: 'staff-1',
  deleteAfter: '2027-09-30T05:00:00.000Z',
  compressed: true,
};

function createHandler(overrides: Partial<State> = {}) {
  const state: State = {
    staffBrand: 'bruno-thailand',
    jobBrand: 'bruno-thailand',
    configured: true,
    sessions: 0,
    lists: 0,
    downloads: 0,
    trashes: 0,
    ...overrides,
  };

  const gateway: GoogleDriveEvidenceGateway = {
    status() {
      return {
        configured: state.configured,
        retentionDays: 365,
        targetMaxBytes: 50 * 1024 * 1024,
      };
    },
    async listForJob(jobId) {
      state.lists += 1;
      return jobId === archived.jobId ? [archived] : [];
    },
    async createUploadSession(jobId, uploadedBy, request) {
      state.sessions += 1;
      return {
        archiveId: `archive-${state.sessions}`,
        uploadUrl: 'https://drive-upload.test/session-1',
        expiresAt: '2026-10-06T05:00:00.000Z',
      };
    },
    async download(jobId, archiveId) {
      state.downloads += 1;
      if (jobId !== archived.jobId || archiveId !== archived.archiveId) {
        throw new Error('not found');
      }
      return {
        item: archived,
        response: new Response('drive-bytes', {
          status: 200,
          headers: { 'Content-Length': '11' },
        }),
      };
    },
    async trash(jobId, archiveId) {
      state.trashes += 1;
      if (jobId !== archived.jobId || archiveId !== archived.archiveId) {
        throw new GoogleDriveRequestError('evidence_not_found', 404);
      }
    },
  };

  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'good-token') throw new Error('invalid token');
        return { uid: 'staff-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          return parseStaffProfile(uid, uid, state.staffBrand, false, false);
        },
        async getServiceJobAuthorization(jobId: string) {
          if (jobId !== 'BRN-2026-000001' || state.jobBrand === null) {
            return null;
          }
          return { id: jobId, brandId: state.jobBrand };
        },
      }) as unknown as FirestoreClient,
    createDriveEvidenceGateway: () => gateway,
  };

  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'https://app.test',
    FIRESTORE_PROJECT_ID: 'test-project',
  };

  return { handler: createWorkerHandler(dependencies), env, state };
}

async function request(
  context: ReturnType<typeof createHandler>,
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? 'good-token' : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await context.handler.fetch!(
    new Request(`https://worker.test${path}`, {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    }),
    context.env,
    {} as ExecutionContext
  );
  return response;
}

{
  const context = createHandler();
  const response = await request(context, 'GET', '/evidence-archive/status', {
    token: null,
  });
  check('status requires staff authentication', response.status === 401);
}

{
  const context = createHandler({ configured: false });
  const response = await request(context, 'GET', '/evidence-archive/status');
  const body = (await response.json()) as { configured?: boolean };
  check('authorized status returns 200', response.status === 200);
  check('status can safely report not configured', body.configured === false);
}

{
  const context = createHandler({ jobBrand: 'join-lux-club' });
  const response = await request(
    context,
    'GET',
    '/service-jobs/BRN-2026-000001/evidence-archive'
  );
  check('cross-brand archive list is forbidden', response.status === 403);
  check('cross-brand request never reaches Drive', context.state.lists === 0);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'GET',
    '/service-jobs/BRN-2026-000001/evidence-archive'
  );
  const body = (await response.json()) as { items?: EvidenceArchiveItem[] };
  check('authorized archive list returns 200', response.status === 200);
  check('archive list returns linked metadata', body.items?.[0]?.archiveId === 'archive-1');
}

{
  const context = createHandler();
  const response = await request(
    context,
    'POST',
    '/service-jobs/BRN-2026-000001/evidence-archive/sessions',
    {
      body: {
        version: 1,
        fileName: 'claim-video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 42 * 1024 * 1024,
        sourceSizeBytes: 220 * 1024 * 1024,
        compressed: true,
      },
    }
  );
  const body = (await response.json()) as { uploadUrl?: string };
  check('authorized resumable session returns 201', response.status === 201);
  check('session returns HTTPS direct Drive capability', body.uploadUrl?.startsWith('https://') === true);
  check('session reaches Drive gateway exactly once', context.state.sessions === 1);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'POST',
    '/service-jobs/BRN-2026-000001/evidence-archive/sessions',
    {
      body: {
        version: 1,
        fileName: 'too-large.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 56 * 1024 * 1024,
        sourceSizeBytes: 56 * 1024 * 1024,
        compressed: false,
      },
    }
  );
  check('prepared file above 55 MiB is rejected', response.status === 400);
  check('invalid session performs no Drive call', context.state.sessions === 0);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'GET',
    '/service-jobs/BRN-2026-000001/evidence-archive/archive-1/download'
  );
  check('authorized archive download returns 200', response.status === 200);
  check(
    'download content type comes from verified metadata',
    response.headers.get('Content-Type') === 'video/mp4'
  );
  check(
    'download is private/no-store',
    response.headers.get('Cache-Control') === 'private, no-store'
  );
  check('download bytes are proxied only after authorization', (await response.text()) === 'drive-bytes');
}

{
  const context = createHandler();
  const response = await request(
    context,
    'DELETE',
    '/service-jobs/BRN-2026-000001/evidence-archive/archive-1'
  );
  check('authorized archive trash returns 204', response.status === 204);
  check('authorized archive trash reaches Drive exactly once', context.state.trashes === 1);
}

{
  const context = createHandler({ jobBrand: 'join-lux-club' });
  const response = await request(
    context,
    'DELETE',
    '/service-jobs/BRN-2026-000001/evidence-archive/archive-1'
  );
  check('cross-brand archive trash is forbidden', response.status === 403);
  check('cross-brand trash never reaches Drive', context.state.trashes === 0);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'DELETE',
    '/service-jobs/BRN-2026-000001/evidence-archive/archive-missing'
  );
  check('missing archive trash fails closed as 404', response.status === 404);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'DELETE',
    '/service-jobs/BRN-2026-000001/evidence-archive/archive-1',
    { token: null }
  );
  check('unauthenticated archive trash fails closed', response.status === 401);
  check('unauthenticated trash never reaches Drive', context.state.trashes === 0);
}

{
  const context = createHandler();
  const response = await request(
    context,
    'POST',
    '/service-jobs/BRN-2026-000001/evidence-archive/sessions',
    {
      token: null,
      body: {
        version: 1,
        fileName: 'claim-video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        sourceSizeBytes: 1024,
        compressed: false,
      },
    }
  );
  check('unauthenticated session creation fails closed', response.status === 401);
  check('unauthenticated session never reaches Drive', context.state.sessions === 0);
}

if (failures > 0) {
  console.error(`Google Drive evidence route tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Google Drive evidence route tests passed');
}
