import { TransactionConflictError } from './serviceJobCreation.ts';

// Duck-typed rather than `instanceof FirestoreRequestError` deliberately:
// firestoreClient.ts must import stage-tagging helpers from this module,
// so importing its FirestoreRequestError class back here would create a
// circular module dependency. FirestoreRequestError's actual shape
// (`{status: number, body: string}` alongside the usual Error fields) is
// stable and owned by this codebase, not third-party, so a structural
// check is exactly as reliable here as `instanceof` would be.
function isFirestoreRequestErrorShape(
  error: unknown
): error is { status: number; body: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number' &&
    typeof (error as { body?: unknown }).body === 'string'
  );
}

// F5d-56 — the latest approved Gate 7.1 submit reached the live Worker and
// received a generic HTTP 500 ("Worker Service Job creation failed (500)").
// Production verification confirmed zero durable writes and full
// atomicity (no partial allocator footprint), so the request failed
// somewhere between "Firebase bearer verified" and "commit accepted" — but
// the exact stage is unknown because handleServiceJobCreate() collapsed
// every allocator-internal exception into one console.error(..., error)
// call and one generic 500, discarding exactly the detail needed to
// reproduce and fix it. This module exists purely to make that stage
// observable in the Worker's own logs (`wrangler tail` / Cloudflare logs)
// on the next controlled reproduction — it does not change allocator
// behavior, transaction semantics, or the client-facing response.
//
// Sanitization is deliberately conservative, mirroring
// src/repositories/firestoreInitDiagnostics.ts's allow-list approach on
// the frontend: only a short, enum-like code is ever logged — never a raw
// Authorization header, ID token, service-account private key, access
// token, any intake field (customer name/phone/email/serial/problem
// description/internal note), a raw request body, a Firestore document
// path (this app's customer documents are legacy phone-keyed — see
// DECISIONS.md #031/#039 — so a document path can itself be a phone
// number), or a raw Google API response body.
export type AllocatorStage =
  | 'oauth-token'
  | 'firestore-transaction-begin'
  | 'intake-key-read'
  | 'tracking-sequence-read'
  | 'service-request-sequence-read'
  | 'occupied-id-read'
  | 'firestore-commit'
  | 'response-build';

// Google's standard gRPC-style error `status` values (Firestore REST and
// the OAuth token endpoint both use variants of this shape). Anything else
// — including a missing/non-string status, or one outside this list — is
// reported as 'unknown' rather than passed through, so an unrecognized or
// unexpected error shape can never smuggle arbitrary (potentially
// PII-bearing) content into the diagnostic log line.
const KNOWN_GOOGLE_ERROR_STATUSES: ReadonlySet<string> = new Set([
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
]);

// Google API error bodies are JSON shaped like
// `{"error": {"code": 403, "message": "...", "status": "PERMISSION_DENIED"}}`.
// Only `.error.status` (a short, safe, documented enum value) is ever
// extracted — `.error.message` is never read here, since it can echo back
// request content, including a Firestore document path.
function sanitizedGoogleErrorStatus(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { status?: unknown } };
    const status = parsed?.error?.status;
    return typeof status === 'string' && KNOWN_GOOGLE_ERROR_STATUSES.has(status)
      ? status
      : null;
  } catch {
    return null;
  }
}

// googleAuth.ts's own errors are plain `Error`s with fixed, safe message
// shapes it controls — a static configuration-missing message, or
// `Google token endpoint returned <status>: <body>` (where `<body>` is
// Google's raw OAuth error response and must not be logged). Only the
// leading numeric status is ever extracted from the latter.
const TOKEN_ENDPOINT_STATUS_PATTERN = /^Google token endpoint returned (\d{3}):/;
const MISSING_SERVICE_ACCOUNT_PREFIX = 'Missing GOOGLE_SERVICE_ACCOUNT';

// F5d-56B (Terra F5d-56A blocker): the original classifier only recognized
// errors shaped like a non-OK HTTP response. It had no branch for a
// rejected fetch() promise, a response body that fails to parse as JSON,
// or a structurally malformed-but-200-OK response — every one of those
// would fall through to 'unknown', which the F5d-56 wrapper never even
// caught in the first place (it only wrapped the "!response.ok" branch),
// so these failures could still reach the client as an unattributed
// generic 500. firestoreClient.ts now wraps the FULL operation boundary
// (see runAllocatorStage below), and these branches classify what that
// wider boundary can throw — still only ever a closed, safe code.
//
// These two exact strings are static, developer-authored messages this
// codebase itself throws (never containing interpolated request/response
// data) — see beginServiceJobTransaction()'s "malformed transaction" throw
// and getSequence()'s "malformed sequence" throw. Matched by exact string,
// not by type, since preserving their original `Error` type/instanceof
// behavior unchanged (Objective 3) was preferred over introducing a new
// thrown error subclass at those two call sites.
const KNOWN_MALFORMED_RESPONSE_MESSAGES: ReadonlySet<string> = new Set([
  'Firestore returned malformed transaction',
  'Firestore sequence is malformed',
]);

