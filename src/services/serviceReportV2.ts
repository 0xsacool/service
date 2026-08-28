import { getBrandCode, getBrandName, isCanonicalBrandId } from '../types/brand.ts';
import {
  RESULT_STATUSES,
  SERVICE_ACTIONS,
  type ResultStatus,
  type ServiceAction,
  type ServiceReportPart,
  type ServiceReportSnapshot,
} from '../types/serviceReport.ts';
import {
  STAFF_ROLES,
  type FinalContentDigest,
  type RequestFingerprint,
  type ServiceReportDocument,
  type ServiceReportV2,
  type ServiceReportV2Content,
  type ServiceReportV2DraftPatch,
  type StaffRole,
  type WarrantyOutcome,
} from '../types/serviceReportV2.ts';
import type { ServiceJob } from '../types/serviceJob.ts';
import { isCanonicalAttachmentKey } from './attachmentIdentity.ts';
import { MAX_EVIDENCE_ATTACHMENTS } from './evidenceOmission.ts';

const encoder = new TextEncoder();
const MAX_INT = 2_147_483_647;
const REPORT_NUMBER_PATTERN = /^FR-[0-9]{4}-[0-9]{6}$/;
const DIGEST_PATTERN = /^sha256:v1:[0-9a-f]{64}$/;
const REQUEST_FINGERPRINT_PATTERN = /^sha256:req-v1:[0-9a-f]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTENT_KEYS = [
  'technician',
  'customerReportedProblem',
  'inspectionFindings',
  'serviceActions',
  'parts',
  'technicianRemark',
  'resultStatus',
  'resultDetail',
  'evidenceAttachmentIds',
  'claimNo',
  'factoryReference',
  'warrantyOutcome',
] as const;

export const SERVICE_REPORT_V2_CONTENT_KEYS: readonly (keyof ServiceReportV2Content)[] = CONTENT_KEYS;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyAndAll(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isSafeInt(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= MAX_INT;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function hasDisallowedControl(value: string, allowTabAndLineFeed: boolean): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x7f) return true;
    if (
      codePoint <= 0x1f &&
      !(allowTabAndLineFeed && (codePoint === 0x09 || codePoint === 0x0a))
    ) return true;
  }
  return false;
}

function normalizeSingle(value: unknown, maxBytes: number, allowEmpty: boolean): string | null {
  if (typeof value !== 'string' || hasDisallowedControl(value, false)) return null;
  const normalized = value.normalize('NFC').trim();
  const length = byteLength(normalized);
  return (allowEmpty ? length >= 0 : length >= 1) && length <= maxBytes ? normalized : null;
}

function normalizeMulti(value: unknown, maxBytes: number, allowEmpty: boolean): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if (hasDisallowedControl(normalized, true)) return null;
  const length = byteLength(normalized);
  return (allowEmpty ? length >= 0 : length >= 1) && length <= maxBytes ? normalized : null;
}

function normalizeNullableSingle(value: unknown, maxBytes: number): string | null | undefined {
  if (value === null) return null;
  const normalized = normalizeSingle(value, maxBytes, false);
  return normalized === null ? undefined : normalized;
}

