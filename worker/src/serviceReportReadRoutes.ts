import type { Env } from './env.ts';
import { readBearerToken, type FirebaseTokenVerifier } from './firebaseAuth.ts';
import { getAccessToken } from './googleAuth.ts';
import { isCanonicalBrandId, type BrandId } from '../../src/types/brand.ts';
import type { ServiceReport } from '../../src/types/serviceReport.ts';
import type { ServiceReportV2 } from '../../src/types/serviceReportV2.ts';
import { isValidServiceReport, orderServiceReports } from '../../src/services/serviceReport.ts';
import {
  computeServiceReportFinalDigest,
  isCanonicalTimestampMs,
  parseServiceReportV2,
} from '../../src/services/serviceReportV2.ts';
import {
  parseCoreStaffProfile,
  parseRepairReportActorProfile,
  type CoreStaffProfile,
  type RepairReportActorProfile,
} from '../../src/services/staffProfile.ts';

export type ApprovalQueueMode = 'queue' | 'report-number' | 'tracking-reference';

export interface ReadStoredDocument {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

export interface ApprovalQueueCursor {
  v: 1;
  mode: ApprovalQueueMode;
  search: string | null;
  finalizedAt: string;
  reportId: string;
}

export interface ApprovalQueueQuery {
  brandId: BrandId;
  mode: ApprovalQueueMode;
  search: string | null;
  pageSize: number;
  cursor: ApprovalQueueCursor | null;
}

export interface ServiceReportReadStore {
  get(collection: string, id: string): Promise<ReadStoredDocument | null>;
  batchGet(
    addresses: readonly { collection: string; id: string }[]
  ): Promise<readonly ReadStoredDocument[]>;
  queryHistory(serviceJobId: string, limit: number): Promise<readonly ReadStoredDocument[]>;
  queryApprovalQueue(query: ApprovalQueueQuery): Promise<readonly ReadStoredDocument[]>;
}

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  referenceValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

class ReadDependencyError extends Error {}

class ServiceReportReadError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 503;
  readonly code:
    | 'invalid_request'
    | 'authentication_required'
    | 'staff_access_denied'
    | 'service_job_access_denied'
    | 'approval_console_access_denied'
    | 'history_integrity_incident'
    | 'history_limit_exceeded'
    | 'approval_queue_integrity_incident'
    | 'approval_review_unavailable'
    | 'dependency_unavailable';
  readonly retryClass: 'never' | 'reload' | 'operator';

  constructor(
    status: 400 | 401 | 403 | 409 | 503,
    code:
      | 'invalid_request'
      | 'authentication_required'
      | 'staff_access_denied'
      | 'service_job_access_denied'
      | 'approval_console_access_denied'
      | 'history_integrity_incident'
      | 'history_limit_exceeded'
      | 'approval_queue_integrity_incident'
      | 'approval_review_unavailable'
      | 'dependency_unavailable',
    message: string,
    retryClass: 'never' | 'reload' | 'operator'
  ) {
    super(message);
    this.name = 'ServiceReportReadError';
    this.status = status;
    this.code = code;
    this.retryClass = retryClass;
  }
}

const encoder = new TextEncoder();
const HISTORY_LIMIT = 51;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REPORT_NUMBER_PATTERN = /^FR-[0-9]{4}-[0-9]{6}$/;
const TRACKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/;
const V1_KEYS = [
  'serviceJobId', 'reportNo', 'status', 'createdAt', 'updatedAt', 'finalizedAt',
  'technician', 'customerReportedProblem', 'inspectionFindings', 'serviceActions',
  'parts', 'technicianRemark', 'resultStatus', 'resultDetail',
  'evidenceAttachmentIds', 'claimNo', 'factoryReference', 'snapshot',
] as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function success(requestId: string, data: unknown): Response {
  return json({ ok: true, requestId, data });
}

function failure(requestId: string, error: ServiceReportReadError): Response {
  return json(
    {
      ok: false,
      requestId,
      error: {
        code: error.code,
        message: error.message,
        retryClass: error.retryClass,
      },
    },
    error.status
  );
}

function databasePath(env: Env): string {
  return `projects/${env.FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
}

function baseUrl(env: Env): string {
  const path = databasePath(env);
  return env.FIRESTORE_EMULATOR_HOST
    ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1/${path}`
    : `https://firestore.googleapis.com/v1/${path}`;
}

