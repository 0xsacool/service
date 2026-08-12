import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import {
  constantTimeEqualPublicTrackingHashes,
  generatePublicTrackingToken,
  hashPublicTrackingToken,
  revokePublicTrackingToken,
  rotatePublicTrackingToken,
  verifyPublicTrackingToken,
} from '../src/publicTrackingToken.ts';
import type { PublicTrackingServiceJobRecord } from '../src/publicTracking.ts';
import type { PublicTrackingCodeLookupRecord } from '../src/publicTracking.ts';
import { hashPublicTrackingCode } from '../../src/services/publicTrackingCode.ts';

const PROJECT_ID = 'luxace-service';
const REFERENCE = 'BRN-2026-000123';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

class FakeBucket {
  gets = 0;
  puts = 0;
  deletes = 0;

  async get(): Promise<null> {
    this.gets += 1;
    return null;
  }

  async put(): Promise<never> {
    this.puts += 1;
    throw new Error('Public tracking must not write R2');
  }

  async delete(): Promise<void> {
    this.deletes += 1;
  }
}

interface FakeData {
  record: PublicTrackingServiceJobRecord | null;
  lookups: string[];
  codeLookups: string[];
  codeRecord: PublicTrackingCodeLookupRecord | null;
  staffVerifierCalls: number;
  attachmentCalls: number;
}

function createHandler(data: FakeData, allow = true): { handler: ReturnType<typeof createWorkerHandler>; env: Env; bucket: FakeBucket } {
  const bucket = new FakeBucket();
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify() {
        data.staffVerifierCalls += 1;
        throw new Error('Public tracking must not invoke staff verification');
      },
    },
    createFirestoreClient: () =>
      ({
        async getPublicTrackingServiceJob(reference: string) {
          data.lookups.push(reference);
          return reference === REFERENCE ? data.record : null;
        },
        async getPublicTrackingCode(code: string) {
          data.codeLookups.push(code);
          return code === 'SRV-2026-0810-K7M2QX' ? data.codeRecord : null;
        },
        async listAttachments() {
          data.attachmentCalls += 1;
          throw new Error('Public tracking must not scan attachments');
        },
        async getAttachment() {
          data.attachmentCalls += 1;
          throw new Error('Public tracking must not read attachment metadata');
        },
      }) as unknown as FirestoreClient,
    publicTrackingRateLimiter: { async allow() { return allow; } },
  };
  return {
    handler: createWorkerHandler(dependencies),
    env: {
      ATTACHMENTS_BUCKET: bucket as unknown as R2Bucket,
      ALLOWED_ORIGINS: 'http://localhost:5173',
      FIRESTORE_PROJECT_ID: PROJECT_ID,
      // Deferred routes default off. The legacy behaviour tests opt in
      // explicitly so they remain coverage for a future approved activation.
      PUBLIC_TRACKING_ENABLED: 'true',
    },
    bucket,
  };
}

