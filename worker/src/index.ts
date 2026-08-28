import type { Env } from './env.ts';
import { handleOptions, withCors } from './cors.ts';
import { runRetentionSweep } from './retentionSweep.ts';
import {
  AttachmentKeyTooLongError,
  generateAttachmentPath,
  getServiceJobIdFromAttachmentKey,
  isAttachmentCategory,
  isSafeJobId,
  isValidAttachmentKey,
} from './paths.ts';
import { createFirestoreClient, type FirestoreClient } from './firestoreClient.ts';
import { buildPublicTrackingDto } from './publicTracking.ts';
import {
  constantTimeEqualPublicTrackingCodeHashes,
  hashPublicTrackingCode,
  isValidPublicTrackingCode,
  normalizePublicTrackingCodeInput,
  PublicTrackingCodeCollisionError,
} from '../../src/services/publicTrackingCode.ts';
import { issuePublicTrackingCodeForServiceJob } from './publicTrackingCodeIssuance.ts';
import {
  isValidPublicTrackingToken,
  verifyPublicTrackingToken,
} from './publicTrackingToken.ts';
import {
  firebaseTokenVerifier,
  readBearerToken,
  type FirebaseTokenVerifier,
} from './firebaseAuth.ts';
import { getAuthorizedStaffProfile, isServiceJobInBrand, isStaffAuthorizedForServiceJob, type StaffProfile } from './staffAuthorization.ts';
import {
  CatalogTooLargeError,
  IdempotencyMismatchError,
  parseProductImportBody,
  PRODUCT_IMPORT_LIMITS,
  ProductImportRetryExhaustedError,
  ProductImportValidationError,
  runProductImportTransaction,
  StaleCatalogError,
} from './productImport.ts';
import { allocateServiceJob, isValidIdempotencyKey, MAX_INTAKE_BYTES, parseServiceJobCreateRequest } from './serviceJobCreation.ts';
import {
  ActiveDraftExistsError,
  allocateServiceReportDraft,
  IdempotencyKeyJobMismatchError,
  isValidReportId,
  parseServiceReportDraftRequest,
  ServiceJobMissingError,
} from './serviceReportCreation.ts';
import {
  ActiveDraftLockInconsistentError,
  finalizeServiceReportTransaction,
  ServiceReportIncompleteError,
  ServiceReportNotFoundError,
} from './serviceReportFinalization.ts';
import { logAllocatorStageFailure } from './allocatorDiagnostics.ts';
import {
  exceedsDeclaredSize,
  FileTooLargeError,
  isAllowedContentType,
  MAX_FILE_SIZE_BYTES,
  readBodyWithLimit,
} from './validation.ts';
import {
  handleApprovalDecisionV2,
  handleCreateReportV2,
  handleFinalizeReportV2,
  handleLegacyDraftSaveV1,
  handleManualDeletionV2,
  handleSuccessorV2,
  handleTrustedPrintV2,
  serviceReportV2Mode,
} from './serviceReportV2Routes.ts';
import type {
  ServiceReportV2Store,
} from './serviceReportV2Operations.ts';
import type { DeletionObjectStore } from './attachmentDeletionCoordinatorV2.ts';
import {
  handleApprovalQueueRead,
  handleApprovalReviewRead,
  handleServiceReportHistoryRead,
  type ServiceReportReadStore,
} from './serviceReportReadRoutes.ts';

const FILES_PREFIX = '/files/';
const PUBLIC_TRACKING_PREFIX = '/public/tracking/';
const PUBLIC_TRACKING_CODE_PATH = '/public/tracking';
const MAX_PUBLIC_TRACKING_BODY_BYTES = 1024;
const SERVICE_JOBS_PATH = '/service-jobs';
// F5d-66 — a trailing slash so this never matches SERVICE_JOBS_PATH's exact
// '/service-jobs' (Service Job creation) — the two routes cannot collide.
const SERVICE_JOBS_PREFIX = '/service-jobs/';
const MAX_SERVICE_REPORT_INPUT_BYTES = 200 * 1024;
// PI-3 — privileged Product Master import. Exact path, no prefix, so it can
// never collide with anything else.
const PRODUCTS_IMPORT_PATH = '/products/import';

function isPublicTrackingEnabled(env: Env): boolean {
  return env.PUBLIC_TRACKING_ENABLED === 'true';
}

export interface PublicTrackingRateLimiter {
  allow(request: Request): Promise<boolean>;
}

const allowPublicTrackingRequest: PublicTrackingRateLimiter = {
  async allow() {
    return true;
  },
};