async function headers(env: Env): Promise<HeadersInit> {
  const token = await getAccessToken(env);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function valueToJson(value: FirestoreValue): unknown {
  if (value.nullValue !== undefined) return null;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue).toISOString();
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.referenceValue !== undefined) return value.referenceValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(valueToJson);
  if (value.mapValue !== undefined) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, valueToJson(entry)])
    );
  }
  throw new ReadDependencyError();
}

function parseDocument(document: FirestoreDocument): ReadStoredDocument {
  if (typeof document.name !== 'string') throw new ReadDependencyError();
  const segments = document.name.split('/');
  const id = segments.at(-1) ?? '';
  const collection = segments.at(-2) ?? '';
  if (!id || !collection) throw new ReadDependencyError();
  return {
    collection,
    id,
    data: Object.fromEntries(
      Object.entries(document.fields ?? {}).map(([key, value]) => [key, valueToJson(value)])
    ),
  };
}

function stringValue(value: string): FirestoreValue {
  return { stringValue: value };
}

function equal(fieldPath: string, value: FirestoreValue) {
  return { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value } };
}

async function runQuery(
  env: Env,
  structuredQuery: Record<string, unknown>
): Promise<ReadStoredDocument[]> {
  const response = await fetch(`${baseUrl(env)}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await headers(env)) },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new ReadDependencyError();
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new ReadDependencyError();
  const documents: ReadStoredDocument[] = [];
  for (const entry of body) {
    if (!entry || typeof entry !== 'object') throw new ReadDependencyError();
    if ('document' in entry) {
      documents.push(parseDocument((entry as { document: FirestoreDocument }).document));
    } else if (!('readTime' in entry)) {
      throw new ReadDependencyError();
    }
  }
  return documents;
}

export function createServiceReportReadStore(env: Env): ServiceReportReadStore {
  const url = baseUrl(env);
  return {
    async get(collection, id) {
      const response = await fetch(`${url}/${collection}/${encodeURIComponent(id)}`, {
        headers: await headers(env),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new ReadDependencyError();
      return parseDocument(await response.json() as FirestoreDocument);
    },

    async batchGet(addresses) {
      if (addresses.length === 0) return [];
      const response = await fetch(`${url}:batchGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await headers(env)) },
        body: JSON.stringify({
          documents: addresses.map(({ collection, id }) =>
            `${databasePath(env)}/${collection}/${id}`
          ),
        }),
      });
      if (!response.ok) throw new ReadDependencyError();
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new ReadDependencyError();
      const result: ReadStoredDocument[] = [];
      for (const entry of body) {
        if (!entry || typeof entry !== 'object') throw new ReadDependencyError();
        if ('found' in entry) {
          result.push(parseDocument((entry as { found: FirestoreDocument }).found));
        } else if (!('missing' in entry) || typeof (entry as { missing?: unknown }).missing !== 'string') {
          throw new ReadDependencyError();
        }
      }
      return result;
    },

    queryHistory(serviceJobId, limit) {
      return runQuery(env, {
        from: [{ collectionId: 'serviceReports' }],
        where: equal('serviceJobId', stringValue(serviceJobId)),
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit,
      });
    },

    queryApprovalQueue(input) {
      const filters = [
        equal('brandId', stringValue(input.brandId)),
        equal('schemaVersion', { integerValue: '2' }),
        equal('approvalState', stringValue('pending')),
      ];
      if (input.mode === 'report-number') {
        filters.push(equal('reportNo', stringValue(input.search!)));
      } else if (input.mode === 'tracking-reference') {
        filters.push(equal('snapshot.trackingReference', stringValue(input.search!)));
      }
      return runQuery(env, {
        from: [{ collectionId: 'serviceReports' }],
        where: { compositeFilter: { op: 'AND', filters } },
        orderBy: [
          { field: { fieldPath: 'finalizedAt' }, direction: 'DESCENDING' },
          { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
        ],
        ...(input.cursor
          ? {
              startAt: {
                before: false,
                values: [
                  { timestampValue: input.cursor.finalizedAt },
                  {
                    referenceValue:
                      `${databasePath(env)}/serviceReports/${input.cursor.reportId}`,
                  },
                ],
              },
            }
          : {}),
        limit: input.pageSize + 1,
      });
    },
  };
}

function invalidRequest(message = 'The request is invalid'): never {
  throw new ServiceReportReadError(400, 'invalid_request', message, 'never');
}

function validId(value: string): boolean {
  return ID_PATTERN.test(value);
}