function request(reference: string, token: string, bodyOverride?: BodyInit): Request {
  return new Request(`https://worker.example/public/tracking/${reference}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ignored-by-public-route' },
    body: bodyOverride ?? JSON.stringify({ token }),
  });
}

console.log('Running public tracking regression test');

const token = generatePublicTrackingToken();
const secondToken = generatePublicTrackingToken();
const tokenHash = await hashPublicTrackingToken(token);
check('generated tokens are distinct URL-safe 256-bit values', token !== secondToken && token.length === 43);
check('hashing is stable', tokenHash === (await hashPublicTrackingToken(token)));
check('constant-time helper accepts identical hashes', constantTimeEqualPublicTrackingHashes(tokenHash, tokenHash));
check('constant-time helper rejects different hashes', !constantTimeEqualPublicTrackingHashes(tokenHash, await hashPublicTrackingToken(secondToken)));
check('token verification accepts the matching token', await verifyPublicTrackingToken(token, tokenHash));
check('token verification rejects a wrong token', !(await verifyPublicTrackingToken(secondToken, tokenHash)));
check('raw token differs from its stored hash representation', token !== tokenHash);
const rotated = await rotatePublicTrackingToken();
check(
  'rotation issues a replacement token/hash pair without reusing the prior token',
  rotated.token !== token && (await verifyPublicTrackingToken(rotated.token, rotated.tokenHash))
);
check(
  'rotation invalidates the prior token when its replacement hash is stored',
  !(await verifyPublicTrackingToken(token, rotated.tokenHash))
);
check(
  'revocation clears the hash and rejects the prior token',
  revokePublicTrackingToken() === null && !(await verifyPublicTrackingToken(token, null))
);

const record: PublicTrackingServiceJobRecord = {
  id: REFERENCE,
  publicTrackingTokenHash: tokenHash,
  publicTrackingCodeHash: null,
  status: 'In Repair',
  productName: 'Bruno Vacuum',
  productModelOrSku: 'BR-100',
  serialNumber: 'SERIAL-1234',
  timeline: [{ status: 'Received', occurredAt: '2026-08-01T09:00' }],
  updatedAt: '2026-08-09T10:00:00.000Z',
};
const data: FakeData = {
  record,
  lookups: [],
  codeLookups: [],
  codeRecord: { serviceJobId: REFERENCE },
  staffVerifierCalls: 0,
  attachmentCalls: 0,
};
const { handler, env, bucket } = createHandler(data);
const response = await handler.fetch(request(REFERENCE, token), env, {} as ExecutionContext);
const payload = (await response.json()) as Record<string, unknown>;
check('valid token returns only the approved public DTO',
  response.status === 200 &&
    JSON.stringify(Object.keys(payload).sort()) ===
      JSON.stringify(['lastUpdatedAt', 'maskedSerial', 'productModelOrSku', 'productName', 'publicTimeline', 'status', 'trackingReference']) &&
    payload.maskedSerial === '••••1234' &&
    !JSON.stringify(payload).includes(token) &&
    !JSON.stringify(payload).includes(tokenHash) &&
    !JSON.stringify(payload).includes('SERIAL-1234')
);
check('public route does one direct reference lookup only', data.lookups.length === 1 && data.lookups[0] === REFERENCE);
check(
  'public route never invokes staff verification, attachment access, or R2',
  data.staffVerifierCalls === 0 &&
    data.attachmentCalls === 0 &&
    bucket.gets === 0 &&
    bucket.puts === 0 &&
    bucket.deletes === 0
);

const wrongTokenResponse = await handler.fetch(request(REFERENCE, secondToken), env, {} as ExecutionContext);
const missingRecordResponse = await handler.fetch(request('BRN-2026-000999', token), env, {} as ExecutionContext);
check('wrong token and missing record produce the same generic response',
  wrongTokenResponse.status === 404 &&
    missingRecordResponse.status === 404 &&
    (await wrongTokenResponse.text()) === (await missingRecordResponse.text())
);

const invalidBodyResponse = await handler.fetch(
  request(REFERENCE, token, JSON.stringify({ token, extra: 'not accepted' })),
  env,
  {} as ExecutionContext
);
check('malformed public request body fails generically before lookup', invalidBodyResponse.status === 404 && data.lookups.length === 3);

const missingTokenResponse = await handler.fetch(
  request(REFERENCE, token, JSON.stringify({})),
  env,
  {} as ExecutionContext
);
check('missing public token fails generically before lookup', missingTokenResponse.status === 404 && data.lookups.length === 3);

const tooLargeResponse = await handler.fetch(
  request(REFERENCE, token, JSON.stringify({ token, padding: 'x'.repeat(2000) })),
  env,
  {} as ExecutionContext
);
check('oversized public request body fails generically before lookup', tooLargeResponse.status === 404 && data.lookups.length === 3);

const limited = createHandler(
  { record, lookups: [], staffVerifierCalls: 0, attachmentCalls: 0 },
  false
);
const limitedResponse = await limited.handler.fetch(request(REFERENCE, token), limited.env, {} as ExecutionContext);
check('rate-limit seam can fail closed without a lookup', limitedResponse.status === 404);

const nonPost = await handler.fetch(
  new Request(`https://worker.example/public/tracking/${REFERENCE}`),
  env,
  {} as ExecutionContext
);
check('non-POST public tracking requests do not reach the lookup', nonPost.status === 404 && data.lookups.length === 3);

const code = 'SRV-2026-0810-K7M2QX';
record.publicTrackingCodeHash = await hashPublicTrackingCode(code);
const codeResponse = await handler.fetch(
  new Request('https://worker.example/public/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }),
  env,
  {} as ExecutionContext
);
const codePayload = (await codeResponse.json()) as Record<string, unknown>;
check(
  'valid manual code returns only the unchanged public DTO',
  codeResponse.status === 200 &&
    codePayload.trackingReference === REFERENCE &&
    !JSON.stringify(codePayload).includes(code) &&
    !JSON.stringify(codePayload).includes(record.publicTrackingCodeHash)
);
check(
  'manual code performs one direct index lookup and one exact Service Job read',
  data.codeLookups.length === 1 && data.codeLookups[0] === code &&
    data.lookups.length === 4 && data.lookups[3] === REFERENCE
);

const invalidCodeResponse = await handler.fetch(
  new Request('https://worker.example/public/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'BRN-2026-000001' }),
  }),
  env,
  {} as ExecutionContext
);
check(
  'legacy sequential references and malformed manual codes fail generically',
  invalidCodeResponse.status === 404 && data.codeLookups.length === 1
);

if (failures > 0) {
  process.exitCode = 1;
  console.error(`public tracking regression test failed: ${failures} failure(s)`);
} else {
  console.log('public tracking regression test passed');
}
