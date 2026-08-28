import type { WorkerTokenProvider } from '../auth/workerTokenProvider';
import { fetchWithWorkerToken } from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import { isCanonicalAttachmentKey } from '../services/attachmentIdentity';
import { MAX_EVIDENCE_ATTACHMENTS } from '../services/evidenceOmission';
import {
  isCanonicalTimestampMs,
  isFinalContentDigest,
  isValidStaffRole,
} from '../services/serviceReportV2';
import { isValidServiceReport } from '../services/serviceReport';
import {
  RESULT_STATUSES,
  SERVICE_ACTIONS,
  type ServiceReport,
  type ServiceReportPart,
  type ServiceReportSnapshot,
} from '../types/serviceReport';
import type {
  ApprovalQueueItemV1,
  ApprovalQueuePageV1,
  ApprovalQueueRequest,
  ApprovalReviewV1,
  ServiceReportHistoryItem,
  ServiceReportHistoryV1,
} from '../types/serviceReportWorkerReads';
import { WorkerServiceReportError } from './types';

export interface ServiceReportHistoryRepository {
  fetchHistoryForServiceJob(
    serviceJobId: string,
    signal?: AbortSignal
  ): Promise<readonly ServiceReportHistoryItem[]>;
}

export interface ApprovalConsoleRepository {
  fetchPendingApprovalQueue(
    request: ApprovalQueueRequest,
    signal: AbortSignal
  ): Promise<ApprovalQueuePageV1>;
  fetchApprovalReview(
    serviceJobId: string,
    reportId: string,
    signal: AbortSignal
  ): Promise<ApprovalReviewV1>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableId(value: unknown): value is string | null {
  return value === null || id(value);
}

function isReviewPart(value: unknown): value is ServiceReportPart {
  const part = record(value);
  return Boolean(
    part && exactKeys(part, ['description', 'partNo', 'quantity', 'remark']) &&
    typeof part.description === 'string' && nullableString(part.partNo) &&
    Number.isSafeInteger(part.quantity) && Number(part.quantity) >= 1 &&
    Number(part.quantity) <= 2_147_483_647 && typeof part.remark === 'string'
  );
}

function isCanonicalEvidenceList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ATTACHMENTS ||
      !value.every(isCanonicalAttachmentKey)) return false;
  return new Set(value).size === value.length;
}

function hasDistinctActions(value: readonly unknown[]): boolean {
  return new Set(value).size === value.length;
}

function isResultStatus(value: unknown): boolean {
  return value === null ||
    (typeof value === 'string' && (RESULT_STATUSES as readonly string[]).includes(value));
}

function isWarrantyOutcome(value: unknown): boolean {
  return value === 'covered' || value === 'chargeable' || value === 'undetermined';
}

function isApprovalState(value: unknown): boolean {
  return value === 'not-submitted' || value === 'pending' ||
    value === 'approved' || value === 'rejected';
}

function parseSnapshot(value: unknown): ServiceReportSnapshot | null {
  const snapshot = record(value);
  if (!snapshot || !exactKeys(snapshot, [
    'trackingReference', 'customerName', 'customerPhone', 'customerEmail',
    'brandCode', 'brandName', 'productName', 'modelOrSku', 'serialNumber',
    'customerReportedProblem',
  ])) return null;
  if (
    !id(snapshot.trackingReference) || typeof snapshot.customerName !== 'string' ||
    typeof snapshot.customerPhone !== 'string' || typeof snapshot.customerEmail !== 'string' ||
    typeof snapshot.brandCode !== 'string' || typeof snapshot.brandName !== 'string' ||
    typeof snapshot.productName !== 'string' || !nullableString(snapshot.modelOrSku) ||
    typeof snapshot.serialNumber !== 'string' ||
    typeof snapshot.customerReportedProblem !== 'string'
  ) return null;
  return snapshot as unknown as ServiceReportSnapshot;
}

const HISTORY_COMMON_KEYS = [
  'historyItemVersion', 'sourceSchemaVersion', 'id', 'serviceJobId', 'reportNo',
  'status', 'createdAt', 'updatedAt', 'finalizedAt', 'technician',
  'customerReportedProblem', 'inspectionFindings', 'serviceActions', 'parts',
  'technicianRemark', 'resultStatus', 'resultDetail', 'evidenceAttachmentIds',
  'claimNo', 'factoryReference', 'snapshot',
] as const;