async function authenticate(
  request: Request,
  env: Env,
  tokenVerifier: FirebaseTokenVerifier
): Promise<string> {
  const token = readBearerToken(request.headers.get('Authorization'));
  if (!token) {
    throw new ServiceReportReadError(
      401, 'authentication_required', 'Authentication is required', 'never'
    );
  }
  try {
    return (await tokenVerifier.verify(token, env.FIRESTORE_PROJECT_ID)).uid;
  } catch {
    throw new ServiceReportReadError(
      401, 'authentication_required', 'Authentication is required', 'never'
    );
  }
}

async function requireEmptyBody(request: Request): Promise<void> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 0)) {
    invalidRequest('GET requests must not include a body');
  }
  if (request.body && (await request.arrayBuffer()).byteLength > 0) {
    invalidRequest('GET requests must not include a body');
  }
}

function requireQueryGrammar(url: URL, allowed: readonly string[]): void {
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowed.includes(key) || seen.has(key)) invalidRequest();
    seen.add(key);
  }
}

function parsePageSize(url: URL): number {
  const raw = url.searchParams.get('pageSize');
  if (raw === null) return DEFAULT_PAGE_SIZE;
  if (!/^[0-9]+$/.test(raw)) invalidRequest('pageSize is invalid');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    invalidRequest('pageSize is invalid');
  }
  return value;
}

function decodeBase64Url(value: string): string {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    invalidRequest('cursor is invalid');
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (value.length % 4)) % 4);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    );
  } catch {
    invalidRequest('cursor is invalid');
  }
}