// F5d-56D (Terra F5d-56C blocker): parseServiceJobDocument() in
// firestoreClient.ts reads `doc.name.split('/')` without optional
// chaining — unlike every other document accessor in that file — so a
// structurally malformed-but-200-OK Firestore response (e.g. `{}`, no
// `name` field) makes it throw a genuine `TypeError`, the exact same
// class fetch() itself rejects with on a real network failure. Without
// an explicit signal, classifyAllocatorError() below cannot tell those
// two apart by type alone and would misreport a parser failure as
// 'network-error'. markAsLocalValidationError() records that a specific
// error object is known to have originated from local
// parsing/validation code, never from a rejected fetch() promise —
// tracked by identity, not by replacing/wrapping the error itself, so
// its `instanceof`, `.stack`, and every other property stay completely
// untouched (Objective 2). Call sites mark an error immediately after
// catching it from a parsing/validation call, before letting it
// propagate further.
const localValidationErrors = new WeakSet<object>();

export function markAsLocalValidationError<E>(error: E): E {
  if (typeof error === 'object' && error !== null) {
    localValidationErrors.add(error);
  }
  return error;
}

// Classifies any error the allocator's Firestore/OAuth transport layer can
// throw into a short, sanitized code — never the raw error, its `.message`
// in full, or a raw Google/Firestore response body. Every branch below
// only ever surfaces a value drawn from a closed, safe set (a 3-digit HTTP
// status, a known Google error status, or a fixed literal) — there is no
// path from here back to arbitrary request/response content.
//
// 'serialization-error' is part of this module's documented safe-code
// vocabulary but is deliberately never produced by a branch below: the
// only local JSON.stringify calls in the allocator's commit path serialize
// values this codebase fully constructs and already validated (numbers,
// bounded strings, a ServiceJob built entirely from sanitized intake
// fields) — no circular reference, BigInt, or function can reach it, so
// there is no realistic input that throws there today (Objective 6/7:
// document rather than add artificial behavior for an untriggerable path).
export function classifyAllocatorError(error: unknown): string {
  if (isFirestoreRequestErrorShape(error)) {
    return sanitizedGoogleErrorStatus(error.body) ?? `http-${error.status}`;
  }
  if (error instanceof TransactionConflictError) {
    return 'transaction-conflict';
  }
  // Checked before the generic TypeError branch below: a marked local
  // validation/parsing failure (e.g. parseServiceJobDocument() throwing on
  // a malformed document) must never be reported as 'network-error' just
  // because it happens to share TypeError's class with a real fetch()
  // rejection (F5d-56D / Terra F5d-56C).
  if (typeof error === 'object' && error !== null && localValidationErrors.has(error)) {
    return 'invalid-response';
  }
  if (error instanceof Error) {
    if (error.message.startsWith(MISSING_SERVICE_ACCOUNT_PREFIX)) {
      return 'not-configured';
    }
    const tokenEndpointMatch = TOKEN_ENDPOINT_STATUS_PATTERN.exec(error.message);
    if (tokenEndpointMatch) {
      return `http-${tokenEndpointMatch[1]}`;
    }
    if (KNOWN_MALFORMED_RESPONSE_MESSAGES.has(error.message)) {
      return 'invalid-response';
    }
    // SyntaxError: response.json()/JSON.parse failing on a non-JSON body.
    // TypeError: the Fetch API's own documented rejection shape for a
    // network-level failure (DNS, connection refused, TLS, etc.) — checked
    // after SyntaxError since SyntaxError does not extend TypeError, so
    // there is no overlap between the two checks. A local-validation
    // TypeError never reaches this branch — it's already returned above.
    if (error instanceof SyntaxError) {
      return 'invalid-json';
    }
    if (error instanceof TypeError) {
      return 'network-error';
    }
  }
  return 'unknown';
}

// A narrow, typed carrier for the sanitized {stage, code} pair — used only
// to produce a consistently formatted diagnostic line (see
// logAllocatorStageFailure below). Never thrown or returned in place of
// the original exception: the original error is always rethrown unchanged
// by the caller immediately after logging, so transaction-conflict
// retries, HTTP status mapping, and every other existing control-flow
// decision that inspects the real error (e.g. `instanceof
// TransactionConflictError`) are completely unaffected by this module.
export class ServiceJobAllocatorStageError extends Error {
  readonly stage: AllocatorStage;
  readonly code: string;

