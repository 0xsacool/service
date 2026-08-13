import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';

// F5d-56D. Terra's F5d-56C finding: getServiceJob() delegated to
// getDocument(..., 'occupied-id-read') for the network read, but then
// called parseServiceJobDocument(doc) *outside* that wrap. A structurally
// malformed-but-HTTP-200 Firestore response (Terra reproduced this with
// the body `{}`) makes parseServiceJobDocument() throw a genuine
// TypeError — `doc.name.split('/')` on a document with no `name` field —
// which escaped both the read-level wrap (the read itself succeeded; it's
// a genuinely 200-OK, validly-JSON response) and any outer wrap (there
// wasn't one), reaching handleServiceJobCreate()'s catch-all as a bare,
// unattributed generic 500 with zero `[ServiceJob Allocator]` lines.
//
// This test proves the exact scenario Terra specified end to end against
// the real createFirestoreClient() implementation, with only the network
// boundary stubbed — not source-text assertions.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running allocator occupied-ID parser attribution regression test');

const emulatorEnv: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  // FIRESTORE_EMULATOR_HOST set: getAccessToken() returns null (no real
  // Google token exchange, no OAuth failure possible here) — "OAuth
  // succeeds / is stubbed safely" per Objective 5.
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

const secretPhone = '0899999999';
const secretDocPath = `serviceJobs/${secretPhone}`;
const secretToken = 'Bearer ey.raw.jwt.should.never.appear';

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  if (url.pathname.includes('/serviceJobs/BRN-2026-000001')) {
    // A genuinely 200-OK, validly-JSON, but structurally malformed
    // Firestore document response — Terra's exact reproduction body.
    return new Response('{}', { status: 200 });
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

const originalConsoleError = console.error;
const logged: string[] = [];
console.error = (...args: unknown[]) => {
  logged.push(args.map(String).join(' '));
};

let caughtError: unknown;
let threw = false;
try {
  const client = createFirestoreClient(emulatorEnv);
  await client.getServiceJob({ id: 'txn-1' }, 'BRN-2026-000001');
} catch (error) {
  threw = true;
  caughtError = error;
} finally {
  console.error = originalConsoleError;
  globalThis.fetch = originalFetch;
}

check('getServiceJob() rejects on the malformed-but-200-OK response', threw);
check(
  'the rejection is the ORIGINAL parser TypeError, never wrapped/replaced (identity, instanceof, and stack all untouched)',
  caughtError instanceof TypeError &&
    caughtError.name === 'TypeError' &&
    typeof caughtError.stack === 'string'
);

// The console.error lines this run actually produced — includes both this
// module's own '[files-worker] ...' style logs (there are none on this
// path) and the '[ServiceJob Allocator] ...' diagnostic lines.
const allocatorLines = logged.filter((line) => line.startsWith('[ServiceJob Allocator]'));

check(
  'exactly ONE [ServiceJob Allocator] diagnostic line is emitted for this single failure',
  allocatorLines.length === 1
);
check(
  'the one line is attributed to stage occupied-id-read',
  allocatorLines[0]?.startsWith('[ServiceJob Allocator] occupied-id-read:')
);
check(
  'the safe code is invalid-response, not network-error (a parser failure must not be misread as a network failure)',
  allocatorLines[0] === '[ServiceJob Allocator] occupied-id-read: invalid-response'
);
check(
  'no logged line contains the raw malformed response body text',
  !logged.some((line) => line.includes('{}'))
);
check(
  'no logged line contains a Firestore document path, a Bearer-token-shaped value, or the occupied phone-shaped string',
  logged.every(
    (line) =>
      !line.includes(secretDocPath) &&
      !line.includes(secretToken) &&
      !line.includes(secretPhone)
  )
);

if (failures > 0) process.exitCode = 1;