function encodeBase64Url(value: string): string {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseCursor(
  encoded: string | null,
  mode: ApprovalQueueMode,
  search: string | null
): ApprovalQueueCursor | null {
  if (encoded === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Url(encoded));
  } catch (error) {
    if (error instanceof ServiceReportReadError) throw error;
    invalidRequest('cursor is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidRequest('cursor is invalid');
  const cursor = value as Record<string, unknown>;
  if (
    !exactKeys(cursor, ['v', 'mode', 'search', 'finalizedAt', 'reportId']) ||
    cursor.v !== 1 || cursor.mode !== mode || cursor.search !== search ||
    !isCanonicalTimestampMs(cursor.finalizedAt) ||
    typeof cursor.reportId !== 'string' || !validId(cursor.reportId)
  ) invalidRequest('cursor is invalid');
  const canonical = JSON.stringify({
    v: 1,
    mode,
    search,
    finalizedAt: cursor.finalizedAt,
    reportId: cursor.reportId,
  });
  if (encodeBase64Url(canonical) !== encoded) invalidRequest('cursor is invalid');
  return JSON.parse(canonical) as ApprovalQueueCursor;
}

function makeCursor(
  mode: ApprovalQueueMode,
  search: string | null,
  report: Extract<ServiceReportV2, { status: 'final' }>
): string {
  return encodeBase64Url(JSON.stringify({
    v: 1,
    mode,
    search,
    finalizedAt: report.finalizedAt,
    reportId: report.reportId,
  }));
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    invalidRequest();
  }
}

function normalizeSearch(mode: ApprovalQueueMode, raw: string | null): string | null {
  if (mode === 'queue') return null;
  if (raw === null) invalidRequest();
  const decoded = decodePathSegment(raw).trim();
  if (mode === 'report-number') {
    const normalized = decoded.toUpperCase();
    if (!REPORT_NUMBER_PATTERN.test(normalized)) invalidRequest('report number is invalid');
    return normalized;
  }
  const bytes = encoder.encode(decoded).byteLength;
  if (bytes < 1 || bytes > 128 || !TRACKING_REFERENCE_PATTERN.test(decoded)) {
    invalidRequest('tracking reference is invalid');
  }
  return decoded;
}

function parseCoreProfile(
  uid: string,
  document: ReadStoredDocument | null
): CoreStaffProfile | null {
  if (!document || document.collection !== 'staffProfiles') return null;
  return parseCoreStaffProfile(
    uid,
    document.id,
    document.data.brandId,
    document.data.canImportProducts
  );
}

function parseApprovalProfile(
  core: CoreStaffProfile,
  document: ReadStoredDocument
): RepairReportActorProfile | null {
  return parseRepairReportActorProfile(core, document.data.role, document.data.displayName);
}

function serviceJobBrand(
  document: ReadStoredDocument | null,
  expectedId: string
): BrandId | null {
  if (
    !document || document.collection !== 'serviceJobs' || document.id !== expectedId ||
    (document.data.id !== undefined && document.data.id !== expectedId) ||
    !isCanonicalBrandId(document.data.brandId)
  ) return null;
  return document.data.brandId;
}

function historyIntegrity(): never {
  throw new ServiceReportReadError(
    409, 'history_integrity_incident', 'Service Report history is unavailable', 'operator'
  );
}

function approvalIntegrity(): never {
  throw new ServiceReportReadError(
    409, 'approval_queue_integrity_incident', 'The approval queue is unavailable', 'operator'
  );
}

function parseLegacyReport(document: ReadStoredDocument): ServiceReport | null {
  if (document.collection !== 'serviceReports' || !exactKeys(document.data, V1_KEYS)) return null;
  const candidate = { ...document.data, id: document.id };
  return isValidServiceReport(candidate) ? candidate : null;
}

function historyItem(document: ReadStoredDocument, serviceJobId: string, brandId: BrandId) {
  if (document.collection !== 'serviceReports') historyIntegrity();
  if (document.data.schemaVersion === 2) {
    const report = parseServiceReportV2(document.id, document.data);
    if (!report || report.serviceJobId !== serviceJobId || report.brandId !== brandId) {
      historyIntegrity();
    }
    return {
      historyItemVersion: 1 as const,
      sourceSchemaVersion: 2 as const,
      id: report.id,
      serviceJobId: report.serviceJobId,
      reportNo: report.reportNo,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      finalizedAt: report.finalizedAt,
      technician: report.technician,
      customerReportedProblem: report.customerReportedProblem,
      inspectionFindings: report.inspectionFindings,
      serviceActions: report.serviceActions,
      parts: report.parts,
      technicianRemark: report.technicianRemark,
      resultStatus: report.resultStatus,
      resultDetail: report.resultDetail,
      evidenceAttachmentIds: report.evidenceAttachmentIds,
      claimNo: report.claimNo,
      factoryReference: report.factoryReference,
      snapshot: report.snapshot,
      warrantyOutcome: report.warrantyOutcome,
      approvalState: report.approvalState,
      contentRevision: report.contentRevision,
      finalContentDigest: report.finalContentDigest,
      predecessorReportId: report.predecessorReportId,
    };
  }
  const report = parseLegacyReport(document);
  if (!report || report.serviceJobId !== serviceJobId) historyIntegrity();
  return {
    historyItemVersion: 1 as const,
    sourceSchemaVersion: 1 as const,
    ...report,
  };
}

async function verifyPendingReport(
  document: ReadStoredDocument
): Promise<Extract<ServiceReportV2, { status: 'final' }>> {
  if (document.collection !== 'serviceReports') approvalIntegrity();
  const parsed = parseServiceReportV2(document.id, document.data);
  if (!parsed || parsed.status !== 'final' || parsed.approvalState !== 'pending') {
    approvalIntegrity();
  }
  if (await computeServiceReportFinalDigest(parsed) !== parsed.finalContentDigest) {
    approvalIntegrity();
  }
  return parsed;
}

function queueItem(report: Extract<ServiceReportV2, { status: 'final' }>) {
  return {
    queueItemVersion: 1 as const,
    reportId: report.reportId,
    serviceJobId: report.serviceJobId,
    reportNo: report.reportNo,
    trackingReference: report.snapshot.trackingReference,
    finalizedAt: report.finalizedAt,
    approvalState: 'pending' as const,
    predecessorReportId: report.predecessorReportId,
    technician: report.technician,
    finalizedByDisplayName: report.finalizedByDisplayNameSnapshot,
    warrantyOutcome: report.warrantyOutcome,
    customerName: report.snapshot.customerName,
    productName: report.snapshot.productName,
    modelOrSku: report.snapshot.modelOrSku,
    serialNumber: report.snapshot.serialNumber,
    customerReportedProblem: report.customerReportedProblem,
    resultStatus: report.resultStatus,
    finalContentDigest: report.finalContentDigest,
    evidenceCount: report.evidenceAttachmentIds.length,
  };
}

function review(report: Extract<ServiceReportV2, { status: 'final' }>) {
  return {
    reviewVersion: 1 as const,
    reportId: report.reportId,
    serviceJobId: report.serviceJobId,
    reportNo: report.reportNo,
    createdAt: report.createdAt,
    finalizedAt: report.finalizedAt,
    approvalState: 'pending' as const,
    predecessorReportId: report.predecessorReportId,
    createdBy: {
      role: report.createdByRoleSnapshot,
      displayName: report.createdByDisplayNameSnapshot,
    },
    finalizedBy: {
      role: report.finalizedByRoleSnapshot,
      displayName: report.finalizedByDisplayNameSnapshot,
    },
    content: {
      technician: report.technician,
      customerReportedProblem: report.customerReportedProblem,
      inspectionFindings: report.inspectionFindings,
      serviceActions: report.serviceActions,
      parts: report.parts,
      technicianRemark: report.technicianRemark,
      resultStatus: report.resultStatus,
      resultDetail: report.resultDetail,
      evidenceAttachmentIds: report.evidenceAttachmentIds,
      claimNo: report.claimNo,
      factoryReference: report.factoryReference,
      warrantyOutcome: report.warrantyOutcome,
    },
    snapshot: report.snapshot,
    finalizedFromRevision: report.finalizedFromRevision,
    finalContentDigest: report.finalContentDigest,
  };
}

export interface ServiceReportReadRouteDependencies {
  tokenVerifier: FirebaseTokenVerifier;
  createReadStore?: (env: Env) => ServiceReportReadStore;
}

async function runRead(
  request: Request,
  env: Env,
  dependencies: ServiceReportReadRouteDependencies,
  operation: (context: {
    uid: string;
    store: ServiceReportReadStore;
    requestId: string;
  }) => Promise<Response>
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await authenticate(request, env, dependencies.tokenVerifier);
    await requireEmptyBody(request);
    return await operation({
      uid,
      store: (dependencies.createReadStore ?? createServiceReportReadStore)(env),
      requestId,
    });
  } catch (error) {
    if (error instanceof ServiceReportReadError) return failure(requestId, error);
    console.error(`[service-report-read] request ${requestId} failed`);
    return failure(
      requestId,
      new ServiceReportReadError(
        503, 'dependency_unavailable', 'A required dependency is unavailable', 'reload'
      )
    );
  }
}