export interface WorkerDependencies {
  tokenVerifier: FirebaseTokenVerifier;
  createFirestoreClient: (env: Env) => FirestoreClient;
  publicTrackingRateLimiter?: PublicTrackingRateLimiter;
  runRetentionSweep?: typeof runRetentionSweep;
  createServiceReportV2Store?: (env: Env) => ServiceReportV2Store;
  createEvidenceObjectStore?: (env: Env) => DeletionObjectStore;
  createServiceReportReadStore?: (env: Env) => ServiceReportReadStore;
}

const defaultDependencies: WorkerDependencies = {
  tokenVerifier: firebaseTokenVerifier,
  createFirestoreClient,
  runRetentionSweep,
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function publicTrackingNotFound(): Response {
  return json({ error: 'Not found' }, { status: 404 });
}

async function readPublicTrackingToken(request: Request): Promise<string | null> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_PUBLIC_TRACKING_BODY_BYTES) return null;
  if (!request.body || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return null;
  }
  try {
    const body = await readBodyWithLimit(request.body, MAX_PUBLIC_TRACKING_BODY_BYTES);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (entries.length !== 1 || entries[0]?.[0] !== 'token') return null;
    const token = entries[0][1];
    return isValidPublicTrackingToken(token) ? token : null;
  } catch {
    return null;
  }
}