const HISTORY_V2_KEYS = [
  ...HISTORY_COMMON_KEYS, 'warrantyOutcome', 'approvalState', 'contentRevision',
  'finalContentDigest', 'predecessorReportId',
] as const;

function parseHistoryItem(value: unknown): ServiceReportHistoryItem | null {
  const item = record(value);
  if (!item || item.historyItemVersion !== 1 ||
      (item.sourceSchemaVersion !== 1 && item.sourceSchemaVersion !== 2)) return null;
  const allowed = item.sourceSchemaVersion === 2 ? HISTORY_V2_KEYS : HISTORY_COMMON_KEYS;
  if (!exactKeys(item, allowed)) return null;
  const snapshot = item.snapshot === null ? null : parseSnapshot(item.snapshot);
  const legacyCandidate: ServiceReport = {
    id: item.id as string,
    serviceJobId: item.serviceJobId as string,
    reportNo: item.reportNo as string,
    status: item.status as ServiceReport['status'],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    finalizedAt: item.finalizedAt as string | null,
    technician: item.technician as string,
    customerReportedProblem: item.customerReportedProblem as string,
    inspectionFindings: item.inspectionFindings as string,
    serviceActions: item.serviceActions as ServiceReport['serviceActions'],
    parts: item.parts as ServiceReport['parts'],
    technicianRemark: item.technicianRemark as string,
    resultStatus: item.resultStatus as ServiceReport['resultStatus'],
    resultDetail: item.resultDetail as string,
    evidenceAttachmentIds: item.evidenceAttachmentIds as string[],
    claimNo: item.claimNo as string | null,
    factoryReference: item.factoryReference as string | null,
    snapshot,
  };
  if (!isValidServiceReport(legacyCandidate)) return null;
  if (item.sourceSchemaVersion === 1) return item as unknown as ServiceReportHistoryItem;
  if (
    !isWarrantyOutcome(item.warrantyOutcome) || !isApprovalState(item.approvalState) ||
    !Number.isSafeInteger(item.contentRevision) || Number(item.contentRevision) < 0 ||
    (item.finalContentDigest !== null && !isFinalContentDigest(item.finalContentDigest)) ||
    !nullableId(item.predecessorReportId) || !Array.isArray(item.parts) ||
    item.parts.length > 50 || !item.parts.every(isReviewPart) ||
    !isCanonicalEvidenceList(item.evidenceAttachmentIds)
  ) return null;
  if (item.status === 'draft') {
    if (item.approvalState !== 'not-submitted' || item.finalContentDigest !== null) return null;
  } else if (
    item.approvalState === 'not-submitted' ||
    !isFinalContentDigest(item.finalContentDigest) ||
    Number(item.contentRevision) < 1
  ) {
    return null;
  }
  return item as unknown as ServiceReportHistoryItem;
}

function parseHistory(value: unknown): ServiceReportHistoryV1 | null {
  const data = record(value);
  if (!data || !exactKeys(data, ['serviceJobId', 'reports']) ||
      !id(data.serviceJobId) || !Array.isArray(data.reports)) return null;
  const reports: ServiceReportHistoryItem[] = [];
  for (const value of data.reports) {
    const report = parseHistoryItem(value);
    if (!report || report.serviceJobId !== data.serviceJobId) return null;
    reports.push(report);
  }
  return { serviceJobId: data.serviceJobId, reports };
}

const QUEUE_ITEM_KEYS = [
  'queueItemVersion', 'reportId', 'serviceJobId', 'reportNo', 'trackingReference',
  'finalizedAt', 'approvalState', 'predecessorReportId', 'technician',
  'finalizedByDisplayName', 'warrantyOutcome', 'customerName', 'productName',
  'modelOrSku', 'serialNumber', 'customerReportedProblem', 'resultStatus',
  'finalContentDigest', 'evidenceCount',
] as const;

