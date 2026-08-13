// F5d-52 — local-development-only diagnostics for Firestore repository
// activation. Purpose: turn AuthSessionProvider's generic "Staff data could
// not be initialized" message into an exact, sanitized failing stage a
// developer can read in the console during local rehearsal, without ever
// changing what's actually thrown/caught or what the user sees. This module
// does not fix or alter any repository's lifecycle — it only observes.
//
// Sanitization is deliberately conservative: only a Firebase error's `.code`
// is ever surfaced, and only if it matches one of Firestore's own documented
// error codes. Nothing else about a raw error — `.message`, `.stack`,
// `.customData`, or the error object itself — is ever logged or recorded.
// This matters here specifically because this app's customer documents are
// legacy phone-keyed (DECISIONS.md #031/#039): a Firestore error's message
// can embed a document path, which for this app's data could itself be a
// customer's phone number. Blindly stringifying a raw Firebase error is a
// real PII leak risk here, not a hypothetical one.
export type FirestoreRepositoryName =
  'serviceJobs' | 'customers' | 'productMaster' | 'attachments' | 'serviceReports';

// factory: threw synchronously (or its returned promise rejected) while
//   being constructed — this is what actually reaches
//   activateFirestoreRepositories()'s caller as a rejection today.
// initial-listener: the repository's very first onSnapshot delivery was an
//   error, before the factory's readiness promise had resolved. Today this
//   does NOT reject the factory (see DECISIONS.md #018 / the repository
//   files' own comments: "resolves — with an empty cache — rather than
//   hanging forever"), so this stage is only ever observable through this
//   diagnostic recorder, never through a caught exception.
// listener: an onSnapshot delivery failed after the repository was already
//   considered ready (or for repositories, like Service Reports/Attachments,
//   whose listeners attach lazily per-job well after activation). Never
//   rejects anything; purely informational.
export type FirestoreInitStage = 'factory' | 'initial-listener' | 'listener';

export interface FirestoreRepositoryInitError {
  repository: FirestoreRepositoryName;
  stage: FirestoreInitStage;
  code: string;
}

// Firestore's documented client error codes (firebase/firestore's FirestoreError['code']).
// Anything else — including a missing/non-string `.code`, or a `.code` that
// doesn't match this list — is reported as 'unknown' rather than passed
// through, so an unrecognized/unexpected error shape can never smuggle
// arbitrary content into the diagnostic record.
const KNOWN_FIRESTORE_ERROR_CODES: ReadonlySet<string> = new Set([
  'cancelled',
  'unknown',
  'invalid-argument',
  'deadline-exceeded',
  'not-found',
  'already-exists',
  'permission-denied',
  'resource-exhausted',
  'failed-precondition',
  'aborted',
  'out-of-range',
  'unimplemented',
  'internal',
  'unavailable',
  'data-loss',
  'unauthenticated',
]);

export function sanitizedFirestoreErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return KNOWN_FIRESTORE_ERROR_CODES.has((error as { code: string }).code)
      ? (error as { code: string }).code
      : 'unknown';
  }
  return 'unknown';
}

export function describeFirestoreInitError(
  error: unknown,
  repository: FirestoreRepositoryName,
  stage: FirestoreInitStage
): FirestoreRepositoryInitError {
  return { repository, stage, code: sanitizedFirestoreErrorCode(error) };
}

const diagnostics: FirestoreRepositoryInitError[] = [];

// Dev-only by design (Objective 6): production user-facing behavior must
// stay generic, and this is the one place that could otherwise leak a
// repository/error-code pair to a production console. import.meta.env.DEV
// is the same Vite-provided signal backend.ts already relies on for its own
// production/non-production branching.
export function recordFirestoreInitFailure(entry: FirestoreRepositoryInitError): void {
  diagnostics.push(entry);
  if (import.meta.env.DEV) {
    console.warn(`[Firestore Init] ${entry.repository}: ${entry.code} (${entry.stage})`);
  }
}

export function getFirestoreInitDiagnostics(): readonly FirestoreRepositoryInitError[] {
  return diagnostics;
}

export function clearFirestoreInitDiagnostics(): void {
  diagnostics.length = 0;
}