async function readPublicTrackingCode(request: Request): Promise<string | null> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_PUBLIC_TRACKING_BODY_BYTES) return null;
  if (!request.body || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return null;
  }
  try {
    const body = await readBodyWithLimit(request.body, MAX_PUBLIC_TRACKING_BODY_BYTES);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (entries.length !== 1 || entries[0]?.[0] !== 'code') return null;
    const value = entries[0][1];
    if (typeof value !== 'string') return null;
    const normalized = normalizePublicTrackingCodeInput(value);
    return normalized && isValidPublicTrackingCode(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function handlePublicTracking(
  request: Request,
  env: Env,
  trackingReference: string,
  dependencies: WorkerDependencies
): Promise<Response> {
  if (!isSafeJobId(trackingReference)) return publicTrackingNotFound();

  const limiter = dependencies.publicTrackingRateLimiter ?? allowPublicTrackingRequest;
  if (!(await limiter.allow(request))) return publicTrackingNotFound();

  const token = await readPublicTrackingToken(request);
  if (!token) return publicTrackingNotFound();

  try {
    const record = await dependencies
      .createFirestoreClient(env)
      .getPublicTrackingServiceJob(trackingReference);
    if (!record || !(await verifyPublicTrackingToken(token, record.publicTrackingTokenHash))) {
      return publicTrackingNotFound();
    }
    const dto = buildPublicTrackingDto(record);
    return dto ? json(dto) : publicTrackingNotFound();
  } catch {
    return publicTrackingNotFound();
  }
}

async function handlePublicTrackingCode(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies
): Promise<Response> {
  const limiter = dependencies.publicTrackingRateLimiter ?? allowPublicTrackingRequest;
  if (!(await limiter.allow(request))) return publicTrackingNotFound();

  const code = await readPublicTrackingCode(request);
  if (!code) return publicTrackingNotFound();

  try {
    const client = dependencies.createFirestoreClient(env);
    const lookup = await client.getPublicTrackingCode(code);
    if (!lookup) return publicTrackingNotFound();
    const record = await client.getPublicTrackingServiceJob(lookup.serviceJobId);
    if (
      !record?.publicTrackingCodeHash ||
      !constantTimeEqualPublicTrackingCodeHashes(
        record.publicTrackingCodeHash,
        await hashPublicTrackingCode(code)
      )
    ) {
      return publicTrackingNotFound();
    }
    const dto = buildPublicTrackingDto(record);
    return dto ? json(dto) : publicTrackingNotFound();
  } catch {
    return publicTrackingNotFound();
  }
}

type AuthorizeServiceJob = (
  request: Request,
  env: Env,
  jobId: string
) => Promise<Response | null>;

function createServiceJobAuthorizer(dependencies: WorkerDependencies): AuthorizeServiceJob {
  return async (request, env, jobId) => {
    const token = readBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    let uid: string;
    try {
      const verified = await dependencies.tokenVerifier.verify(token, env.FIRESTORE_PROJECT_ID);
      uid = verified.uid;
    } catch {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const authorized = await isStaffAuthorizedForServiceJob(
        uid,
        jobId,
        dependencies.createFirestoreClient(env)
      );
      return authorized ? null : json({ error: 'Forbidden' }, { status: 403 });
    } catch {
      return json({ error: 'Forbidden' }, { status: 403 });
    }
  };
}

async function authorizeStaffCreation(request: Request, env: Env, dependencies: WorkerDependencies): Promise<{ profile: StaffProfile; client: FirestoreClient } | Response> {
  const token = readBearerToken(request.headers.get('Authorization'));
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const verified = await dependencies.tokenVerifier.verify(token, env.FIRESTORE_PROJECT_ID);
    const client = dependencies.createFirestoreClient(env);
    const profile = await getAuthorizedStaffProfile(verified.uid, client);
    return profile ? { profile, client } : json({ error: 'Forbidden' }, { status: 403 });
  } catch {
    return json({ error: 'Forbidden' }, { status: 403 });
  }
}

// PI-3 — a separate authorizer from authorizeStaffCreation() on purpose.
//
// Two differences, both required by the Product Import contract:
//   1. It distinguishes 401 (no/invalid credential) from 403 (valid
//      credential, insufficient permission). authorizeStaffCreation()
//      deliberately collapses a token-verification failure into 403, and an
//      existing test asserts that, so it is not changed here.
//   2. It requires the dedicated canImportProducts capability, read from the
//      authoritative staffProfiles document — never from anything the
//      browser sent. A client that fabricates the flag locally changes only
//      what its own UI renders; this check is what actually decides.
//
// Product Master is a global catalog (DECISIONS.md #030), so there is
// deliberately no brand predicate here — the staff profile must be valid,
// but its brand does not scope which products may be imported.
async function authorizeProductImport(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies
): Promise<{ profile: StaffProfile; client: FirestoreClient } | Response> {
  const token = readBearerToken(request.headers.get('Authorization'));
  if (!token) {
    return json(
      { code: 'authentication_required', error: 'Authentication is required' },
      { status: 401 }
    );
  }

  let uid: string;
  try {
    const verified = await dependencies.tokenVerifier.verify(token, env.FIRESTORE_PROJECT_ID);
    uid = verified.uid;
  } catch {
    return json(
      { code: 'authentication_required', error: 'Authentication is required' },
      { status: 401 }
    );
  }

  try {
    const client = dependencies.createFirestoreClient(env);
    const profile = await getAuthorizedStaffProfile(uid, client);
    if (!profile || !profile.canImportProducts) {
      return json(
        { code: 'forbidden', error: 'This account may not import products' },
        { status: 403 }
      );
    }
    return { profile, client };
  } catch {
    return json(
      { code: 'forbidden', error: 'This account may not import products' },
      { status: 403 }
    );
  }
}

async function handleProductImport(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies
): Promise<Response> {
  const authorization = await authorizeProductImport(request, env, dependencies);
  if (authorization instanceof Response) return authorization;

  const key = request.headers.get('Idempotency-Key');
  if (!isValidIdempotencyKey(key)) {
    return json(
      { code: 'validation_failed', error: 'A valid Idempotency-Key header is required' },
      { status: 400 }
    );
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > PRODUCT_IMPORT_LIMITS.maxBodyBytes) {
    return json(
      { code: 'payload_too_large', error: 'The import request is too large' },
      { status: 413 }
    );
  }
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json(
      { code: 'validation_failed', error: 'Content-Type must be application/json' },
      { status: 400 }
    );
  }
  if (!request.body) {
    return json({ code: 'validation_failed', error: 'A request body is required' }, { status: 400 });
  }

  try {
    // Content-Length above is a fast reject only; this is the real byte
    // enforcement against what actually arrives.
    const raw = await readBodyWithLimit(request.body, PRODUCT_IMPORT_LIMITS.maxBodyBytes);
    const parsed = parseProductImportBody(JSON.parse(new TextDecoder().decode(raw)));
    if (!parsed.ok || !parsed.value) {
      return json(
        { code: 'validation_failed', error: parsed.detail ?? 'The import request is not valid' },
        { status: 400 }
      );
    }

    const result = await runProductImportTransaction({
      key,
      actorUid: authorization.profile.uid,
      request: parsed.value,
      dataAccess: authorization.client,
    });

    const record = result.record;
    return json(
      {
        importId: key,
        replayed: result.replayed,
        catalogFingerprintBefore: record.catalogFingerprintBefore,
        catalogFingerprintAfter: record.catalogFingerprintAfter,
        summary: {
          total: record.total,
          created: record.created,
          updated: record.updated,
          skipped: record.skipped,
          warnings: record.warnings,
        },
        rows: record.rows,
      },
      // A first commit created something; a replay changed nothing.
      { status: result.replayed ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof ProductImportValidationError) {
      return json(
        {
          code: 'validation_failed',
          error: 'This import contains rows that cannot be applied',
          rows: error.rows
            .filter((row) => row.errors.length > 0)
            .map((row) => ({ rowNumber: row.rowNumber, errors: row.errors })),
        },
        { status: 400 }
      );
    }
    if (error instanceof StaleCatalogError) {
      return json(
        {
          code: 'stale_catalog',
          error: 'The product catalog changed after this import was previewed',
        },
        { status: 409 }
      );
    }
    if (error instanceof IdempotencyMismatchError) {
      return json(
        {
          code: 'idempotency_mismatch',
          error: 'This idempotency key was already used for a different import',
        },
        { status: 409 }
      );
    }
    if (error instanceof CatalogTooLargeError) {
      return json(
        { code: 'payload_too_large', error: 'The product catalog is too large to import into' },
        { status: 413 }
      );
    }
    if (error instanceof ProductImportRetryExhaustedError) {
      return json(
        {
          code: 'transaction_retry_exhausted',
          error: 'The import could not be committed because the catalog kept changing',
        },
        { status: 503 }
      );
    }
    if (error instanceof FileTooLargeError) {
      return json(
        { code: 'payload_too_large', error: 'The import request is too large' },
        { status: 413 }
      );
    }
    if (error instanceof SyntaxError) {
      return json(
        { code: 'validation_failed', error: 'The request body is not valid JSON' },
        { status: 400 }
      );
    }
    // Deliberately logs no error object: FirestoreRequestError's message can
    // embed raw Google response bodies including document paths.
    console.error('[files-worker] Product import failed');
    return json(
      { code: 'dependency_unavailable', error: 'Unable to complete the product import' },
      { status: 503 }
    );
  }
}

async function handleServiceJobCreate(request: Request, env: Env, dependencies: WorkerDependencies): Promise<Response> {
  const authorization = await authorizeStaffCreation(request, env, dependencies);
  if (authorization instanceof Response) return authorization;
  const contentLength = request.headers.get('Content-Length');
  if (!request.body || !request.headers.get('Content-Type')?.startsWith('application/json') || (contentLength && Number(contentLength) > MAX_INTAKE_BYTES)) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
  const key = request.headers.get('Idempotency-Key');
  if (!isValidIdempotencyKey(key)) return json({ error: 'Invalid idempotency key' }, { status: 400 });
  try {
    const raw = await readBodyWithLimit(request.body, MAX_INTAKE_BYTES);
    const parsed = parseServiceJobCreateRequest(JSON.parse(new TextDecoder().decode(raw)));
    if (!parsed) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
    const job = await allocateServiceJob({ brandId: authorization.profile.brandId, key, intake: parsed.intake, customer: parsed.customer, dataAccess: authorization.client });
    // F5d-69G Phase 2-FIX — Service Job creation performs NO public tracking
    // issuance. The SRV code is a one-way bearer secret: issuing it inside an
    // idempotent create means a create whose response is lost leaves the
    // credential committed server-side but permanently unknowable to staff
    // (an "active but lost" job recoverable only by rotation). Creation and
    // issuance are therefore separate operations — staff issue explicitly via
    // POST /service-jobs/{jobId}/public-tracking-code, where a lost response
    // is trivially recoverable by rotating again.
    try {
      return json({ job }, { status: 201 });
    } catch (buildError) {
      logAllocatorStageFailure('response-build', buildError);
      throw buildError;
    }
  } catch (error) {
    if (error instanceof FileTooLargeError || error instanceof SyntaxError) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
    // F5d-56: the exact failing stage — OAuth token acquisition, a
    // Firestore transaction/read/commit call, or response construction —
    // was already logged with a sanitized {stage, code} pair at the exact
    // point of failure (firestoreClient.ts / the response-build wrapper
    // above). This line intentionally no longer includes the raw `error`
    // object — its `.message` can embed a raw Google API response body,
    // which must never reach Worker logs (Objective 2).
    console.error('[files-worker] Service Job create failed');
    return json({ error: 'Unable to create Service Job' }, { status: 500 });
  }
}

// F5d-66 — POST /service-jobs/{jobId}/service-reports. Worker-mediated for
// the same reason Service Job creation is (DECISIONS.md #036, extended by
// #040): FR-{YYYY}-{SEQ} allocation and the one-active-draft lock both
// require a privileged transaction the browser must never perform itself.
async function handleServiceReportCreateDraft(
  request: Request,
  env: Env,
  jobId: string,
  dependencies: WorkerDependencies
): Promise<Response> {
  if (!isSafeJobId(jobId)) return json({ error: 'Invalid jobId' }, { status: 400 });

  const authorization = await authorizeStaffCreation(request, env, dependencies);
  if (authorization instanceof Response) return authorization;
  if (!(await isServiceJobInBrand(jobId, authorization.profile.brandId, authorization.client))) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = request.headers.get('Idempotency-Key');
  if (!isValidIdempotencyKey(key)) {
    return json({ error: 'Invalid idempotency key' }, { status: 400 });
  }

  const contentLength = request.headers.get('Content-Length');
  if (
    request.body &&
    (!request.headers.get('Content-Type')?.startsWith('application/json') ||
      (contentLength && Number(contentLength) > MAX_SERVICE_REPORT_INPUT_BYTES))
  ) {
    return json({ error: 'Invalid Service Report draft input' }, { status: 400 });
  }

  try {
    let parsedBody: unknown = {};
    if (request.body) {
      const raw = await readBodyWithLimit(request.body, MAX_SERVICE_REPORT_INPUT_BYTES);
      const text = new TextDecoder().decode(raw);
      if (text.length > 0) parsedBody = JSON.parse(text);
    }
    const input = parseServiceReportDraftRequest(parsedBody);
    if (input === null) {
      return json({ error: 'Invalid Service Report draft input' }, { status: 400 });
    }
    const report = await allocateServiceReportDraft({
      serviceJobId: jobId,
      brandId: authorization.profile.brandId,
      key,
      input,
      dataAccess: authorization.client,
    });
    return json({ report }, { status: 201 });
  } catch (error) {
    if (error instanceof ActiveDraftExistsError) {
      return json({ error: 'Active draft already exists' }, { status: 409 });
    }
    if (error instanceof IdempotencyKeyJobMismatchError) {
      return json(
        { error: 'Idempotency key is already associated with a different Service Job' },
        { status: 409 }
      );
    }
    if (error instanceof ServiceJobMissingError) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof FileTooLargeError || error instanceof SyntaxError) {
      return json({ error: 'Invalid Service Report draft input' }, { status: 400 });
    }
    console.error('[files-worker] Service Report draft creation failed');
    return json({ error: 'Unable to create Service Report draft' }, { status: 500 });
  }
}

