import { isCanonicalBrandId } from '../types/brand';
import type {
  ServiceReportApprovalEvent,
  ServiceReportDocument,
  ServiceReportV2,
} from '../types';
import { isValidServiceReport } from '../services/serviceReport';
import {
  isCanonicalTimestampMs,
  isFinalContentDigest,
  isRequestFingerprint,
  parseServiceReportV2,
} from '../services/serviceReportV2';
import { isCanonicalAttachmentKey } from '../services/attachmentIdentity';
import type { TrustedPrintResult } from './types';

const TRUSTED_PRINT_STATES = [
  'legacy-v1',
  'v2-draft',
  'v2-pending',
  'v2-approved',
  'v2-rejected',
  'integrity-incident',
] as const;

type TrustedPrintState = (typeof TRUSTED_PRINT_STATES)[number];

const V1_REPORT_KEYS = [
  'id',
  'serviceJobId',
  'reportNo',
  'status',
  'createdAt',
  'updatedAt',
  'finalizedAt',
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
  'snapshot',
] as const;

const V1_PART_KEYS = ['description', 'partNo', 'quantity', 'remark'] as const;

const V1_SNAPSHOT_KEYS = [
  'trackingReference',
  'customerName',
  'customerPhone',
  'customerEmail',
  'brandCode',
  'brandName',
  'productName',
  'modelOrSku',
  'serialNumber',
  'customerReportedProblem',
] as const;

interface TrustedPrintExpectation {
  reportId: string;
  serviceJobId: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasOnlyAndAllKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isSafeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function hasCanonicalV1NestedShape(report: Record<string, unknown>): boolean {
  if (typeof report.reportNo !== 'string' || !Array.isArray(report.parts)) return false;
  if (
    !report.parts.every((part) => {
      const candidate = record(part);
      return candidate !== null && hasOnlyAndAllKeys(candidate, V1_PART_KEYS);
    })
  ) {
    return false;
  }

  if (report.snapshot === null) return true;
  const snapshot = record(report.snapshot);
  return snapshot !== null && hasOnlyAndAllKeys(snapshot, V1_SNAPSHOT_KEYS);
}

function isTrustedPrintState(value: unknown): value is TrustedPrintState {
  return (
    typeof value === 'string' &&
    (TRUSTED_PRINT_STATES as readonly string[]).includes(value)
  );
}

function parseNullableDisplayName(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined;
}

function parseApprovalEvent(
  value: unknown
): ServiceReportApprovalEvent | null | undefined {
  if (value === null) return null;
  const event = record(value);
  if (!event) return undefined;

  const approverDisplayNameSnapshot = parseNullableDisplayName(
    event.approverDisplayNameSnapshot
  );
  const rejectionReason =
    event.rejectionReason === null || typeof event.rejectionReason === 'string'
      ? event.rejectionReason
      : undefined;
  const approvedEvidenceRetainUntil =
    event.approvedEvidenceRetainUntil === null ||
    isCanonicalTimestampMs(event.approvedEvidenceRetainUntil)
      ? event.approvedEvidenceRetainUntil
      : undefined;

  if (
    event.eventVersion !== 1 ||
    !isNonEmptyString(event.eventId) ||
    !isNonEmptyString(event.reportId) ||
    !isNonEmptyString(event.serviceJobId) ||
    !isCanonicalBrandId(event.brandId) ||
    typeof event.reportNo !== 'string' ||
    !/^FR-[0-9]{4}-[0-9]{6}$/.test(event.reportNo) ||
    !isSafeIntegerAtLeast(event.activeDraftGeneration, 1) ||
    (event.decision !== 'approved' && event.decision !== 'rejected') ||
    !isFinalContentDigest(event.submissionDigest) ||
    !isSafeIntegerAtLeast(event.finalizedFromRevision, 1) ||
    !isNonEmptyString(event.finalizedByUid) ||
    !isNonEmptyString(event.approverUid) ||
    (event.approverRoleSnapshot !== 'approver' &&
      event.approverRoleSnapshot !== 'admin') ||
    approverDisplayNameSnapshot === undefined ||
    !isCanonicalTimestampMs(event.decidedAt) ||
    !isSafeIntegerAtLeast(event.policyVersion, 1) ||
    typeof event.allowSelfApproval !== 'boolean' ||
    typeof event.selfApprovalUsed !== 'boolean' ||
    !isRequestFingerprint(event.requestFingerprint) ||
    approvedEvidenceRetainUntil === undefined
  ) {
    return undefined;
  }

  if (
    rejectionReason === undefined ||
    (event.decision === 'approved' && rejectionReason !== null) ||
    (event.decision === 'rejected' &&
      (!isNonEmptyString(rejectionReason) || rejectionReason.trim().length === 0)) ||
    (event.decision === 'approved' && approvedEvidenceRetainUntil === null) ||
    (event.decision === 'rejected' && approvedEvidenceRetainUntil !== null)
  ) {
    return undefined;
  }

  return {
    eventVersion: 1,
    eventId: event.eventId,
    reportId: event.reportId,
    serviceJobId: event.serviceJobId,
    brandId: event.brandId,
    reportNo: event.reportNo,
    activeDraftGeneration: event.activeDraftGeneration,
    decision: event.decision,
    rejectionReason,
    submissionDigest: event.submissionDigest,
    finalizedFromRevision: event.finalizedFromRevision,
    finalizedByUid: event.finalizedByUid,
    approverUid: event.approverUid,
    approverRoleSnapshot: event.approverRoleSnapshot,
    approverDisplayNameSnapshot,
    decidedAt: event.decidedAt,
    policyVersion: event.policyVersion,
    allowSelfApproval: event.allowSelfApproval,
    selfApprovalUsed: event.selfApprovalUsed,
    requestFingerprint: event.requestFingerprint,
    approvedEvidenceRetainUntil,
  };
}

function parseEvidence(value: unknown): TrustedPrintResult['evidence'] | null {
  if (!Array.isArray(value)) return null;
  const evidence: TrustedPrintResult['evidence'] = [];
  for (const item of value) {
    const candidate = record(item);
    if (
      !candidate ||
      !isCanonicalAttachmentKey(candidate.canonicalAttachmentKey) ||
      (candidate.status !== 'available' && candidate.status !== 'missing')
    ) {
      return null;
    }
    evidence.push({
      canonicalAttachmentKey: candidate.canonicalAttachmentKey,
      status: candidate.status,
    });
  }
  return evidence;
}

function parseV2Report(value: unknown): ServiceReportV2 | null {
  const candidate = record(value);
  if (
    !candidate ||
    typeof candidate.id !== 'string' ||
    typeof candidate.reportId !== 'string' ||
    candidate.id !== candidate.reportId ||
    typeof candidate.reportNo !== 'string'
  ) {
    return null;
  }
  const persisted = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => key !== 'id')
  );
  return parseServiceReportV2(candidate.id, persisted);
}

