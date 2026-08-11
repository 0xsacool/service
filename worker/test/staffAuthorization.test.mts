import {
  createFirebaseTokenVerifier,
  FirebaseSigningKeyCache,
  FirebaseTokenVerificationError,
  type FirebaseSigningKeyFetcher,
} from '../src/firebaseAuth.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';

const PROJECT_ID = 'luxace-service';
const NOW_MS = Date.parse('2026-08-09T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function encodeBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: 'staff-uid-1',
    exp: NOW_SECONDS + 3600,
    iat: NOW_SECONDS - 60,
    auth_time: NOW_SECONDS - 120,
    ...overrides,
  };
}

async function signToken(
  claims = validClaims(),
  header: Record<string, unknown> = { alg: 'RS256', kid: 'key-1', typ: 'JWT' }
): Promise<string> {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedClaims = encodeBase64Url(JSON.stringify(claims));
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keyPair.privateKey, signed)
  );
  return `${encodedHeader}.${encodedClaims}.${encodeBase64Url(signature)}`;
}

function keyFetcher(
  keys: ReadonlyMap<string, JsonWebKey>,
  maxAgeSeconds = 3600
): FirebaseSigningKeyFetcher {
  return { async fetch() { return { keys, maxAgeSeconds }; } };
}

function verifierWithKeys(keys = new Map([['key-1', publicJwk]])) {
  return createFirebaseTokenVerifier({
    keyCache: new FirebaseSigningKeyCache(keyFetcher(keys), () => NOW_MS),
    now: () => NOW_MS,
  });
}

async function rejectsToken(label: string, token: string): Promise<void> {
  let rejected = false;
  try {
    await verifierWithKeys().verify(token, PROJECT_ID);
  } catch (error) {
    rejected = error instanceof FirebaseTokenVerificationError;
  }
  check(label, rejected);
}

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running staff authorization regression test');

check('missing Authorization is not a bearer token',
  (await import('../src/firebaseAuth.ts')).readBearerToken(null) === null);
check('malformed bearer header is rejected',
  (await import('../src/firebaseAuth.ts')).readBearerToken('Basic token') === null);
await rejectsToken('malformed JWT is rejected', 'not-a-jwt');
await rejectsToken('unsupported algorithm is rejected', await signToken(validClaims(), { alg: 'HS256', kid: 'key-1' }));
await rejectsToken('missing kid is rejected', await signToken(validClaims(), { alg: 'RS256' }));
const signedForSignatureTest = await signToken();
const signatureParts = signedForSignatureTest.split('.');
const signature = signatureParts[2] ?? '';
const changedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
await rejectsToken(
  'invalid signature is rejected',
  `${signatureParts[0]}.${signatureParts[1]}.${changedSignature}`
);
await rejectsToken('expired token is rejected', await signToken(validClaims({ exp: NOW_SECONDS - 1 })));
await rejectsToken('wrong audience is rejected', await signToken(validClaims({ aud: 'other-project' })));
await rejectsToken('wrong issuer is rejected', await signToken(validClaims({ iss: 'https://securetoken.google.com/other-project' })));
await rejectsToken('future iat is rejected', await signToken(validClaims({ iat: NOW_SECONDS + 1 })));
await rejectsToken('future auth_time is rejected', await signToken(validClaims({ auth_time: NOW_SECONDS + 1 })));

const validToken = await signToken();
const validVerified = await verifierWithKeys().verify(validToken, PROJECT_ID);
check('valid signed Firebase token is accepted', validVerified.uid === 'staff-uid-1');

let refreshCalls = 0;
const refreshCache = new FirebaseSigningKeyCache(
  {
    async fetch() {
      refreshCalls += 1;
      return {
        keys: refreshCalls === 1 ? new Map() : new Map([['key-1', publicJwk]]),
        maxAgeSeconds: 3600,
      };
    },
  },
  () => NOW_MS
);
const refreshedVerifier = createFirebaseTokenVerifier({ keyCache: refreshCache, now: () => NOW_MS });
check(
  'unknown kid refreshes signing keys before acceptance',
  (await refreshedVerifier.verify(validToken, PROJECT_ID)).uid === 'staff-uid-1' && refreshCalls === 2
);