// F5d-66 — POST /service-jobs/{jobId}/service-reports/{reportId}/finalize.
// Also Worker-mediated: this is the only other operation that touches the
// shared active-draft lock, and Firestore Rules cannot safely validate that
// the lock's release and the report's draft->final transition happen
// together and correctly (see DECISIONS.md #040 for the full analysis).
async function handleServiceReportFinalize(
  request: Request,
  env: Env,
  jobId: string,
  reportId: string,
  dependencies: WorkerDependencies
): Promise<Response> {
  if (!isSafeJobId(jobId)) return json({ error: 'Invalid jobId' }, { status: 400 });
  if (!isValidReportId(reportId)) return json({ error: 'Invalid reportId' }, { status: 400 });

  const authorization = await authorizeStaffCreation(request, env, dependencies);
  if (authorization instanceof Response) return authorization;
  if (!(await isServiceJobInBrand(jobId, authorization.profile.brandId, authorization.client))) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const report = await finalizeServiceReportTransaction({
      serviceJobId: jobId,
      reportId,
      dataAccess: authorization.client,
    });
    return json({ report }, { status: 200 });
  } catch (error) {
    if (error instanceof ServiceReportNotFoundError) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    if (error instanceof ActiveDraftLockInconsistentError) {
      return json({ error: 'Service Report state is inconsistent' }, { status: 409 });
    }
    if (error instanceof ServiceReportIncompleteError) {
      return json({ error: error.message }, { status: 400 });
    }
    console.error('[files-worker] Service Report finalize failed');
    return json({ error: 'Unable to finalize Service Report' }, { status: 500 });
  }
}

