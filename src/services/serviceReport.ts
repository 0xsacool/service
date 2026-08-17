// F5d-66 — explicit concrete-file imports (not the '../types' barrel):
// worker/src/serviceReportCreation.ts and serviceReportFinalization.ts now
// reuse this module's pure functions directly, and the Worker's test
// runner loads .ts files via plain Node ESM resolution, which does not
// resolve a bare directory specifier like '../types' the way Vite/tsc's
// bundler-mode resolution does. Matches the same explicit-file convention
// src/services/serviceJobCreation.ts already uses for the same reason.
import { getBrandCode, isCanonicalBrandId, type BrandId } from '../types/brand.ts';
import type { ServiceJob } from '../types/serviceJob.ts';
import {
  RESULT_STATUSES,
  SERVICE_ACTIONS,
  type ResultStatus,
  type ServiceAction,
  type ServiceReport,
  type ServiceReportDraftInput,
  type ServiceReportDraftPatch,
  type ServiceReportPart,
  type ServiceReportSnapshot,
} from '../types/serviceReport.ts';

const BRAND_NAMES = {
  'bruno-thailand': 'Bruno Thailand',
  'join-lux-club': 'Join Lux Club',
} as const;

const REPORT_NUMBER_PATTERN = /^FR-(\d{4})-(\d{6})$/;
const EDITABLE_FIELD_NAMES = [
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
] as const;

type EditableServiceReportFields = Omit<
  ServiceReport,
  | 'id'
  | 'serviceJobId'
  | 'reportNo'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'finalizedAt'
  | 'snapshot'
>;

export interface ServiceReportNumberAllocator {
  allocate(brandId: BrandId, year: number): Promise<string>;
}

export function formatServiceReportNumber(year: number, sequence: number): string {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > 999999
  ) {
    throw new Error('Service Report number components are invalid');
  }
  return `FR-${year}-${String(sequence).padStart(6, '0')}`;
}

export function parseServiceReportNumber(
  reportNo: string
): { year: number; sequence: number } | null {
  const match = REPORT_NUMBER_PATTERN.exec(reportNo);
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
  );
}

function isServiceAction(value: unknown): value is ServiceAction {
  return (
    typeof value === 'string' && (SERVICE_ACTIONS as readonly string[]).includes(value)
  );
}

function isResultStatus(value: unknown): value is ResultStatus {
  return (
    typeof value === 'string' && (RESULT_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidServiceReportPart(value: unknown): value is ServiceReportPart {
  if (!isRecord(value)) return false;
  return (
    typeof value.description === 'string' &&
    (value.partNo === null || typeof value.partNo === 'string') &&
    typeof value.quantity === 'number' &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    typeof value.remark === 'string'
  );
}

function isValidSnapshot(value: unknown): value is ServiceReportSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.trackingReference === 'string' &&
    value.trackingReference.length > 0 &&
    typeof value.customerName === 'string' &&
    typeof value.customerPhone === 'string' &&
    typeof value.customerEmail === 'string' &&
    typeof value.brandCode === 'string' &&
    typeof value.brandName === 'string' &&
    typeof value.productName === 'string' &&
    (value.modelOrSku === null || typeof value.modelOrSku === 'string') &&
    typeof value.serialNumber === 'string' &&
    typeof value.customerReportedProblem === 'string'
  );
}

export function isValidServiceReport(value: unknown): value is ServiceReport {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.serviceJobId !== 'string' ||
    value.serviceJobId.length === 0 ||
    !parseServiceReportNumber(String(value.reportNo)) ||
    (value.status !== 'draft' && value.status !== 'final') ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    (value.finalizedAt !== null && !isTimestamp(value.finalizedAt)) ||
    typeof value.technician !== 'string' ||
    typeof value.customerReportedProblem !== 'string' ||
    typeof value.inspectionFindings !== 'string' ||
    !Array.isArray(value.serviceActions) ||
    !value.serviceActions.every(isServiceAction) ||
    !Array.isArray(value.parts) ||
    !value.parts.every(isValidServiceReportPart) ||
    typeof value.technicianRemark !== 'string' ||
    (value.resultStatus !== null && !isResultStatus(value.resultStatus)) ||
    typeof value.resultDetail !== 'string' ||
    !Array.isArray(value.evidenceAttachmentIds) ||
    !value.evidenceAttachmentIds.every((id) => typeof id === 'string' && id.length > 0) ||
    (value.claimNo !== null && typeof value.claimNo !== 'string') ||
    (value.factoryReference !== null && typeof value.factoryReference !== 'string')
  ) {
    return false;
  }

  if (value.status === 'draft') {
    return value.finalizedAt === null && value.snapshot === null;
  }
  return value.finalizedAt !== null && isValidSnapshot(value.snapshot);
}