export function handleServiceReportHistoryRead(
  request: Request,
  env: Env,
  rawServiceJobId: string,
  dependencies: ServiceReportReadRouteDependencies
): Promise<Response> {
  return runRead(request, env, dependencies, async ({ uid, store, requestId }) => {
    const url = new URL(request.url);
    requireQueryGrammar(url, []);
    const serviceJobId = decodePathSegment(rawServiceJobId);
    if (!validId(serviceJobId)) invalidRequest('Service Job ID is invalid');
    const profile = parseCoreProfile(uid, await store.get('staffProfiles', uid));
    if (!profile) {
      throw new ServiceReportReadError(
        403, 'staff_access_denied', 'Staff access is denied', 'never'
      );
    }
    const brandId = serviceJobBrand(
      await store.get('serviceJobs', serviceJobId),
      serviceJobId
    );
    if (!brandId || brandId !== profile.brandId) {
      throw new ServiceReportReadError(
        403, 'service_job_access_denied', 'Service Job access is denied', 'never'
      );
    }
    const documents = await store.queryHistory(serviceJobId, HISTORY_LIMIT);
    // The sentinel is decided on the RETURNED ROW COUNT, strictly before any
    // row is parsed. Parsing first would let one malformed row inside an
    // over-limit page surface as history_integrity_incident, making the
    // outcome depend on row content rather than on the count alone.
    if (documents.length === HISTORY_LIMIT) {
      throw new ServiceReportReadError(
        409, 'history_limit_exceeded', 'Service Report history exceeds the supported limit', 'operator'
      );
    }
    const reports = documents.map((document) => historyItem(document, serviceJobId, brandId));
    return success(requestId, {
      serviceJobId,
      reports: orderServiceReports(reports),
    });
  });
}