// F5d-69G — POST /service-jobs/{jobId}/public-tracking-code. Staff-only,
// brand-scoped (same authorizeStaffCreation()/isServiceJobInBrand() pattern
// as the Service Report routes above — Worker-mediated because ordinary
// Firestore Rules browser updates already explicitly deny writing
// publicTrackingCodeHash, so issuance/rotation can only ever happen through
// this privileged path). Serves both "issue" (job currently inactive) and
// "rotate" (job already active) — issuePublicTrackingCodeForServiceJob()
// always writes a fresh code unconditionally, so there is deliberately no
// separate rotate endpoint; the frontend decides what confirmation copy to
// show based on the job's current publicTrackingCodeHash.
async function handlePublicTrackingCodeIssuance(
  request: Request,
  env: Env,
  jobId: string,
  dependencies: WorkerDependencies
): Promise<Response> {
  if (!isSafeJobId(jobId)) return json({ error: 'Invalid jobId' }, { status: 400 });

  const authorization = await authorizeStaffCreation(request, env, dependencies);
  if (authorization instanceof Response) return authorization;
  if (!(await isServiceJobInBrand(jobId, authorization.profile.brandId, authorization.client))) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const issued = await issuePublicTrackingCodeForServiceJob(jobId, authorization.client);
    // Only the raw code is returned — never the hash. This is the one and
    // only moment the plaintext code is ever knowable outside Firestore's
    // own publicTrackingCodes/{code} document id; the frontend must display/
    // copy it now or the staff member has to rotate to get a new one (see
    // DECISIONS.md #041's one-way-hash security property).
    return json({ code: issued.code }, { status: 201 });
  } catch (error) {
    if (error instanceof PublicTrackingCodeCollisionError) {
      return json({ error: 'Unable to issue a public tracking code' }, { status: 503 });
    }
    console.error('[files-worker] Public tracking code issuance failed');
    return json({ error: 'Unable to issue a public tracking code' }, { status: 500 });
  }
}