function matchesExpectation(
  report: ServiceReportDocument,
  expected: TrustedPrintExpectation
): boolean {
  return report.id === expected.reportId && report.serviceJobId === expected.serviceJobId;
}

function eventMatchesReport(
  event: ServiceReportApprovalEvent,
  report: Extract<ServiceReportV2, { status: 'final' }>
): boolean {
  return (
    event.eventId === report.reportId &&
    event.reportId === report.reportId &&
    event.serviceJobId === report.serviceJobId &&
    event.brandId === report.brandId &&
    event.reportNo === report.reportNo &&
    event.activeDraftGeneration === report.activeDraftGeneration &&
    event.submissionDigest === report.finalContentDigest &&
    event.finalizedFromRevision === report.finalizedFromRevision &&
    event.finalizedByUid === report.finalizedByUid &&
    event.decidedAt === report.approvalDecidedAt &&
    event.decision === report.approvalState
  );
}

function evidenceMatchesReport(
  evidence: TrustedPrintResult['evidence'],
  report: ServiceReportV2
): boolean {
  return (
    evidence.length === report.evidenceAttachmentIds.length &&
    evidence.every(
      (item, index) => item.canonicalAttachmentKey === report.evidenceAttachmentIds[index]
    )
  );
}

export function parseTrustedPrintResult(
  value: unknown,
  contractVersion: 1 | 2,
  expected: TrustedPrintExpectation
): TrustedPrintResult | null {
  const payload = record(value);
  if (
    !payload ||
    !isTrustedPrintState(payload.printState) ||
    !isCanonicalTimestampMs(payload.verifiedAt)
  ) {
    return null;
  }

  const event = parseApprovalEvent(payload.event);
  const evidence = parseEvidence(payload.evidence);
  if (event === undefined || evidence === null) return null;

  if (contractVersion === 1) {
    const legacyReport = record(payload.report);
    if (
      payload.printState !== 'legacy-v1' ||
      !legacyReport ||
      !hasOnlyAndAllKeys(legacyReport, V1_REPORT_KEYS) ||
      !hasCanonicalV1NestedShape(legacyReport) ||
      !isValidServiceReport(legacyReport) ||
      !matchesExpectation(legacyReport, expected) ||
      event !== null ||
      evidence.length !== 0
    ) {
      return null;
    }
    return {
      printState: 'legacy-v1',
      report: legacyReport,
      event: null,
      evidence: [],
      verifiedAt: payload.verifiedAt,
    };
  }

  const report = parseV2Report(payload.report);
  if (!report || !matchesExpectation(report, expected)) return null;

  switch (payload.printState) {
    case 'legacy-v1':
      return null;
    case 'v2-draft':
      if (report.status !== 'draft' || event !== null || evidence.length !== 0)
        return null;
      break;
    case 'v2-pending':
      if (
        report.status !== 'final' ||
        report.approvalState !== 'pending' ||
        event !== null ||
        evidence.length !== 0
      ) {
        return null;
      }
      break;
    case 'v2-rejected':
      if (
        report.status !== 'final' ||
        report.approvalState !== 'rejected' ||
        event === null ||
        !eventMatchesReport(event, report) ||
        evidence.length !== 0
      ) {
        return null;
      }
      break;
    case 'v2-approved':
      if (
        report.status !== 'final' ||
        report.approvalState !== 'approved' ||
        event === null ||
        !eventMatchesReport(event, report) ||
        !evidenceMatchesReport(evidence, report) ||
        evidence.some((item) => item.status !== 'available')
      ) {
        return null;
      }
      break;
    case 'integrity-incident':
      if (
        report.status !== 'final' ||
        report.approvalState !== 'approved' ||
        event === null ||
        !eventMatchesReport(event, report) ||
        !evidenceMatchesReport(evidence, report) ||
        !evidence.some((item) => item.status === 'missing')
      ) {
        return null;
      }
      break;
  }

  return {
    printState: payload.printState,
    report,
    event,
    evidence,
    verifiedAt: payload.verifiedAt,
  };
}
