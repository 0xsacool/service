import type { Env } from './env.ts';
import { handleOptions, withCors } from './cors.ts';
import { runRetentionSweep } from './retentionSweep.ts';
import {
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
} from '../../src/services/publicTrackingCode.ts';
import {
  isValidPublicTrackingToken,
  verifyPublicTrackingToken,
} from './publicTrackingToken.ts';
import {
  firebaseTokenVerifier,
  readBearerToken,
  type FirebaseTokenVerifier,
} from './firebaseAuth.ts';
import { getAuthorizedStaffProfile, isStaffAuthorizedForServiceJob, type StaffProfile } from './staffAuthorization.ts';
import { allocateServiceJob, isValidIdempotencyKey, MAX_INTAKE_BYTES, parseServiceJobIntake } from './serviceJobCreation.ts';
import {
  exceedsDeclaredSize,
  FileTooLargeError,
  isAllowedContentType,
  MAX_FILE_SIZE_BYTES,
  readBodyWithLimit,
} from './validation.ts';

const FILES_PREFIX = '/files/';
const PUBLIC_TRACKING_PREFIX = '/public/tracking/';
const PUBLIC_TRACKING_CODE_PATH = '/public/tracking';
const MAX_PUBLIC_TRACKING_BODY_BYTES = 1024;
const SERVICE_JOBS_PATH = '/service-jobs';

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

async function handleServiceJobCreate(request: Request, env: Env, dependencies: WorkerDependencies): Promise<Response> {
  const authorization = await authorizeStaffCreation(request, env, dependencies);
  if (authorization instanceof Response) return authorization;
  const contentLength = request.headers.get('Content-Length');
  if (!request.body || !request.headers.get('Content-Type')?.startsWith('application/json') || (contentLength && Number(contentLength) > MAX_INTAKE_BYTES)) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
  const key = request.headers.get('Idempotency-Key');
  if (!isValidIdempotencyKey(key)) return json({ error: 'Invalid idempotency key' }, { status: 400 });
  try {
    const raw = await readBodyWithLimit(request.body, MAX_INTAKE_BYTES);
    const intake = parseServiceJobIntake(JSON.parse(new TextDecoder().decode(raw)));
    if (!intake) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
    const job = await allocateServiceJob({ brandId: authorization.profile.brandId, key, intake, dataAccess: authorization.client });
    return json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof FileTooLargeError || error instanceof SyntaxError) return json({ error: 'Invalid Service Job intake' }, { status: 400 });
    console.error('[files-worker] Service Job create failed:', error);
    return json({ error: 'Unable to create Service Job' }, { status: 500 });
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

  const path = generateAttachmentPath(jobId, category, fileName);

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

    if (request.method === 'POST' && url.pathname === SERVICE_JOBS_PATH) {
      return withCors(await handleServiceJobCreate(request, env, dependencies), request, env);
    }

    if (url.pathname.startsWith(FILES_PREFIX)) {
      const rest = decodeURIComponent(url.pathname.slice(FILES_PREFIX.length));
      let response: Response;
      if (request.method === 'POST') {
        response = await handleUpload(request, env, rest, authorizeServiceJob);
      } else if (request.method === 'GET') {
        response = await handleDownload(request, env, rest, authorizeServiceJob);
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