const failingVerifier = createFirebaseTokenVerifier({
  keyCache: new FirebaseSigningKeyCache(
    { async fetch() { throw new Error('offline'); } },
    () => NOW_MS
  ),
  now: () => NOW_MS,
});
let keyFetchFailedClosed = false;
try {
  await failingVerifier.verify(validToken, PROJECT_ID);
} catch (error) {
  keyFetchFailedClosed = error instanceof FirebaseTokenVerificationError;
}
check('signing-key fetch failure fails closed', keyFetchFailedClosed);

interface FakeAuthorizationData {
  profile: { uid: string; brandId: string } | null;
  serviceJob: { id: string; brandId: string | null } | null;
  requestedJobs: string[];
}

class FakeBucket {
  puts = 0;
  gets = 0;
  deletes = 0;

  async put(): Promise<{ size: number }> {
    this.puts += 1;
    return { size: 4 };
  }

  async get(): Promise<{ size: number; body: ReadableStream; writeHttpMetadata(headers: Headers): void } | null> {
    this.gets += 1;
    return {
      size: 4,
      body: new Blob(['file']).stream(),
      writeHttpMetadata(headers) {
        headers.set('Content-Type', 'application/pdf');
      },
    };
  }

  async delete(): Promise<void> {
    this.deletes += 1;
  }
}

function createHandler(data: FakeAuthorizationData) {
  const bucket = new FakeBucket();
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token === 'token-that-must-not-appear') {
          throw new FirebaseTokenVerificationError();
        }
        return { uid: 'staff-uid-1' };
      },
    },
    createFirestoreClient: () =>
      ({
        async getStaffProfile(uid: string) {
          if (!data.profile) return null;
          if (data.profile.uid !== uid) return null;
          if (data.profile.brandId === 'bruno-thailand') {
            return { uid, brandId: 'bruno-thailand' as const };
          }
          return data.profile.brandId === 'join-lux-club'
            ? { uid, brandId: 'join-lux-club' as const }
            : null;
        },
        async getServiceJobAuthorization(jobId: string) {
          data.requestedJobs.push(jobId);
          if (!data.serviceJob) return null;
          if (data.serviceJob.id !== jobId) return null;
          if (data.serviceJob.brandId === 'bruno-thailand') {
            return { id: jobId, brandId: 'bruno-thailand' as const };
          }
          return data.serviceJob.brandId === 'join-lux-club'
            ? { id: jobId, brandId: 'join-lux-club' as const }
            : { id: jobId, brandId: null };
        },
      }) as unknown as FirestoreClient,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: bucket as unknown as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: PROJECT_ID,
  };
  return { handler: createWorkerHandler(dependencies), env, bucket };
}

function authorizedHeaders(): HeadersInit {
  return { Authorization: 'Bearer offline-test-token' };
}

const key = 'service-jobs/BRN-2026-000001/documents/uuid-file.pdf';
const routeData: FakeAuthorizationData = {
  profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
  serviceJob: { id: 'BRN-2026-000001', brandId: 'bruno-thailand' },
  requestedJobs: [],
};
const { handler, env, bucket } = createHandler(routeData);

const uploadResponse = await handler.fetch(
  new Request(`https://worker.example/files/service-jobs/BRN-2026-000001/documents`, {
    method: 'POST',
    headers: {
      ...authorizedHeaders(),
      'Content-Type': 'application/pdf',
      'X-File-Name': 'test.pdf',
    },
    body: new Blob(['file']),
  }),
  env,
  {} as ExecutionContext
);
check('authorized POST reaches the existing upload path', uploadResponse.status === 201 && bucket.puts === 1);