function parseQueueItem(value: unknown): ApprovalQueueItemV1 | null {
  const item = record(value);
  if (!item || !exactKeys(item, QUEUE_ITEM_KEYS) || item.queueItemVersion !== 1 ||
      !id(item.reportId) || !id(item.serviceJobId) || !id(item.trackingReference) ||
      typeof item.reportNo !== 'string' || !/^FR-[0-9]{4}-[0-9]{6}$/.test(item.reportNo) ||
      !isCanonicalTimestampMs(item.finalizedAt) || item.approvalState !== 'pending' ||
      !nullableId(item.predecessorReportId) || typeof item.technician !== 'string' ||
      !nullableString(item.finalizedByDisplayName) || !isWarrantyOutcome(item.warrantyOutcome) ||
      typeof item.customerName !== 'string' || typeof item.productName !== 'string' ||
      !nullableString(item.modelOrSku) || typeof item.serialNumber !== 'string' ||
      typeof item.customerReportedProblem !== 'string' || !isResultStatus(item.resultStatus) ||
      !isFinalContentDigest(item.finalContentDigest) ||
      !Number.isSafeInteger(item.evidenceCount) || Number(item.evidenceCount) < 0 ||
      Number(item.evidenceCount) > MAX_EVIDENCE_ATTACHMENTS) return null;
  return item as unknown as ApprovalQueueItemV1;
}

function parseQueuePage(value: unknown): ApprovalQueuePageV1 | null {
  const page = record(value);
  if (!page || !exactKeys(page, [
    'queueContractVersion', 'mode', 'normalizedSearch', 'pageSize', 'items', 'nextCursor',
  ]) || page.queueContractVersion !== 1 ||
      (page.mode !== 'queue' && page.mode !== 'report-number' && page.mode !== 'tracking-reference') ||
      !nullableString(page.normalizedSearch) || !Number.isSafeInteger(page.pageSize) ||
      Number(page.pageSize) < 1 || Number(page.pageSize) > 50 || !Array.isArray(page.items) ||
      !nullableString(page.nextCursor)) return null;
  const items: ApprovalQueueItemV1[] = [];
  for (const value of page.items) {
    const item = parseQueueItem(value);
    if (!item) return null;
    items.push(item);
  }
  if (items.length > Number(page.pageSize)) return null;
  return { ...page, items } as unknown as ApprovalQueuePageV1;
}

function parseActor(value: unknown): ApprovalReviewV1['createdBy'] | null {
  const actor = record(value);
  if (!actor || !exactKeys(actor, ['role', 'displayName']) ||
      !isValidStaffRole(actor.role) || !nullableString(actor.displayName)) return null;
  return actor as unknown as ApprovalReviewV1['createdBy'];
}

function parseReview(value: unknown): ApprovalReviewV1 | null {
  const review = record(value);
  if (!review || !exactKeys(review, [
    'reviewVersion', 'reportId', 'serviceJobId', 'reportNo', 'createdAt', 'finalizedAt',
    'approvalState', 'predecessorReportId', 'createdBy', 'finalizedBy', 'content',
    'snapshot', 'finalizedFromRevision', 'finalContentDigest',
  ]) || review.reviewVersion !== 1 || !id(review.reportId) || !id(review.serviceJobId) ||
      typeof review.reportNo !== 'string' || !/^FR-[0-9]{4}-[0-9]{6}$/.test(review.reportNo) ||
      !isCanonicalTimestampMs(review.createdAt) || !isCanonicalTimestampMs(review.finalizedAt) ||
      review.approvalState !== 'pending' || !nullableId(review.predecessorReportId) ||
      !parseActor(review.createdBy) || !parseActor(review.finalizedBy) ||
      !Number.isSafeInteger(review.finalizedFromRevision) || Number(review.finalizedFromRevision) < 1 ||
      !isFinalContentDigest(review.finalContentDigest) || !parseSnapshot(review.snapshot)) return null;
  const content = record(review.content);
  if (!content || !exactKeys(content, [
    'technician', 'customerReportedProblem', 'inspectionFindings', 'serviceActions',
    'parts', 'technicianRemark', 'resultStatus', 'resultDetail',
    'evidenceAttachmentIds', 'claimNo', 'factoryReference', 'warrantyOutcome',
  ]) || typeof content.technician !== 'string' ||
      typeof content.customerReportedProblem !== 'string' ||
      typeof content.inspectionFindings !== 'string' || !Array.isArray(content.serviceActions) ||
      !content.serviceActions.every((action) => typeof action === 'string' &&
        (SERVICE_ACTIONS as readonly string[]).includes(action)) ||
      !hasDistinctActions(content.serviceActions) || !Array.isArray(content.parts) ||
      content.parts.length > 50 || !content.parts.every(isReviewPart) ||
      typeof content.technicianRemark !== 'string' || !isResultStatus(content.resultStatus) ||
      typeof content.resultDetail !== 'string' || !isCanonicalEvidenceList(content.evidenceAttachmentIds) ||
      !nullableString(content.claimNo) || !nullableString(content.factoryReference) ||
      !isWarrantyOutcome(content.warrantyOutcome)) return null;
  return review as unknown as ApprovalReviewV1;
}