export function handleApprovalQueueRead(
  request: Request,
  env: Env,
  mode: ApprovalQueueMode,
  rawSearch: string | null,
  dependencies: ServiceReportReadRouteDependencies
): Promise<Response> {
  return runRead(request, env, dependencies, async ({ uid, store, requestId }) => {
    const url = new URL(request.url);
    requireQueryGrammar(url, ['pageSize', 'cursor']);
    const search = normalizeSearch(mode, rawSearch);
    const pageSize = parsePageSize(url);
    const cursor = parseCursor(url.searchParams.get('cursor'), mode, search);
    const profileDocument = await store.get('staffProfiles', uid);
    const core = parseCoreProfile(uid, profileDocument);
    if (!core) {
      throw new ServiceReportReadError(
        403, 'staff_access_denied', 'Staff access is denied', 'never'
      );
    }
    const profile = parseApprovalProfile(core, profileDocument!);
    if (!profile || (profile.role !== 'approver' && profile.role !== 'admin')) {
      throw new ServiceReportReadError(
        403,
        'approval_console_access_denied',
        'Approval Console access is denied',
        'never'
      );
    }
    const documents = await store.queryApprovalQueue({
      brandId: profile.brandId,
      mode,
      search,
      pageSize,
      cursor,
    });
    if (documents.length > pageSize + 1) throw new ReadDependencyError();
    const reports: Extract<ServiceReportV2, { status: 'final' }>[] = [];
    for (const document of documents) reports.push(await verifyPendingReport(document));
    const jobIds = [...new Set(reports.map((report) => report.serviceJobId))];
    if (jobIds.length > pageSize + 1) approvalIntegrity();
    const jobs = await store.batchGet(
      jobIds.map((id) => ({ collection: 'serviceJobs', id }))
    );
    if (jobs.length !== jobIds.length) approvalIntegrity();
    const jobsById = new Map<string, BrandId>();
    for (const document of jobs) {
      if (!jobIds.includes(document.id) || jobsById.has(document.id)) approvalIntegrity();
      const brandId = serviceJobBrand(document, document.id);
      if (!brandId) approvalIntegrity();
      jobsById.set(document.id, brandId);
    }
    for (const report of reports) {
      const jobBrand = jobsById.get(report.serviceJobId);
      if (!jobBrand || jobBrand !== profile.brandId || report.brandId !== jobBrand) {
        approvalIntegrity();
      }
    }
    const hasLookahead = reports.length > pageSize;
    const returned = reports.slice(0, pageSize);
    return success(requestId, {
      queueContractVersion: 1,
      mode,
      normalizedSearch: search,
      pageSize,
      items: returned.map(queueItem),
      nextCursor: hasLookahead && returned.length > 0
        ? makeCursor(mode, search, returned.at(-1)!)
        : null,
    });
  });
}

export function handleApprovalReviewRead(
  request: Request,
  env: Env,
  rawServiceJobId: string,
  rawReportId: string,
  dependencies: ServiceReportReadRouteDependencies
): Promise<Response> {
  return runRead(request, env, dependencies, async ({ uid, store, requestId }) => {
    const url = new URL(request.url);
    requireQueryGrammar(url, []);
    const serviceJobId = decodePathSegment(rawServiceJobId);
    const reportId = decodePathSegment(rawReportId);
    if (!validId(serviceJobId) || !validId(reportId)) invalidRequest();
    const profileDocument = await store.get('staffProfiles', uid);
    const core = parseCoreProfile(uid, profileDocument);
    if (!core) {
      throw new ServiceReportReadError(
        403, 'staff_access_denied', 'Staff access is denied', 'never'
      );
    }
    const profile = parseApprovalProfile(core, profileDocument!);
    if (!profile || (profile.role !== 'approver' && profile.role !== 'admin')) {
      throw new ServiceReportReadError(
        403,
        'approval_console_access_denied',
        'Approval Console access is denied',
        'never'
      );
    }
    const reportDocument = await store.get('serviceReports', reportId);
    const parsed = reportDocument && reportDocument.collection === 'serviceReports'
      ? parseServiceReportV2(reportDocument.id, reportDocument.data)
      : null;
    const jobDocument = await store.get('serviceJobs', serviceJobId);
    const jobBrand = serviceJobBrand(jobDocument, serviceJobId);
    if (
      !parsed || parsed.serviceJobId !== serviceJobId || !jobBrand ||
      jobBrand !== profile.brandId || parsed.brandId !== jobBrand
    ) {
      throw new ServiceReportReadError(
        403,
        'approval_console_access_denied',
        'Approval Console access is denied',
        'never'
      );
    }
    if (parsed.status !== 'final' || parsed.approvalState !== 'pending') {
      throw new ServiceReportReadError(
        409,
        'approval_review_unavailable',
        'The approval review is no longer available',
        'reload'
      );
    }
    if (await computeServiceReportFinalDigest(parsed) !== parsed.finalContentDigest) {
      throw new ServiceReportReadError(
        409,
        'approval_review_unavailable',
        'The approval review is no longer available',
        'reload'
      );
    }
    return success(requestId, review(parsed));
  });
}
