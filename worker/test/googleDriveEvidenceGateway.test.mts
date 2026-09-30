import type { Env } from '../src/env.ts';
import {
  __resetGoogleDriveTokenCacheForTests,
  createGoogleDriveEvidenceGateway,
} from '../src/googleDriveEvidence.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running Google Drive evidence gateway tests');

const baseEnv: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'https://app.test',
  FIRESTORE_PROJECT_ID: 'test-project',
  GOOGLE_DRIVE_CLIENT_ID: 'drive-client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'drive-client-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'drive-refresh-token',
  GOOGLE_DRIVE_TOKEN_ENDPOINT: 'https://oauth.test/token',
};

{
  __resetGoogleDriveTokenCacheForTests();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === 'https://oauth.test/token') {
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    }

    if (
      url.startsWith('https://www.googleapis.com/drive/v3/files?') &&
      (init.method === undefined || init.method === 'GET')
    ) {
      return Response.json({ files: [] });
    }

    if (
      url.startsWith('https://www.googleapis.com/drive/v3/files?') &&
      init.method === 'POST'
    ) {
      const body = JSON.parse(String(init.body)) as {
        name?: string;
        appProperties?: Record<string, string>;
      };
      return Response.json({
        id:
          body.appProperties?.serviceTechArchiveRoot === 'v1'
            ? 'root-folder'
            : 'job-folder',
        name: body.name,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: body.appProperties,
      });
    }

    if (
      url.startsWith(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable'
      )
    ) {
      return new Response(null, {
        status: 200,
        headers: { Location: 'https://upload.test/resumable/session-1' },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const gateway = createGoogleDriveEvidenceGateway(baseEnv, { fetch: fetchMock });
  const session = await gateway.createUploadSession(
    'BRN-2026-000001',
    'staff-1',
    {
      version: 1,
      fileName: 'อาการเครื่อง.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 42 * 1024 * 1024,
      sourceSizeBytes: 240 * 1024 * 1024,
      compressed: true,
    }
  );

  check('gateway returns resumable HTTPS session', session.uploadUrl === 'https://upload.test/resumable/session-1');
  check('gateway creates opaque archive id', /^[0-9a-f-]{36}$/i.test(session.archiveId));

  const tokenCall = calls.find((call) => call.url === 'https://oauth.test/token');
  const tokenBody = new URLSearchParams(String(tokenCall?.init.body ?? ''));
  check('OAuth refresh uses configured client id', tokenBody.get('client_id') === 'drive-client-id');
  check('OAuth refresh uses refresh_token grant', tokenBody.get('grant_type') === 'refresh_token');

  const resumableCall = calls.find((call) =>
    call.url.startsWith(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable'
    )
  );
  const metadata = JSON.parse(String(resumableCall?.init.body ?? '{}')) as {
    parents?: string[];
    appProperties?: Record<string, string>;
  };
  check('evidence upload is placed in job folder', metadata.parents?.[0] === 'job-folder');
  check('metadata links file to Service Job', metadata.appProperties?.serviceTechJobId === 'BRN-2026-000001');
  check('metadata records authoritative uploader uid', metadata.appProperties?.serviceTechUploadedBy === 'staff-1');
  check('metadata records compression state', metadata.appProperties?.serviceTechCompressed === 'true');
  check('metadata records original source size', metadata.appProperties?.serviceTechSourceSizeBytes === String(240 * 1024 * 1024));
  check('metadata carries one-year deleteAfter timestamp', typeof metadata.appProperties?.serviceTechDeleteAfter === 'string' && metadata.appProperties.serviceTechDeleteAfter.startsWith('2027-'));
  check('resumable request declares prepared size', new Headers(resumableCall?.init.headers).get('X-Upload-Content-Length') === String(42 * 1024 * 1024));
}

{
  __resetGoogleDriveTokenCacheForTests();
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);
    if (url === 'https://oauth.test/token') {
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      return Response.json({
        files: [
          {
            id: 'drive-file-1',
            name: 'claim.pdf',
            mimeType: 'application/pdf',
            size: '2048',
            createdTime: '2026-09-30T05:00:00.000Z',
            appProperties: {
              serviceTechJobId: 'BRN-2026-000001',
              serviceTechKind: 'evidence',
              serviceTechArchiveId: 'archive-1',
              serviceTechUploadedBy: 'staff-1',
              serviceTechDeleteAfter: '2027-09-30T05:00:00.000Z',
              serviceTechSourceSizeBytes: '2048',
              serviceTechCompressed: 'false',
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const gateway = createGoogleDriveEvidenceGateway(baseEnv, { fetch: fetchMock });
  const items = await gateway.listForJob('BRN-2026-000001');
  check('Drive list maps only app-owned evidence metadata', items.length === 1);
  check('Drive list preserves archive id', items[0]?.archiveId === 'archive-1');
  check('Drive list exposes retention timestamp', items[0]?.deleteAfter === '2027-09-30T05:00:00.000Z');
}

{
  const gateway = createGoogleDriveEvidenceGateway({
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'https://app.test',
    FIRESTORE_PROJECT_ID: 'test-project',
  });
  check('gateway status fails closed when OAuth secrets are absent', gateway.status().configured === false);
}

if (failures > 0) {
  console.error(`Google Drive evidence gateway tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Google Drive evidence gateway tests passed');
}