// POST /files/service-jobs/{jobId}/{category} — the leaf filename is never
// caller-supplied as part of the URL; it's read from X-File-Name and always
// combined with a server-generated uuid (see generateAttachmentPath).
async function handleUpload(
  request: Request,
  env: Env,
  rest: string,
  authorizeServiceJob: AuthorizeServiceJob
): Promise<Response> {
  const [prefix, jobId, category] = rest.split('/').filter(Boolean);
  if (prefix !== 'service-jobs' || !jobId || !category) {
    return json(
      { error: 'Expected POST /files/service-jobs/{jobId}/{category}' },
      { status: 400 }
    );
  }
  if (!isSafeJobId(jobId)) {
    return json({ error: 'Invalid jobId' }, { status: 400 });
  }
  if (!isAttachmentCategory(category)) {
    return json(
      { error: 'Invalid category — expected one of: before, after, documents, report' },
      { status: 400 }
    );
  }

  const authorizationFailure = await authorizeServiceJob(request, env, jobId);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  const fileName = request.headers.get('X-File-Name');
  if (!fileName) {
    return json({ error: 'Missing X-File-Name header' }, { status: 400 });
  }

  const contentType = request.headers.get('Content-Type');
  if (!isAllowedContentType(contentType)) {
    return json(
      { error: `Unsupported content type: ${contentType ?? '(none)'}` },
      { status: 415 }
    );
  }

  if (exceedsDeclaredSize(request.headers.get('Content-Length'))) {
    return json(
      { error: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes` },
      { status: 413 }
    );
  }

  if (!request.body) {
    return json({ error: 'Missing request body' }, { status: 400 });
  }

  let path: string;
  try {
    path = generateAttachmentPath(jobId, category, fileName);
  } catch (error) {
    if (error instanceof AttachmentKeyTooLongError) {
      return json({ error: 'validation_failed' }, { status: 400 });
    }
    throw error;
  }

  try {
    const body = await readBodyWithLimit(request.body, MAX_FILE_SIZE_BYTES);
    const object = await env.ATTACHMENTS_BUCKET.put(path, body, {
      httpMetadata: { contentType },
    });
    return json(
      {
        path,
        contentType,
        size: object.size,
        uploadedAt: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      return json(
        { error: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes` },
        { status: 413 }
      );
    }
    console.error('[files-worker] upload failed:', err);
    return json({ error: 'Upload failed' }, { status: 500 });
  }
}

// GET /files/service-jobs/{jobId}/{category}/{uuid}-{fileName} — key is
// exactly the `path` a prior upload returned; not reconstructed here.
async function handleDownload(
  request: Request,
  env: Env,
  key: string,
  authorizeServiceJob: AuthorizeServiceJob
): Promise<Response> {
  if (!isValidAttachmentKey(key)) {
    return json({ error: 'Invalid attachment key' }, { status: 400 });
  }
  const jobId = getServiceJobIdFromAttachmentKey(key);
  if (!jobId) {
    return json({ error: 'Invalid attachment key' }, { status: 400 });
  }
  const authorizationFailure = await authorizeServiceJob(request, env, jobId);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  const object = await env.ATTACHMENTS_BUCKET.get(key);
  if (!object) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Length', String(object.size));
  // Never cached by a shared/browser cache — these are private customer
  // files served through an otherwise-unauthenticated endpoint (see
  // README's pre-auth note); no reason to let anything retain a copy.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { status: 200, headers });
}

async function handleDelete(
  request: Request,
  env: Env,
  key: string,
  authorizeServiceJob: AuthorizeServiceJob
): Promise<Response> {
  if (!isValidAttachmentKey(key)) {
    return json({ error: 'Invalid attachment key' }, { status: 400 });
  }
  const jobId = getServiceJobIdFromAttachmentKey(key);
  if (!jobId) {
    return json({ error: 'Invalid attachment key' }, { status: 400 });
  }
  const authorizationFailure = await authorizeServiceJob(request, env, jobId);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  await env.ATTACHMENTS_BUCKET.delete(key);
  return new Response(null, { status: 204 });
}