export function isCanonicalTimestampMs(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMESTAMP_MS_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function isLowercaseUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export function isFinalContentDigest(value: unknown): value is FinalContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isRequestFingerprint(value: unknown): value is RequestFingerprint {
  return typeof value === 'string' && REQUEST_FINGERPRINT_PATTERN.test(value);
}

export function isValidStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

function normalizeActions(value: unknown): ServiceAction[] | null {
  if (!Array.isArray(value) || value.length > SERVICE_ACTIONS.length) return null;
  const selected = new Set<ServiceAction>();
  for (const item of value) {
    if (typeof item !== 'string' || !(SERVICE_ACTIONS as readonly string[]).includes(item)) return null;
    if (selected.has(item as ServiceAction)) return null;
    selected.add(item as ServiceAction);
  }
  return SERVICE_ACTIONS.filter((action) => selected.has(action));
}

function normalizePart(value: unknown): ServiceReportPart | null {
  const part = record(value);
  if (!part || !hasOnlyAndAll(part, ['description', 'partNo', 'quantity', 'remark'])) return null;
  const description = normalizeSingle(part.description, 500, true);
  const partNo = normalizeNullableSingle(part.partNo, 200);
  const remark = normalizeMulti(part.remark, 1000, true);
  if (description === null || partNo === undefined || remark === null || !isSafeInt(part.quantity, 1)) {
    return null;
  }
  return { description, partNo, quantity: part.quantity, remark };
}

function normalizeParts(value: unknown): ServiceReportPart[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: ServiceReportPart[] = [];
  for (const item of value) {
    const part = normalizePart(item);
    if (!part) return null;
    result.push(part);
  }
  return result;
}

function normalizeEvidence(value: unknown): ServiceReportV2Content['evidenceAttachmentIds'] | null {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ATTACHMENTS) return null;
  const seen = new Set<string>();
  const result: ServiceReportV2Content['evidenceAttachmentIds'] = [];
  for (const item of value) {
    if (!isCanonicalAttachmentKey(item) || seen.has(item)) return null;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function isResultStatus(value: unknown): value is ResultStatus {
  return typeof value === 'string' && (RESULT_STATUSES as readonly string[]).includes(value);
}

function isWarrantyOutcome(value: unknown): value is WarrantyOutcome {
  return value === 'covered' || value === 'chargeable' || value === 'undetermined';
}

export function normalizeServiceReportV2Content(value: unknown): ServiceReportV2Content | null {
  const content = record(value);
  if (!content || !hasOnlyAndAll(content, CONTENT_KEYS)) return null;
  const technician = normalizeSingle(content.technician, 200, true);
  const customerReportedProblem = normalizeMulti(content.customerReportedProblem, 4000, true);
  const inspectionFindings = normalizeMulti(content.inspectionFindings, 4000, true);
  const serviceActions = normalizeActions(content.serviceActions);
  const parts = normalizeParts(content.parts);
  const technicianRemark = normalizeMulti(content.technicianRemark, 4000, true);
  const resultDetail = normalizeMulti(content.resultDetail, 4000, true);
  const evidenceAttachmentIds = normalizeEvidence(content.evidenceAttachmentIds);
  const claimNo = normalizeNullableSingle(content.claimNo, 200);
  const factoryReference = normalizeNullableSingle(content.factoryReference, 200);
  if (
    technician === null ||
    customerReportedProblem === null ||
    inspectionFindings === null ||
    !serviceActions ||
    !parts ||
    technicianRemark === null ||
    (content.resultStatus !== null && !isResultStatus(content.resultStatus)) ||
    resultDetail === null ||
    !evidenceAttachmentIds ||
    claimNo === undefined ||
    factoryReference === undefined ||
    !isWarrantyOutcome(content.warrantyOutcome)
  ) {
    return null;
  }
  return {
    technician,
    customerReportedProblem,
    inspectionFindings,
    serviceActions,
    parts,
    technicianRemark,
    resultStatus: content.resultStatus,
    resultDetail,
    evidenceAttachmentIds,
    claimNo,
    factoryReference,
    warrantyOutcome: content.warrantyOutcome,
  };
}

export function normalizeServiceReportV2DraftPatch(value: unknown): ServiceReportV2DraftPatch | null {
  const patch = record(value);
  if (!patch) return null;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !CONTENT_KEYS.includes(key as keyof ServiceReportV2Content))) {
    return null;
  }
  const complete = Object.fromEntries(
    CONTENT_KEYS.map((key) => [key, Object.hasOwn(patch, key) ? patch[key] : defaultContent()[key]])
  );
  const normalized = normalizeServiceReportV2Content(complete);
  if (!normalized) return null;
  return Object.fromEntries(keys.map((key) => [key, normalized[key as keyof ServiceReportV2Content]])) as ServiceReportV2DraftPatch;
}

export function defaultContent(): ServiceReportV2Content {
  return {
    technician: '',
    customerReportedProblem: '',
    inspectionFindings: '',
    serviceActions: [],
    parts: [],
    technicianRemark: '',
    resultStatus: null,
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'undetermined',
  };
}

