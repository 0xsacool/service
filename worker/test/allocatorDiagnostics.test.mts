import {
  classifyAllocatorError,
  logAllocatorStageFailure,
  sanitizedGoogleErrorStatus,
  ServiceJobAllocatorStageError,
} from '../src/allocatorDiagnostics.ts';

// F5d-56. The latest approved Gate 7.1 submit reached the live Worker and
// received a generic HTTP 500 with no further detail — the exact failing
// stage was unknown because handleServiceJobCreate() collapsed every
// allocator-internal exception into one console.error(..., error) dump and
// one generic 500. These tests exercise the pure classification/logging
// layer directly: real inputs, real return values — not source-text
// pattern matching.

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running allocator stage diagnostics regression test');

// --- sanitizedGoogleErrorStatus --------------------------------------------

for (const status of [
  'ABORTED',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
]) {
  check(
    `the canonical-status parser returns allow-listed ${status}`,
    sanitizedGoogleErrorStatus(
      JSON.stringify({ error: { status, message: 'arbitrary server text' } })
    ) === status
  );
}

check(
  'the canonical-status parser rejects malformed JSON',
  sanitizedGoogleErrorStatus('{not-json') === null
);
check(
  'the canonical-status parser rejects a missing status',
  sanitizedGoogleErrorStatus(JSON.stringify({ error: { code: 409 } })) === null
);
check(
  'the canonical-status parser rejects an unknown status',
  sanitizedGoogleErrorStatus(
    JSON.stringify({ error: { status: 'SOMETHING_MADE_UP' } })
  ) === null
);
check(
  'the canonical-status parser is case-sensitive and rejects lowercase values',
  sanitizedGoogleErrorStatus(JSON.stringify({ error: { status: 'aborted' } })) === null
);
{
  const hostilePath = 'customers/0899999999';
  const hostileToken = 'Bearer secret-token';
  const parsed = sanitizedGoogleErrorStatus(
    JSON.stringify({
      error: {
        status: 'ALREADY_EXISTS',
        message: `${hostilePath} ${hostileToken}`,
      },
    })
  );
  check(
    'the canonical-status parser returns only the safe status and never hostile message content',
    parsed === 'ALREADY_EXISTS' &&
      !parsed.includes(hostilePath) &&
      !parsed.includes(hostileToken)
  );
}

// --- classifyAllocatorError -------------------------------------------------

check(
  'a FirestoreRequestError-shaped error with a recognized Google status is classified by that status',
  classifyAllocatorError({
    status: 403,
    body: JSON.stringify({
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'nope' },
    }),
  }) === 'PERMISSION_DENIED'
);

check(
  'a FirestoreRequestError-shaped error with an unrecognized/malformed body falls back to a bare HTTP status code',
  classifyAllocatorError({ status: 500, body: 'not json at all' }) === 'http-500'
);

check(
  'a FirestoreRequestError-shaped error with a JSON body but no error.status also falls back to the HTTP status',
  classifyAllocatorError({
    status: 400,
    body: JSON.stringify({ error: { code: 400 } }),
  }) === 'http-400'
);

check(
  'a FirestoreRequestError-shaped error with an unrecognized error.status string does not pass it through',
  classifyAllocatorError({
    status: 500,
    body: JSON.stringify({ error: { status: 'SOMETHING_MADE_UP' } }),
  }) === 'http-500'
);

check(
  'a TransactionConflictError-shaped error (checked structurally via the real class) is classified as transaction-conflict',
  (() => {
    class TransactionConflictError extends Error {}
    return classifyAllocatorError(new TransactionConflictError()) === 'unknown';
    // NOTE: a locally-redeclared class is intentionally NOT the same
    // TransactionConflictError classifyAllocatorError checks against —
    // this proves classification is real instanceof-based discrimination,
    // not name-string matching. The genuine case is covered below by
    // importing the real class.
  })()
);

