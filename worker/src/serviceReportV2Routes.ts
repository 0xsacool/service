import type { Env } from './env.ts';
import { readBearerToken, type FirebaseTokenVerifier } from './firebaseAuth.ts';
import { FileTooLargeError, readBodyWithLimit } from './validation.ts';
import {
  parseApprovalDecisionRequest,
  parseCreateReportV2Request,
  parseFinalizeReportRequest,
  parseLegacyDraftSaveRequest,
  parseManualDeletionRequest,
  parseStrictJson,
  parseSuccessorRequest,
  parseTrustedPrintRequest,
  requireV2IdempotencyKey,
  ServiceReportV2Error,
  v2Failure,
  v2Success,
} from './serviceReportV2Contracts.ts';
import {
  createServiceReportSuccessorV2,
  createServiceReportV2,
  decideServiceReportV2,
  finalizeServiceReportV2,
  prepareTrustedPrint,
  type EvidenceObjectStore,
  type ServiceReportV2Store,
} from './serviceReportV2Operations.ts';
import {
  createEvidenceObjectStore,
  createServiceReportV2Store,
  ServiceReportV2FirestoreError,
} from './serviceReportV2Firestore.ts';
import {
  coordinateManualAttachmentDeletion,
  type DeletionObjectStore,
} from './attachmentDeletionCoordinatorV2.ts';
import {
  finalizeLegacyServiceReport,
  saveLegacyServiceReportDraft,
} from './serviceReportV1Compatibility.ts';

const MAX_BODY_BYTES = 200 * 1024;

export type ServiceReportV2Mode = 'disabled' | 'compatibility' | 'v2-active';

export function serviceReportV2Mode(env: Env): ServiceReportV2Mode {
  return env.SERVICE_REPORT_V2_MODE === 'compatibility' || env.SERVICE_REPORT_V2_MODE === 'v2-active'
    ? env.SERVICE_REPORT_V2_MODE
    : 'disabled';
}

export interface ServiceReportV2RouteDependencies {
  tokenVerifier: FirebaseTokenVerifier;
  createStore?: (env: Env) => ServiceReportV2Store;
  createObjects?: (env: Env) => DeletionObjectStore;
}

async function actorUid(
  request: Request,
  env: Env,
  tokenVerifier: FirebaseTokenVerifier
): Promise<string> {
  const token = readBearerToken(request.headers.get('Authorization'));
  if (!token) {
    throw new ServiceReportV2Error(401, 'authentication_required', 'Authentication is required', 'never');
  }
  try {
    return (await tokenVerifier.verify(token, env.FIRESTORE_PROJECT_ID)).uid;
  } catch {
    throw new ServiceReportV2Error(401, 'authentication_required', 'Authentication is required', 'never');
  }
}

async function requestBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json' || !request.body) {
    throw new ServiceReportV2Error(400, 'validation_failed', 'Content-Type must be application/json', 'never');
  }
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_BODY_BYTES) {
    throw new ServiceReportV2Error(400, 'validation_failed', 'The request body is too large', 'never');
  }
  const bytes = await readBodyWithLimit(request.body, MAX_BODY_BYTES);
  return parseStrictJson(new TextDecoder().decode(bytes));
}

async function runRoute(
  request: Request,
  env: Env,
  dependencies: ServiceReportV2RouteDependencies,
  operation: (context: {
    requestId: string;
    uid: string;
    body: unknown;
    store: ServiceReportV2Store;
    objects: EvidenceObjectStore;
  }) => Promise<Response>
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await actorUid(request, env, dependencies.tokenVerifier);
    const body = await requestBody(request);
    return await operation({
      requestId,
      uid,
      body,
      store: (dependencies.createStore ?? createServiceReportV2Store)(env),
      objects: (dependencies.createObjects ?? createEvidenceObjectStore)(env),
    });
  } catch (error) {
    if (error instanceof ServiceReportV2Error) return v2Failure(requestId, error);
    if (error instanceof SyntaxError || error instanceof FileTooLargeError) {
      return v2Failure(
        requestId,
        new ServiceReportV2Error(400, 'validation_failed', 'The request body is not valid JSON', 'never')
      );
    }
    if (error instanceof ServiceReportV2FirestoreError) {
      return v2Failure(
        requestId,
        new ServiceReportV2Error(503, 'dependency_unavailable', 'A required dependency is unavailable', 'same-idempotency-key')
      );
    }
    console.error(`[service-report-v2] request ${requestId} failed`);
    return v2Failure(
      requestId,
      new ServiceReportV2Error(503, 'dependency_unavailable', 'A required dependency is unavailable', 'operator')
    );
  }
}

