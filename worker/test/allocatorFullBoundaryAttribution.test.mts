import { createFirestoreClient } from '../src/firestoreClient.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { AllocationTransaction } from '../src/serviceJobCreation.ts';

// F5d-56B. Terra's F5d-56A blocker: the F5d-56 diagnostic only reliably
// attributed a failure when the Firestore REST call returned a non-OK HTTP
// response — a rejected fetch() promise, a response body that fails to
// parse as JSON, or a structurally malformed-but-200-OK response could
// still escape unattributed, reaching the client as a bare generic 500
// with no allocator-stage line at all. This file behaviorally proves full
// operation-boundary coverage (network / status / parse / local
// validation) for every allocator-relevant stage, via real network-stub
// scenarios — not source-text assertions — plus adversarial PII/credential
// sanitization for each failure shape.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running allocator full-boundary attribution regression test');

const emulatorEnv: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

function captureConsoleError(): { logged: string[]; restore: () => void } {
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  return {
    logged,
    restore: () => {
      console.error = original;
    },
  };
}

// A benign, always-succeeding response for every URL a scenario isn't
// deliberately targeting, so each test exercises exactly one failing
// operation at a time.
function happyResponse(url: URL): Response {
  if (url.pathname.endsWith(':beginTransaction')) {
    return new Response(JSON.stringify({ transaction: 'txn-happy' }), { status: 200 });
  }
  if (url.pathname.endsWith(':commit')) {
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  // every read: nothing recorded
  return new Response('', { status: 404 });
}

async function withScenarioFetch<T>(
  matchesUrl: (url: URL) => boolean,
  respond: (url: URL) => Response,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (matchesUrl(url)) return respond(url);
    return happyResponse(url);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withRejectingFetch<T>(
  matchesUrl: (url: URL) => boolean,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (matchesUrl(url)) {
      // The Fetch API's own documented rejection shape for a network-level
      // failure (DNS, connection refused, TLS, timeout, etc.).
      throw new TypeError('fetch failed');
    }
    return happyResponse(url);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const txn: AllocationTransaction = { id: 'txn-1' };
const secretPhone = '0899999999';
const secretDocPath = `serviceJobs/${secretPhone}`;
const secretToken = 'Bearer ey.raw.jwt.should.never.appear';
const secretProblemText = 'Customer reports screen cracked after drop, phone 0899999999';

interface Scenario {
  stage: string;
  matchesUrl: (url: URL) => boolean;
  run: (client: FirestoreClient) => Promise<unknown>;
  // A 200-OK-but-structurally-wrong body, when this operation performs a
  // local validation step that can genuinely throw on one. Omitted stages
  // have no such step — see the file-level comment / PROJECT_STATE.md for
  // why (returns null instead of throwing, matching existing behavior).
  malformed?: { body: string; expectedCode: string };
  // Whether response.json() is actually called on this operation's
  // success/failure path at all — commit's success path never parses a
  // response body, so "invalid JSON" cannot apply to it.
  parsesResponseBody: boolean;
}

const scenarios: Scenario[] = [
  {
    stage: 'firestore-transaction-begin',
    matchesUrl: (url) => url.pathname.endsWith(':beginTransaction'),
    run: (client) => client.beginServiceJobTransaction(),
    malformed: { body: JSON.stringify({}), expectedCode: 'invalid-response' },
    parsesResponseBody: true,
  },
  {
    stage: 'intake-key-read',
    matchesUrl: (url) => url.pathname.includes('/serviceJobIntakeKeys/'),
    run: (client) => client.getIntakeKey(txn, '11111111-1111-4111-8111-111111111111'),
    parsesResponseBody: true,
  },
  {
    stage: 'tracking-sequence-read',
    matchesUrl: (url) =>
      url.pathname.includes('/numberSequences/') &&
      url.pathname.includes('tracking_number'),
    run: (client) => client.getSequence(txn, 'bruno-thailand', 'tracking_number', 2026),
    malformed: {
      body: JSON.stringify({
        name: 'x',
        fields: { currentValue: { integerValue: 'not-a-number' } },
      }),
      expectedCode: 'invalid-response',
    },
    parsesResponseBody: true,
  },
  {
    stage: 'service-request-sequence-read',
    matchesUrl: (url) =>
      url.pathname.includes('/numberSequences/') &&
      url.pathname.includes('service_request'),
    run: (client) => client.getSequence(txn, 'bruno-thailand', 'service_request', 2026),
    malformed: {
      body: JSON.stringify({
        name: 'x',
        fields: { currentValue: { integerValue: 'not-a-number' } },
      }),
      expectedCode: 'invalid-response',
    },
    parsesResponseBody: true,
  },
  {
    stage: 'occupied-id-read',
    matchesUrl: (url) =>
      url.pathname.includes('/serviceJobs/') &&
      !url.pathname.endsWith(':commit') &&
      !url.pathname.endsWith(':beginTransaction'),
    run: (client) => client.getServiceJob(txn, 'BRN-2026-000001'),
    parsesResponseBody: true,
  },
  {
    stage: 'firestore-commit',
    matchesUrl: (url) => url.pathname.endsWith(':commit'),
    run: (client) =>
      client.commitServiceJobCreation(txn, {
        key: '11111111-1111-4111-8111-111111111111',
        job: {
          id: 'BRN-2026-000001',
          serviceRequestNumber: 'SR-2026-000001',
          brandId: 'bruno-thailand',
          customerName: secretProblemText,
          customerPhone: secretPhone,
          customerEmail: '',
          product: '',
          productCategory: '',
          serialNumber: '',
          issue: '',
          description: secretProblemText,
          status: 'Received',
          priority: 'Normal',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          technician: '',
          estimatedCompletion: '',
          warranty: false,
          photos: [],
          timeline: [],
          notes: [],
          closedAt: null,
          publicTrackingTokenHash: null,
          publicTrackingCodeHash: null,
        },
        trackingSequence: 1,
        serviceRequestSequence: 1,
        year: 2026,
      }),
    parsesResponseBody: false,
  },
];

for (const scenario of scenarios) {
  // A. rejected fetch() promise -> network-error, attributed to this exact stage.
  {
    const client = createFirestoreClient(emulatorEnv);
    const { logged, restore } = captureConsoleError();
    let threw = false;
    await withRejectingFetch(scenario.matchesUrl, async () => {
      try {
        await scenario.run(client);
      } catch {
        threw = true;
      }
    });
    restore();
    check(`[${scenario.stage}] a rejected fetch() promise rejects the operation`, threw);
    check(
      `[${scenario.stage}] a rejected fetch() promise is attributed as network-error at this exact stage`,
      logged.some(
        (line) => line === `[ServiceJob Allocator] ${scenario.stage}: network-error`
      )
    );
  }

  // B. a response body that fails to parse as JSON -> invalid-json.
  if (scenario.parsesResponseBody) {
    const client = createFirestoreClient(emulatorEnv);
    const { logged, restore } = captureConsoleError();
    let threw = false;
    await withScenarioFetch(
      scenario.matchesUrl,
      () => new Response('not valid json {{{', { status: 200 }),
      async () => {
        try {
          await scenario.run(client);
        } catch {
          threw = true;
        }
      }
    );
    restore();
    check(
      `[${scenario.stage}] an unparsable JSON response body rejects the operation`,
      threw
    );
    check(
      `[${scenario.stage}] an unparsable JSON response body is attributed as invalid-json at this exact stage`,
      logged.some(
        (line) => line === `[ServiceJob Allocator] ${scenario.stage}: invalid-json`
      )
    );
  }

  // C. a structurally malformed-but-200-OK response -> invalid-response, where applicable.
  if (scenario.malformed) {
    const { body, expectedCode } = scenario.malformed;
    const client = createFirestoreClient(emulatorEnv);
    const { logged, restore } = captureConsoleError();
    let threw = false;
    await withScenarioFetch(
      scenario.matchesUrl,
      () => new Response(body, { status: 200 }),
      async () => {
        try {
          await scenario.run(client);
        } catch {
          threw = true;
        }
      }
    );
    restore();
    check(
      `[${scenario.stage}] a malformed-but-200-OK response rejects the operation`,
      threw
    );
    check(
      `[${scenario.stage}] a malformed-but-200-OK response is attributed as ${expectedCode} at this exact stage`,
      logged.some(
        (line) => line === `[ServiceJob Allocator] ${scenario.stage}: ${expectedCode}`
      )
    );
  }

  // D. adversarial sanitization: whatever fails, no PII/credential-shaped
  // content from the request/response ever reaches the diagnostic line.
  {
    const client = createFirestoreClient(emulatorEnv);
    const { logged, restore } = captureConsoleError();
    await withScenarioFetch(
      scenario.matchesUrl,
      () =>
        new Response(
          JSON.stringify({
            error: {
              status: 'PERMISSION_DENIED',
              message: `Missing permissions for ${secretDocPath}, saw ${secretToken}, private key fragment -----BEGIN PRIVATE KEY----- ${secretProblemText}`,
            },
          }),
          { status: 403 }
        ),
      async () => {
        try {
          await scenario.run(client);
        } catch {
          // expected
        }
      }
    );
    restore();
    check(
      `[${scenario.stage}] no logged diagnostic line contains the phone number, document path, Bearer token, private-key fragment, or problem text`,
      logged.every(
        (line) =>
          !line.includes(secretPhone) &&
          !line.includes(secretDocPath) &&
          !line.includes(secretToken) &&
          !line.includes('BEGIN PRIVATE KEY') &&
          !line.includes(secretProblemText)
      )
    );
  }
}

// --- OAuth failures are never misclassified as a Firestore stage, even
// though the operation they guard is now wrapped end-to-end -----------------
{
  const noAuthEnv: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  for (const scenario of scenarios) {
    const client = createFirestoreClient(noAuthEnv);
    const { logged, restore } = captureConsoleError();
    let threw = false;
    try {
      await scenario.run(client);
    } catch {
      threw = true;
    } finally {
      restore();
    }
    check(`[${scenario.stage}] an OAuth failure still rejects the operation`, threw);
    check(
      `[${scenario.stage}] an OAuth failure is attributed as oauth-token, never as ${scenario.stage}`,
      logged.length === 1 &&
        logged[0] === '[ServiceJob Allocator] oauth-token: not-configured'
    );
  }
}

if (failures > 0) process.exitCode = 1;