export function createWorkerHandler(
  dependencies: WorkerDependencies = defaultDependencies
): ExportedHandler<Env> {
  const authorizeServiceJob = createServiceJobAuthorizer(dependencies);

  return {
  // F5d-5: real reconciliation. F5d-31 keeps it unreachable from fetch()
  // and removes Cron from the default deployment configuration. Calls
  // runRetentionSweep(), which only ever
  // reads serviceJobAttachments and patches retentionStatus — there is no
  // R2 call and no document-delete call anywhere in that path (see
  // retentionSweep.ts's own comment). Errors are caught here so a failure
  // (e.g. Firestore/network unavailable) is logged clearly and never
  // crashes the scheduled invocation or attempts anything destructive.
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`[files-worker] scheduled trigger fired (cron: "${event.cron}") — running retention sweep.`);
    try {
      const result = await (dependencies.runRetentionSweep ?? runRetentionSweep)(env);
      console.log(
        `[files-worker] retention sweep complete: scanned=${result.attachmentsScanned} ` +
          `updated=${result.attachmentsUpdated} errors=${result.errors} aborted=${result.aborted}`
      );
    } catch (err) {
      console.error('[files-worker] retention sweep failed unexpectedly:', err);
    }
  },

    async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(json({ status: 'ok' }), request, env);
    }

    // F5d-39A: the public routes must stay unreachable on every ordinary
    // Worker rollout until a separately approved deployment explicitly opts
    // in. Keep this guard before body parsing, rate limiting, and Firestore
    // client construction so a disabled request has no capability lookup or
    // Firestore side effect.
    if (
      request.method === 'POST' &&
      (url.pathname.startsWith(PUBLIC_TRACKING_PREFIX) ||
        url.pathname === PUBLIC_TRACKING_CODE_PATH) &&
      !isPublicTrackingEnabled(env)
    ) {
      return withCors(publicTrackingNotFound(), request, env);
    }

    if (request.method === 'POST' && url.pathname.startsWith(PUBLIC_TRACKING_PREFIX)) {
      let trackingReference: string;
      try {
        trackingReference = decodeURIComponent(
          url.pathname.slice(PUBLIC_TRACKING_PREFIX.length)
        );
      } catch {
        return withCors(publicTrackingNotFound(), request, env);
      }
      return withCors(
        await handlePublicTracking(request, env, trackingReference, dependencies),
        request,
        env
      );
    }

    if (request.method === 'POST' && url.pathname === PUBLIC_TRACKING_CODE_PATH) {
      return withCors(
        await handlePublicTrackingCode(request, env, dependencies),
        request,
        env
      );
    }

    if (request.method === 'POST' && url.pathname === PRODUCTS_IMPORT_PATH) {
      return withCors(await handleProductImport(request, env, dependencies), request, env);
    }

    if (request.method === 'POST' && url.pathname === SERVICE_JOBS_PATH) {
      return withCors(await handleServiceJobCreate(request, env, dependencies), request, env);
    }

    const readDependencies = {
      tokenVerifier: dependencies.tokenVerifier,
      createReadStore: dependencies.createServiceReportReadStore,
    };

    if (request.method === 'GET') {
      if (url.pathname === '/service-reports/approval-queue') {
        return withCors(
          await handleApprovalQueueRead(
            request, env, 'queue', null, readDependencies
          ),
          request,
          env
        );
      }
      const reportNumberPrefix = '/service-reports/approval-queue/report-number/';
      if (url.pathname.startsWith(reportNumberPrefix)) {
        const rawSearch = url.pathname.slice(reportNumberPrefix.length);
        return withCors(
          await handleApprovalQueueRead(
            request, env, 'report-number', rawSearch, readDependencies
          ),
          request,
          env
        );
      }
      const trackingReferencePrefix =
        '/service-reports/approval-queue/tracking-reference/';
      if (url.pathname.startsWith(trackingReferencePrefix)) {
        const rawSearch = url.pathname.slice(trackingReferencePrefix.length);
        return withCors(
          await handleApprovalQueueRead(
            request, env, 'tracking-reference', rawSearch, readDependencies
          ),
          request,
          env
        );
      }
      if (url.pathname.startsWith(SERVICE_JOBS_PREFIX)) {
        const rawRest = url.pathname.slice(SERVICE_JOBS_PREFIX.length);
        const segments = rawRest.split('/').filter(Boolean);
        if (segments.length === 2 && segments[1] === 'service-reports') {
          return withCors(
            await handleServiceReportHistoryRead(
              request, env, segments[0]!, readDependencies
            ),
            request,
            env
          );
        }
        if (
          segments.length === 4 &&
          segments[1] === 'service-reports' &&
          segments[3] === 'approval-review'
        ) {
          return withCors(
            await handleApprovalReviewRead(
              request, env, segments[0]!, segments[2]!, readDependencies
            ),
            request,
            env
          );
        }
      }
    }

    // F5d-66 — the exact '/service-jobs' check above never matches this
    // prefix (it requires a trailing '/'), so there is no route-ordering
    // ambiguity between Service Job creation and these two new routes.
    if (request.method === 'POST' && url.pathname.startsWith(SERVICE_JOBS_PREFIX)) {
      const rest = decodeURIComponent(url.pathname.slice(SERVICE_JOBS_PREFIX.length));
      const segments = rest.split('/').filter(Boolean);
      const v2Dependencies = {
        tokenVerifier: dependencies.tokenVerifier,
        createStore: dependencies.createServiceReportV2Store,
        createObjects: dependencies.createEvidenceObjectStore,
      };
      const v2Mode = serviceReportV2Mode(env);
      if (segments.length === 2 && segments[1] === 'service-reports') {
        if (v2Mode !== 'disabled') {
          return withCors(
            await handleCreateReportV2(request, env, segments[0]!, v2Dependencies),
            request,
            env
          );
        }
        return withCors(
          await handleServiceReportCreateDraft(request, env, segments[0]!, dependencies),
          request,
          env
        );
      }
      if (
        v2Mode !== 'disabled' && segments.length === 4 &&
        segments[1] === 'service-reports' && segments[3] === 'legacy-draft-save'
      ) {
        return withCors(
          await handleLegacyDraftSaveV1(
            request, env, segments[0]!, segments[2]!, v2Dependencies
          ),
          request,
          env
        );
      }
      if (segments.length === 4 && segments[1] === 'service-reports' && segments[3] === 'finalize') {
        if (v2Mode !== 'disabled') {
          return withCors(
            await handleFinalizeReportV2(request, env, segments[0]!, segments[2]!, v2Dependencies),
            request,
            env
          );
        }
        return withCors(
          await handleServiceReportFinalize(request, env, segments[0]!, segments[2]!, dependencies),
          request,
          env
        );
      }
      if (
        v2Mode !== 'disabled' && segments.length === 4 &&
        segments[1] === 'service-reports' && segments[3] === 'approval-decision'
      ) {
        return withCors(
          await handleApprovalDecisionV2(request, env, segments[0]!, segments[2]!, v2Dependencies),
          request,
          env
        );
      }
      if (
        v2Mode !== 'disabled' && segments.length === 4 &&
        segments[1] === 'service-reports' && segments[3] === 'successor'
      ) {
        return withCors(
          await handleSuccessorV2(request, env, segments[0]!, segments[2]!, v2Dependencies),
          request,
          env
        );
      }
      if (
        v2Mode !== 'disabled' && segments.length === 4 &&
        segments[1] === 'service-reports' && segments[3] === 'trusted-print'
      ) {
        return withCors(
          await handleTrustedPrintV2(request, env, segments[0]!, segments[2]!, v2Dependencies),
          request,
          env
        );
      }
      if (
        v2Mode !== 'disabled' && segments.length === 4 &&
        segments[1] === 'attachments' && segments[3] === 'deletion-requests'
      ) {
        return withCors(
          await handleManualDeletionV2(request, env, segments[0]!, segments[2]!, v2Dependencies),
          request,
          env
        );
      }
      if (segments.length === 2 && segments[1] === 'public-tracking-code') {
        return withCors(
          await handlePublicTrackingCodeIssuance(request, env, segments[0]!, dependencies),
          request,
          env
        );
      }
      return withCors(json({ error: 'Not found' }, { status: 404 }), request, env);
    }

    if (url.pathname.startsWith(FILES_PREFIX)) {
      const rest = decodeURIComponent(url.pathname.slice(FILES_PREFIX.length));
      let response: Response;
      if (request.method === 'POST') {
        response = await handleUpload(request, env, rest, authorizeServiceJob);
      } else if (request.method === 'GET') {
        response = await handleDownload(request, env, rest, authorizeServiceJob);
      } else if (request.method === 'DELETE' && serviceReportV2Mode(env) !== 'disabled') {
        response = json({ error: 'Method not allowed' }, { status: 405 });
      } else if (request.method === 'DELETE') {
        response = await handleDelete(request, env, rest, authorizeServiceJob);
      } else {
        response = json({ error: 'Method not allowed' }, { status: 405 });
      }
      return withCors(response, request, env);
    }

    return withCors(json({ error: 'Not found' }, { status: 404 }), request, env);
    },
  };
}

export default createWorkerHandler();