async function readData<T>(
  response: Response,
  parser: (value: unknown) => T | null
): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = record(body);
    const error = envelope ? record(envelope.error) : null;
    throw new WorkerServiceReportError(
      typeof error?.message === 'string'
        ? error.message
        : `Worker Service Report read failed (${response.status})`,
      response.status,
      typeof error?.code === 'string' ? error.code : null,
      error?.retryClass === 'never' || error?.retryClass === 'reload' ||
      error?.retryClass === 'same-idempotency-key' || error?.retryClass === 'operator'
        ? error.retryClass
        : null
    );
  }
  const envelope = record(body);
  if (!envelope || !exactKeys(envelope, ['ok', 'requestId', 'data']) ||
      envelope.ok !== true || typeof envelope.requestId !== 'string') {
    throw new Error('Worker returned a malformed Service Report read envelope');
  }
  const parsed = parser(envelope.data);
  if (!parsed) throw new Error('Worker returned malformed Service Report read data');
  return parsed;
}

function queuePath(request: ApprovalQueueRequest): string {
  if (request.mode === 'queue') return '/service-reports/approval-queue';
  if (request.mode === 'report-number') {
    return `/service-reports/approval-queue/report-number/${encodeURIComponent(request.reportNo)}`;
  }
  return `/service-reports/approval-queue/tracking-reference/${encodeURIComponent(request.trackingReference)}`;
}

function normalizedSearchForRequest(request: ApprovalQueueRequest): string | null {
  if (request.mode === 'queue') return null;
  return request.mode === 'report-number'
    ? request.reportNo.trim().toUpperCase()
    : request.trackingReference.trim();
}

export function createWorkerServiceReportHistoryRepository(
  tokenProvider: WorkerTokenProvider
): ServiceReportHistoryRepository {
  return {
    async fetchHistoryForServiceJob(serviceJobId, signal) {
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${getFilesWorkerBaseUrl()}/service-jobs/${encodeURIComponent(serviceJobId)}/service-reports`,
        { method: 'GET', signal }
      );
      const history = await readData(response, parseHistory);
      if (history.serviceJobId !== serviceJobId) {
        throw new Error('Worker returned history for another Service Job');
      }
      return history.reports;
    },
  };
}

export function createWorkerApprovalConsoleRepository(
  tokenProvider: WorkerTokenProvider
): ApprovalConsoleRepository {
  return {
    async fetchPendingApprovalQueue(request, signal) {
      const url = new URL(`${getFilesWorkerBaseUrl()}${queuePath(request)}`);
      if (request.pageSize !== undefined) url.searchParams.set('pageSize', String(request.pageSize));
      if (request.cursor !== undefined) url.searchParams.set('cursor', request.cursor);
      const response = await fetchWithWorkerToken(tokenProvider, url.toString(), {
        method: 'GET',
        signal,
      });
      const page = await readData(response, parseQueuePage);
      if (
        page.mode !== request.mode ||
        page.normalizedSearch !== normalizedSearchForRequest(request) ||
        page.pageSize !== (request.pageSize ?? 25)
      ) {
        throw new Error('Worker returned an Approval Console page for another request');
      }
      return page;
    },

    async fetchApprovalReview(serviceJobId, reportId, signal) {
      const response = await fetchWithWorkerToken(
        tokenProvider,
        `${getFilesWorkerBaseUrl()}/service-jobs/${encodeURIComponent(serviceJobId)}/service-reports/${encodeURIComponent(reportId)}/approval-review`,
        { method: 'GET', signal }
      );
      const result = await readData(response, parseReview);
      if (result.serviceJobId !== serviceJobId || result.reportId !== reportId) {
        throw new Error('Worker returned an approval review for another resource');
      }
      return result;
    },
  };
}