const unauthorizedUpload = await handler.fetch(
  new Request(`https://worker.example/files/service-jobs/BRN-2026-000001/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'test.pdf' },
    body: new Blob(['file']),
  }),
  env,
  {} as ExecutionContext
);
check('missing Authorization returns 401 before R2 upload', unauthorizedUpload.status === 401 && bucket.puts === 1);

const downloadResponse = await handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  env,
  {} as ExecutionContext
);
check(
  'authorized GET works and derives the owning Service Job from the key',
  downloadResponse.status === 200 && routeData.requestedJobs.includes('BRN-2026-000001')
);

const deleteResponse = await handler.fetch(
  new Request(`https://worker.example/files/${key}`, {
    method: 'DELETE',
    headers: authorizedHeaders(),
  }),
  env,
  {} as ExecutionContext
);
check('authorized DELETE works and uses the path-derived job', deleteResponse.status === 204 && bucket.deletes === 1);

const crossBrand = createHandler({
  profile: { uid: 'staff-uid-1', brandId: 'join-lux-club' },
  serviceJob: { id: 'BRN-2026-000001', brandId: 'bruno-thailand' },
  requestedJobs: [],
});
const crossBrandResponse = await crossBrand.handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  crossBrand.env,
  {} as ExecutionContext
);
check('cross-brand access returns 403 before R2 read', crossBrandResponse.status === 403 && crossBrand.bucket.gets === 0);

const missingProfile = createHandler({
  profile: null,
  serviceJob: { id: 'BRN-2026-000001', brandId: 'bruno-thailand' },
  requestedJobs: [],
});
const missingProfileResponse = await missingProfile.handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  missingProfile.env,
  {} as ExecutionContext
);
check('missing staff profile returns 403 before R2 read', missingProfileResponse.status === 403 && missingProfile.bucket.gets === 0);

const malformedProfile = createHandler({
  profile: { uid: 'staff-uid-1', brandId: 'not-a-brand' },
  serviceJob: { id: 'BRN-2026-000001', brandId: 'bruno-thailand' },
  requestedJobs: [],
});
const malformedProfileResponse = await malformedProfile.handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  malformedProfile.env,
  {} as ExecutionContext
);
check('malformed staff profile returns 403 before R2 read', malformedProfileResponse.status === 403 && malformedProfile.bucket.gets === 0);

const missingJob = createHandler({
  profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
  serviceJob: null,
  requestedJobs: [],
});
const missingJobResponse = await missingJob.handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  missingJob.env,
  {} as ExecutionContext
);
check('missing Service Job returns 403 before R2 read', missingJobResponse.status === 403 && missingJob.bucket.gets === 0);

const legacy = createHandler({
  profile: { uid: 'staff-uid-1', brandId: 'bruno-thailand' },
  serviceJob: { id: 'BRN-2026-000001', brandId: null },
  requestedJobs: [],
});
const legacyResponse = await legacy.handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: authorizedHeaders() }),
  legacy.env,
  {} as ExecutionContext
);
check('legacy Service Job without brandId fails closed with 403', legacyResponse.status === 403 && legacy.bucket.gets === 0);

const unauthenticatedDownload = await handler.fetch(
  new Request(`https://worker.example/files/${key}`),
  env,
  {} as ExecutionContext
);
check('unauthorized GET cannot read R2', unauthenticatedDownload.status === 401 && bucket.gets === 1);

const unauthenticatedDelete = await handler.fetch(
  new Request(`https://worker.example/files/${key}`, { method: 'DELETE' }),
  env,
  {} as ExecutionContext
);
check('unauthorized DELETE cannot delete R2', unauthenticatedDelete.status === 401 && bucket.deletes === 1);

const malformedPath = await handler.fetch(
  new Request('https://worker.example/files/service-jobs/BRN-2026-000001/documents/../../secret', {
    headers: authorizedHeaders(),
  }),
  env,
  {} as ExecutionContext
);
check('malformed path remains rejected before authorization or R2 access', malformedPath.status === 400);

const invalidTokenResponse = await handler.fetch(
  new Request(`https://worker.example/files/${key}`, { headers: { Authorization: 'Bearer token-that-must-not-appear' } }),
  env,
  {} as ExecutionContext
);
check('route errors never echo bearer tokens', !(await invalidTokenResponse.text()).includes('token-that-must-not-appear'));

if (failures > 0) {
  process.exitCode = 1;
  console.error(`staff authorization regression test failed: ${failures} failure(s)`);
} else {
  console.log('staff authorization regression test passed');
}