  constructor(stage: AllocatorStage, code: string) {
    super(`[ServiceJob Allocator] ${stage}: ${code}`);
    this.name = 'ServiceJobAllocatorStageError';
    this.stage = stage;
    this.code = code;
  }
}

// F5d-56B (Terra F5d-56A blocker, Objective 2): firestoreClient.ts now
// wraps allocator operations at more than one nesting level in places
// (e.g. getSequence()'s own numeric-validation wrap sits outside
// getDocument()'s read-level wrap) so that a local validation throw
// occurring *after* a successful read is still attributed — but the same
// underlying error object must never be logged twice as it propagates
// through both layers. Tracking already-logged error objects by identity
// (not by stage or message) guarantees exactly one line per real failure,
// always the first/innermost boundary that actually saw it — an OAuth
// failure logged inside getDocument() as 'oauth-token' is never re-logged
// as 'intake-key-read' by an outer wrap that merely rethrows it further.
//
// F5d-56D (Terra F5d-56C, Objective 6 — theoretical, non-blocking):
// WeakSet membership requires an object, so a thrown *primitive*
// (a string/number/boolean) could in principle re-log at each nested
// boundary it passes through, since it can never be added here. Reviewed
// every throw site in worker/src (serviceJobCreation.ts, firestoreClient.ts,
// googleAuth.ts) plus the runtime errors this code can encounter
// (TypeError/SyntaxError from fetch/JSON, both objects) — none throws a
// bare primitive today, so this has no currently-reachable path. Left as
// documented, low-priority future hardening rather than broadening this
// module to guard against a hypothetical caller.
const alreadyLoggedErrors = new WeakSet<object>();

// The one place this module has an observable side effect: a single
// sanitized log line, e.g. "[ServiceJob Allocator] firestore-commit:
// permission-denied". Intentionally log-only — no Firestore write, no
// persisted diagnostic record, nothing that could contribute a partial
// allocator footprint (Objective 6). A TransactionConflictError is never
// logged here — a 409/412 is expected, retried optimistic-concurrency
// behavior (allocateServiceJob() retries it), not a genuine failure to
// diagnose; logging it on every retry attempt would be noise, not signal.
export function logAllocatorStageFailure(stage: AllocatorStage, error: unknown): void {
  if (error instanceof TransactionConflictError) {
    return;
  }
  if (typeof error === 'object' && error !== null) {
    if (alreadyLoggedErrors.has(error)) {
      return;
    }
    alreadyLoggedErrors.add(error);
  }
  const diagnostic = new ServiceJobAllocatorStageError(
    stage,
    classifyAllocatorError(error)
  );
  console.error(diagnostic.message);
}

// F5d-59: allocateServiceJob()'s retry loop (serviceJobCreation.ts) rethrows
// the final attempt's TransactionConflictError exactly the same way it
// rethrows a retryable one — so logAllocatorStageFailure()'s deliberate
// TransactionConflictError skip (above) silences the truly-exhausted case
// too, and it escapes to the client as an unattributed generic 500. Only
// allocateServiceJob() itself knows the attempt count, so this function is
// called from there — exactly once, only at the exact point it decides NOT
// to retry a TransactionConflictError (i.e. genuine exhaustion, never a
// retryable attempt). The message is a fixed literal with no error object
// and no interpolated content, so there is nothing to sanitize by
// construction — no document path, token, request body, PII, or intake
// UUID can ever reach it.
export function logAllocatorTransactionRetriesExhausted(): void {
  console.error('[ServiceJob Allocator] firestore-commit: transaction-retries-exhausted');
}

// F5d-56B (Terra F5d-56A blocker, Objective 1): the smallest helper that
// covers the FULL non-OAuth operation boundary — network transport,
// HTTP-status handling, response/body parsing, and any local
// structure-validation the wrapped operation performs — for exactly one
// allocator stage. OAuth token acquisition is deliberately never wrapped
// by this helper; every call site acquires its token in its own separate
// try/catch tagged 'oauth-token' first (see firestoreClient.ts), so an
// OAuth failure is never misclassified as a Firestore-stage failure.
// Always rethrows the original, completely unmodified exception — this is
// an observation seam, not a new error-handling layer.
export async function runAllocatorStage<T>(
  stage: AllocatorStage,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logAllocatorStageFailure(stage, error);
    throw error;
  }
}