export function isCompleteServiceReportV2Content(content: ServiceReportV2Content): boolean {
  return (
    byteLength(content.customerReportedProblem) > 0 &&
    byteLength(content.inspectionFindings) > 0 &&
    content.serviceActions.length > 0 &&
    content.resultStatus !== null &&
    content.parts.every(
      (part) => byteLength(part.description) > 0 && byteLength(part.remark) > 0
    )
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyAndAll(value, keys);
}

const REPORT_KEYS = [
  'schemaVersion', 'reportId', 'serviceJobId', 'reportNo', 'brandId', 'status',
  'activeDraftGeneration', 'createdAt', 'createdByUid', 'createdByRoleSnapshot',
  'createdByDisplayNameSnapshot', 'contentRevision', 'updatedAt', 'predecessorReportId',
  ...CONTENT_KEYS, 'snapshot', 'finalizedAt', 'finalizedByUid', 'finalizedByRoleSnapshot',
  'finalizedByDisplayNameSnapshot', 'finalizedFromRevision', 'finalContentDigest',
  'approvalState', 'currentApprovalEventId', 'approvalDecidedAt',
] as const;

function isId(value: unknown): value is string {
  return typeof value === 'string' && byteLength(value) >= 1 && byteLength(value) <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function isDisplayName(value: unknown): value is string | null {
  return value === null || normalizeSingle(value, 200, false) === value;
}

function isSnapshot(value: unknown): value is ServiceReportSnapshot {
  const snapshot = record(value);
  if (!snapshot || !exactKeys(snapshot, [
    'trackingReference', 'customerName', 'customerPhone', 'customerEmail', 'brandCode',
    'brandName', 'productName', 'modelOrSku', 'serialNumber', 'customerReportedProblem',
  ])) return false;
  return (
    isId(snapshot.trackingReference) &&
    normalizeSingle(snapshot.customerName, 200, false) === snapshot.customerName &&
    normalizeSingle(snapshot.customerPhone, 64, true) === snapshot.customerPhone &&
    normalizeSingle(snapshot.customerEmail, 320, true) === snapshot.customerEmail &&
    (snapshot.brandCode === 'BRN' || snapshot.brandCode === 'JLC') &&
    normalizeSingle(snapshot.brandName, 100, false) === snapshot.brandName &&
    normalizeSingle(snapshot.productName, 300, false) === snapshot.productName &&
    (snapshot.modelOrSku === null || normalizeSingle(snapshot.modelOrSku, 200, false) === snapshot.modelOrSku) &&
    normalizeSingle(snapshot.serialNumber, 150, true) === snapshot.serialNumber &&
    normalizeMulti(snapshot.customerReportedProblem, 4000, false) === snapshot.customerReportedProblem
  );
}

export type ServiceReportParseResult =
  | { kind: 'v1'; report: import('../types/serviceReport').ServiceReport }
  | { kind: 'v2'; report: ServiceReportV2 }
  | { kind: 'unsupported-schema' }
  | { kind: 'malformed-resource' };

export function parseServiceReportV2(documentId: string, value: unknown): ServiceReportV2 | null {
  const report = record(value);
  if (!report || !exactKeys(report, REPORT_KEYS)) return null;
  const content = normalizeServiceReportV2Content(
    Object.fromEntries(CONTENT_KEYS.map((key) => [key, report[key]]))
  );
  if (
    report.schemaVersion !== 2 || report.reportId !== documentId || !isId(report.reportId) ||
    !isId(report.serviceJobId) || !REPORT_NUMBER_PATTERN.test(String(report.reportNo)) ||
    !isCanonicalBrandId(report.brandId) || (report.status !== 'draft' && report.status !== 'final') ||
    !isSafeInt(report.activeDraftGeneration, 1) || !isCanonicalTimestampMs(report.createdAt) ||
    !isId(report.createdByUid) || !isValidStaffRole(report.createdByRoleSnapshot) ||
    !isDisplayName(report.createdByDisplayNameSnapshot) || !isSafeInt(report.contentRevision) ||
    typeof report.updatedAt !== 'string' || Number.isNaN(Date.parse(report.updatedAt)) ||
    (report.predecessorReportId !== null && !isId(report.predecessorReportId)) || !content
  ) return null;

  const base = { ...report, id: documentId, ...content } as unknown as ServiceReportV2;
  if (report.status === 'draft') {
    if (
      report.snapshot !== null || report.finalizedAt !== null || report.finalizedByUid !== null ||
      report.finalizedByRoleSnapshot !== null || report.finalizedByDisplayNameSnapshot !== null ||
      report.finalizedFromRevision !== null || report.finalContentDigest !== null ||
      report.approvalState !== 'not-submitted' || report.currentApprovalEventId !== null ||
      report.approvalDecidedAt !== null
    ) return null;
    return base;
  }
  if (
    !isSnapshot(report.snapshot) || !isCanonicalTimestampMs(report.finalizedAt) ||
    !isId(report.finalizedByUid) || !isValidStaffRole(report.finalizedByRoleSnapshot) ||
    !isDisplayName(report.finalizedByDisplayNameSnapshot) ||
    !isSafeInt(report.finalizedFromRevision, 1) || report.finalizedFromRevision !== report.contentRevision ||
    !isFinalContentDigest(report.finalContentDigest) ||
    !['pending', 'approved', 'rejected'].includes(String(report.approvalState))
  ) return null;
  if (report.approvalState === 'pending') {
    if (report.currentApprovalEventId !== null || report.approvalDecidedAt !== null) return null;
  } else if (report.currentApprovalEventId !== report.reportId || !isCanonicalTimestampMs(report.approvalDecidedAt)) {
    return null;
  }
  return base;
}

export function createServiceJobSnapshotV2(serviceJob: ServiceJob): ServiceReportSnapshot | null {
  if (!isCanonicalBrandId(serviceJob.brandId)) return null;
  const candidate: ServiceReportSnapshot = {
    trackingReference: serviceJob.id,
    customerName: serviceJob.customerName,
    customerPhone: serviceJob.customerPhone,
    customerEmail: serviceJob.customerEmail,
    brandCode: getBrandCode(serviceJob.brandId),
    brandName: getBrandName(serviceJob.brandId),
    productName: serviceJob.product,
    modelOrSku: null,
    serialNumber: serviceJob.serialNumber,
    customerReportedProblem: serviceJob.issue,
  };
  return isSnapshot(candidate) ? candidate : null;
}

export function buildSuccessorContent(predecessor: ServiceReportV2): ServiceReportV2Content {
  return {
    technician: predecessor.technician,
    customerReportedProblem: predecessor.customerReportedProblem,
    inspectionFindings: predecessor.inspectionFindings,
    serviceActions: [...predecessor.serviceActions],
    parts: predecessor.parts.map((part) => ({ ...part })),
    technicianRemark: predecessor.technicianRemark,
    resultStatus: predecessor.resultStatus,
    resultDetail: predecessor.resultDetail,
    evidenceAttachmentIds: [...predecessor.evidenceAttachmentIds],
    claimNo: predecessor.claimNo,
    factoryReference: predecessor.factoryReference,
    warrantyOutcome: predecessor.warrantyOutcome,
  };
}

function canonicalFinalDigestProjection(report: Extract<ServiceReportV2, { status: 'final' }>) {
  return {
    digestSchema: 'service-report-final:v1',
    serviceReportSchemaVersion: 2,
    reportId: report.reportId,
    serviceJobId: report.serviceJobId,
    reportNo: report.reportNo,
    brandId: report.brandId,
    createdBy: {
      uid: report.createdByUid,
      role: report.createdByRoleSnapshot,
      displayName: report.createdByDisplayNameSnapshot,
    },
    createdAt: report.createdAt,
    predecessorReportId: report.predecessorReportId,
    content: {
      technicianText: report.technician,
      customerReportedProblem: report.customerReportedProblem,
      inspectionFindings: report.inspectionFindings,
      serviceActions: report.serviceActions,
      parts: report.parts.map((part) => ({
        description: part.description,
        partNo: part.partNo,
        quantity: part.quantity,
        remark: part.remark,
      })),
      technicianRemark: report.technicianRemark,
      resultStatus: report.resultStatus,
      resultDetail: report.resultDetail,
      evidenceAttachmentIds: report.evidenceAttachmentIds,
      claimNo: report.claimNo,
      factoryReference: report.factoryReference,
      warrantyOutcome: report.warrantyOutcome,
    },
    serviceJobSnapshot: {
      trackingReference: report.snapshot.trackingReference,
      customerName: report.snapshot.customerName,
      customerPhone: report.snapshot.customerPhone,
      customerEmail: report.snapshot.customerEmail,
      brandCode: report.snapshot.brandCode,
      brandName: report.snapshot.brandName,
      productName: report.snapshot.productName,
      modelOrSku: report.snapshot.modelOrSku,
      serialNumber: report.snapshot.serialNumber,
      customerReportedProblem: report.snapshot.customerReportedProblem,
    },
    finalizedBy: {
      uid: report.finalizedByUid,
      role: report.finalizedByRoleSnapshot,
      displayName: report.finalizedByDisplayNameSnapshot,
    },
    finalizedAt: report.finalizedAt,
    finalizedFromRevision: report.finalizedFromRevision,
  };
}

export function serializeServiceReportFinalDigest(
  report: Extract<ServiceReportV2, { status: 'final' }>
): Uint8Array {
  return encoder.encode(JSON.stringify(canonicalFinalDigestProjection(report)));
}

async function hashHex(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function computeServiceReportFinalDigest(
  report: Extract<ServiceReportV2, { status: 'final' }>
): Promise<FinalContentDigest> {
  return `sha256:v1:${await hashHex(serializeServiceReportFinalDigest(report))}`;
}

export async function computeRequestFingerprint(projection: unknown): Promise<RequestFingerprint> {
  return `sha256:req-v1:${await hashHex(encoder.encode(JSON.stringify(projection)))}`;
}

export function isServiceReportV2(value: ServiceReportDocument): value is ServiceReportV2 {
  return 'schemaVersion' in value && value.schemaVersion === 2;
}