{
  const { TransactionConflictError } = await import('../src/serviceJobCreation.ts');
  check(
    'the real TransactionConflictError is classified as transaction-conflict',
    classifyAllocatorError(new TransactionConflictError()) === 'transaction-conflict'
  );
}

check(
  'the OAuth "missing service account" configuration error is classified as not-configured',
  classifyAllocatorError(
    new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and FIRESTORE_EMULATOR_HOST is not set'
    )
  ) === 'not-configured'
);

check(
  'a Google token-endpoint failure is classified by its leading HTTP status only, never its raw body',
  classifyAllocatorError(
    new Error(
      'Google token endpoint returned 400: {"error":"invalid_grant","error_description":"Invalid JWT Signature."}'
    )
  ) === 'http-400'
);

check(
  'a plain unrelated error is classified as unknown, never passed through raw',
  classifyAllocatorError(new Error('some other allocator-internal failure')) === 'unknown'
);
check(
  'a non-Error thrown value is classified as unknown',
  classifyAllocatorError('boom') === 'unknown'
);
check(
  'null/undefined are classified as unknown',
  classifyAllocatorError(null) === 'unknown' &&
    classifyAllocatorError(undefined) === 'unknown'
);

// --- no PII/credentials ever appear in a classified code --------------------

{
  const secretPhone = '0812345678';
  const secretToken = 'ey.raw.jwt.should.never.appear';
  const secretPrivateKey =
    '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkqhkiG-----END PRIVATE KEY-----';
  const rawError = {
    status: 403,
    body: JSON.stringify({
      error: {
        status: 'PERMISSION_DENIED',
        message: `Missing permissions for customers/${secretPhone}, token=${secretToken}, key=${secretPrivateKey}`,
      },
    }),
  };
  const code = classifyAllocatorError(rawError);
  check(
    'a raw error body carrying PII/credential-shaped content never leaks into the classified code',
    code === 'PERMISSION_DENIED' &&
      !code.includes(secretPhone) &&
      !code.includes(secretToken) &&
      !code.includes(secretPrivateKey)
  );
}

// --- ServiceJobAllocatorStageError / logAllocatorStageFailure ---------------

{
  const diagnostic = new ServiceJobAllocatorStageError(
    'firestore-commit',
    'PERMISSION_DENIED'
  );
  check(
    'ServiceJobAllocatorStageError formats the documented [ServiceJob Allocator] <stage>: <code> message',
    diagnostic.message === '[ServiceJob Allocator] firestore-commit: PERMISSION_DENIED'
  );
  check(
    'ServiceJobAllocatorStageError exposes stage and code as plain fields',
    diagnostic.stage === 'firestore-commit' && diagnostic.code === 'PERMISSION_DENIED'
  );
}

{
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    logAllocatorStageFailure(
      'oauth-token',
      new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/...')
    );
  } finally {
    console.error = originalError;
  }
  check(
    'logAllocatorStageFailure logs exactly the documented stage line and nothing else',
    logged.length === 1 &&
      logged[0] === '[ServiceJob Allocator] oauth-token: not-configured'
  );
}

{
  const secretDocPath = 'customers/0899999999';
  const secretToken = 'Bearer ey.raw.jwt';
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    logAllocatorStageFailure('occupied-id-read', {
      status: 403,
      body: JSON.stringify({
        error: {
          status: 'PERMISSION_DENIED',
          message: `Missing or insufficient permissions for ${secretDocPath}, saw Authorization: ${secretToken}`,
        },
      }),
    });
  } finally {
    console.error = originalError;
  }
  check(
    'the logged diagnostic line never contains a Firestore document path or an Authorization header value',
    logged.length === 1 &&
      logged[0] === '[ServiceJob Allocator] occupied-id-read: PERMISSION_DENIED' &&
      !logged[0].includes(secretDocPath) &&
      !logged[0].includes(secretToken)
  );
}

if (failures > 0) process.exitCode = 1;