function validateDraftInput(input: ServiceReportDraftInput): void {
  if (
    Object.keys(input).some(
      (key) => !(EDITABLE_FIELD_NAMES as readonly string[]).includes(key)
    )
  ) {
    throw new Error('Service Report draft input contains immutable fields');
  }
  if (input.technician !== undefined && typeof input.technician !== 'string') {
    throw new Error('Service Report technician must be a string');
  }
  if (
    input.customerReportedProblem !== undefined &&
    typeof input.customerReportedProblem !== 'string'
  ) {
    throw new Error('Service Report customerReportedProblem must be a string');
  }
  if (
    input.inspectionFindings !== undefined &&
    typeof input.inspectionFindings !== 'string'
  ) {
    throw new Error('Service Report inspectionFindings must be a string');
  }
  if (
    input.serviceActions !== undefined &&
    (!Array.isArray(input.serviceActions) || !input.serviceActions.every(isServiceAction))
  ) {
    throw new Error('Service Report serviceActions contains an unsupported action');
  }
  if (
    input.parts !== undefined &&
    (!Array.isArray(input.parts) || !input.parts.every(isValidServiceReportPart))
  ) {
    throw new Error('Service Report parts are malformed');
  }
  if (
    input.technicianRemark !== undefined &&
    typeof input.technicianRemark !== 'string'
  ) {
    throw new Error('Service Report technicianRemark must be a string');
  }
  if (
    input.resultStatus !== undefined &&
    input.resultStatus !== null &&
    !isResultStatus(input.resultStatus)
  ) {
    throw new Error('Service Report resultStatus is unsupported');
  }
  if (input.resultDetail !== undefined && typeof input.resultDetail !== 'string') {
    throw new Error('Service Report resultDetail must be a string');
  }
  if (
    input.evidenceAttachmentIds !== undefined &&
    (!Array.isArray(input.evidenceAttachmentIds) ||
      !input.evidenceAttachmentIds.every((id) => typeof id === 'string' && id.length > 0))
  ) {
    throw new Error('Service Report evidenceAttachmentIds are malformed');
  }
  if (
    input.claimNo !== undefined &&
    input.claimNo !== null &&
    typeof input.claimNo !== 'string'
  ) {
    throw new Error('Service Report claimNo must be a string or null');
  }
  if (
    input.factoryReference !== undefined &&
    input.factoryReference !== null &&
    typeof input.factoryReference !== 'string'
  ) {
    throw new Error('Service Report factoryReference must be a string or null');
  }
}

function editableFieldsFromInput(
  input: ServiceReportDraftInput
): EditableServiceReportFields {
  return {
    technician: input.technician ?? '',
    customerReportedProblem: input.customerReportedProblem ?? '',
    inspectionFindings: input.inspectionFindings ?? '',
    serviceActions: input.serviceActions ?? [],
    parts: input.parts ?? [],
    technicianRemark: input.technicianRemark ?? '',
    resultStatus: input.resultStatus ?? null,
    resultDetail: input.resultDetail ?? '',
    evidenceAttachmentIds: input.evidenceAttachmentIds ?? [],
    claimNo: input.claimNo ?? null,
    factoryReference: input.factoryReference ?? null,
  };
}

export function createServiceReportDraft(
  reportId: string,
  reportNo: string,
  serviceJob: ServiceJob,
  input: ServiceReportDraftInput = {},
  now: Date = new Date()
): ServiceReport {
  if (!reportId || !serviceJob.id || !isCanonicalBrandId(serviceJob.brandId)) {
    throw new Error('Cannot create a Service Report without a canonical Service Job');
  }
  if (!parseServiceReportNumber(reportNo)) {
    throw new Error('Cannot create a Service Report with an invalid report number');
  }
  validateDraftInput(input);
  const timestamp = now.toISOString();
  const fields = editableFieldsFromInput({
    technician: serviceJob.technician,
    customerReportedProblem: serviceJob.issue,
    ...input,
  });
  return {
    id: reportId,
    serviceJobId: serviceJob.id,
    reportNo,
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    finalizedAt: null,
    ...fields,
    snapshot: null,
  };
}