export function handleCreateReportV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    const idempotencyKey = requireV2IdempotencyKey(request);
    if (
      body === null || typeof body !== 'object' || Array.isArray(body) ||
      !Object.hasOwn(body, 'contractVersion')
    ) {
      throw new ServiceReportV2Error(428, 'upgrade_required', 'An explicit contractVersion is required', 'never');
    }
    const result = await createServiceReportV2({
      store, objects, actor: { uid }, serviceJobId, idempotencyKey,
      request: parseCreateReportV2Request(body),
    });
    return v2Success(requestId, { report: result.data }, result.replayed, result.replayed ? 200 : 201);
  });
}

export function handleFinalizeReportV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  reportId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    const idempotencyKey = requireV2IdempotencyKey(request);
    const parsed = parseFinalizeReportRequest(body);
    if (parsed.contractVersion === 1) {
      const result = await finalizeLegacyServiceReport({
        store, objects, actor: { uid }, serviceJobId, reportId, idempotencyKey,
        request: parsed,
      });
      return v2Success(requestId, { report: result.data }, result.replayed);
    }
    const result = await finalizeServiceReportV2({
      store, objects, actor: { uid }, serviceJobId, reportId, idempotencyKey,
      expectedContentRevision: parsed.expectedContentRevision,
    });
    return v2Success(requestId, { report: result.data }, result.replayed);
  });
}

export function handleLegacyDraftSaveV1(
  request: Request,
  env: Env,
  serviceJobId: string,
  reportId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store }) => {
    const idempotencyKey = requireV2IdempotencyKey(request);
    const result = await saveLegacyServiceReportDraft({
      store,
      actor: { uid },
      serviceJobId,
      reportId,
      idempotencyKey,
      request: parseLegacyDraftSaveRequest(body),
    });
    return v2Success(requestId, { report: result.data }, result.replayed);
  });
}

export function handleApprovalDecisionV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  reportId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    const idempotencyKey = requireV2IdempotencyKey(request);
    const result = await decideServiceReportV2({
      store, objects, actor: { uid }, serviceJobId, reportId, idempotencyKey,
      request: parseApprovalDecisionRequest(body),
    });
    return v2Success(requestId, result.data, result.replayed, result.replayed ? 200 : 201);
  });
}

export function handleSuccessorV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  predecessorReportId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    const idempotencyKey = requireV2IdempotencyKey(request);
    const result = await createServiceReportSuccessorV2({
      store, objects, actor: { uid }, serviceJobId, predecessorReportId,
      idempotencyKey, request: parseSuccessorRequest(body),
    });
    return v2Success(requestId, { report: result.data }, result.replayed, result.replayed ? 200 : 201);
  });
}

export function handleTrustedPrintV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  reportId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    const result = await prepareTrustedPrint({
      store, objects, actor: { uid }, serviceJobId, reportId,
      request: parseTrustedPrintRequest(body),
    });
    return v2Success(requestId, result, false);
  });
}

export function handleManualDeletionV2(
  request: Request,
  env: Env,
  serviceJobId: string,
  attachmentMetadataDocId: string,
  dependencies: ServiceReportV2RouteDependencies
): Promise<Response> {
  return runRoute(request, env, dependencies, async ({ requestId, uid, body, store, objects }) => {
    parseManualDeletionRequest(body);
    const idempotencyKey = requireV2IdempotencyKey(request);
    if (!attachmentMetadataDocId || attachmentMetadataDocId.includes('/') || attachmentMetadataDocId.length > 1500) {
      throw new ServiceReportV2Error(400, 'validation_failed', 'The attachment metadata ID is invalid', 'never');
    }
    const result = await coordinateManualAttachmentDeletion({
      store,
      objects: objects as DeletionObjectStore,
      actor: { uid },
      serviceJobId,
      attachmentMetadataDocId,
      idempotencyKey,
    });
    return v2Success(
      requestId,
      result,
      false,
      result.status === 'completed' ? 200 : 202
    );
  });
}