export function updateServiceReportDraft(
  report: ServiceReport,
  patch: ServiceReportDraftPatch,
  now: Date = new Date()
): ServiceReport {
  if (report.status !== 'draft') {
    throw new Error('Final Service Reports are immutable through ordinary updates');
  }
  validateDraftInput(patch);
  const next: ServiceReport = { ...report, ...patch, updatedAt: now.toISOString() };
  if (!isValidServiceReport(next)) {
    throw new Error('Service Report update would create an invalid draft');
  }
  return next;
}

export function getServiceReportFinalizationErrors(report: ServiceReport): string[] {
  const errors: string[] = [];
  if (!report.customerReportedProblem.trim()) {
    errors.push('Customer reported problem is required');
  }
  if (!report.inspectionFindings.trim()) {
    errors.push('Technical inspection findings are required');
  }
  if (report.serviceActions.length === 0) {
    errors.push('At least one service action is required');
  }
  if (report.resultStatus === null) {
    errors.push('Result status is required');
  }
  if (
    report.parts.some(
      (part) =>
        !part.description.trim() ||
        !part.remark.trim() ||
        !Number.isInteger(part.quantity) ||
        part.quantity < 1
    )
  ) {
    errors.push(
      'Each part requires a description, remark, and positive whole-number quantity'
    );
  }
  return errors;
}

export function buildServiceReportSnapshot(
  serviceJob: ServiceJob,
  report: ServiceReport
): ServiceReportSnapshot {
  if (!isCanonicalBrandId(serviceJob.brandId)) {
    throw new Error(
      'Cannot finalize a Service Report without a canonical Service Job brand'
    );
  }
  return {
    trackingReference: serviceJob.id,
    customerName: serviceJob.customerName,
    customerPhone: serviceJob.customerPhone,
    customerEmail: serviceJob.customerEmail,
    brandCode: getBrandCode(serviceJob.brandId),
    brandName: BRAND_NAMES[serviceJob.brandId],
    productName: serviceJob.product,
    modelOrSku: null,
    serialNumber: serviceJob.serialNumber,
    customerReportedProblem: report.customerReportedProblem,
  };
}

export function finalizeServiceReport(
  report: ServiceReport,
  serviceJob: ServiceJob,
  now: Date = new Date()
): ServiceReport {
  if (report.status !== 'draft') {
    throw new Error('Service Report is already final');
  }
  const finalizationErrors = getServiceReportFinalizationErrors(report);
  if (finalizationErrors.length > 0) {
    throw new Error(`Service Report is incomplete: ${finalizationErrors.join('; ')}`);
  }
  const finalizedAt = now.toISOString();
  const finalized: ServiceReport = {
    ...report,
    status: 'final',
    updatedAt: finalizedAt,
    finalizedAt,
    snapshot: buildServiceReportSnapshot(serviceJob, report),
  };
  if (!isValidServiceReport(finalized)) {
    throw new Error('Service Report finalization would create an invalid report');
  }
  return finalized;
}

export function editableServiceReportFields(
  patch: ServiceReportDraftPatch
): Partial<EditableServiceReportFields> {
  validateDraftInput(patch);
  const fields: Partial<EditableServiceReportFields> = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'technician')) {
    fields.technician = patch.technician;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'customerReportedProblem')) {
    fields.customerReportedProblem = patch.customerReportedProblem;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'inspectionFindings')) {
    fields.inspectionFindings = patch.inspectionFindings;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'serviceActions')) {
    fields.serviceActions = patch.serviceActions;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'parts')) {
    fields.parts = patch.parts;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'technicianRemark')) {
    fields.technicianRemark = patch.technicianRemark;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'resultStatus')) {
    fields.resultStatus = patch.resultStatus;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'resultDetail')) {
    fields.resultDetail = patch.resultDetail;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'evidenceAttachmentIds')) {
    fields.evidenceAttachmentIds = patch.evidenceAttachmentIds;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'claimNo')) {
    fields.claimNo = patch.claimNo;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'factoryReference')) {
    fields.factoryReference = patch.factoryReference;
  }
  return fields;
}

export function orderServiceReports(reports: ServiceReport[]): ServiceReport[] {
  return [...reports].sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    if (created !== 0) return created;
    const reportNo = left.reportNo.localeCompare(right.reportNo);
    if (reportNo !== 0) return reportNo;
    return left.id.localeCompare(right.id);
  });
}
