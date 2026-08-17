import {
  createServiceReportDraft,
  formatServiceReportNumber,
  isValidServiceReportPart,
} from '../../src/services/serviceReport.ts';
import { bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import { RESULT_STATUSES, SERVICE_ACTIONS } from '../../src/types/serviceReport.ts';
import type {
  ResultStatus,
  ServiceAction,
  ServiceReport,
  ServiceReportDraftInput,
} from '../../src/types/serviceReport.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { BrandId } from './brands.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  record,
  string,
  strings,
  type AllocationTransaction,
} from './serviceJobCreation.ts';

const MAX_TEXT_FIELD_BYTES = 4000;
const MAX_SHORT_FIELD_BYTES = 200;
const MAX_ACTIONS = 20;
const MAX_PARTS = 50;
const MAX_EVIDENCE_IDS = 50;
const MAX_EVIDENCE_ID_BYTES = 200;

function isServiceAction(value: unknown): value is ServiceAction {
  return typeof value === 'string' && (SERVICE_ACTIONS as readonly string[]).includes(value);
}
function isResultStatus(value: unknown): value is ResultStatus {
  return typeof value === 'string' && (RESULT_STATUSES as readonly string[]).includes(value);
}

const EDITABLE_INPUT_KEYS = [
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

// The Worker's own bounded parser for the optional draft-input sub-object —
// deliberately independent of src/services/serviceReport.ts's
// validateDraftInput() (unexported, and unbounded on string length/array
// count), matching parseServiceJobIntake()'s existing precedent of strict
// wire-boundary bounds distinct from app-side state validation.
export function parseServiceReportDraftInput(value: unknown): ServiceReportDraftInput | null {
  const body = record(value);
  if (!body) return null;
  if (Object.keys(body).some((key) => !(EDITABLE_INPUT_KEYS as readonly string[]).includes(key)))
    return null;

  const result: ServiceReportDraftInput = {};

  if (Object.hasOwn(body, 'technician')) {
    const technician = string(body.technician, MAX_SHORT_FIELD_BYTES, false);
    if (technician === null) return null;
    result.technician = technician;
  }
  if (Object.hasOwn(body, 'customerReportedProblem')) {
    const value = string(body.customerReportedProblem, MAX_TEXT_FIELD_BYTES, false);
    if (value === null) return null;
    result.customerReportedProblem = value;
  }
  if (Object.hasOwn(body, 'inspectionFindings')) {
    const value = string(body.inspectionFindings, MAX_TEXT_FIELD_BYTES, false);
    if (value === null) return null;
    result.inspectionFindings = value;
  }
  if (Object.hasOwn(body, 'serviceActions')) {
    if (!Array.isArray(body.serviceActions) || body.serviceActions.length > MAX_ACTIONS)
      return null;
    if (!body.serviceActions.every(isServiceAction)) return null;
    result.serviceActions = body.serviceActions;
  }
  if (Object.hasOwn(body, 'parts')) {
    if (!Array.isArray(body.parts) || body.parts.length > MAX_PARTS) return null;
    if (!body.parts.every(isValidServiceReportPart)) return null;
    result.parts = body.parts;
  }
  if (Object.hasOwn(body, 'technicianRemark')) {
    const value = string(body.technicianRemark, MAX_TEXT_FIELD_BYTES, false);
    if (value === null) return null;
    result.technicianRemark = value;
  }
  if (Object.hasOwn(body, 'resultStatus')) {
    if (body.resultStatus !== null && !isResultStatus(body.resultStatus)) return null;
    result.resultStatus = body.resultStatus;
  }
  if (Object.hasOwn(body, 'resultDetail')) {
    const value = string(body.resultDetail, MAX_TEXT_FIELD_BYTES, false);
    if (value === null) return null;
    result.resultDetail = value;
  }
  if (Object.hasOwn(body, 'evidenceAttachmentIds')) {
    const ids = strings(body.evidenceAttachmentIds, MAX_EVIDENCE_IDS, MAX_EVIDENCE_ID_BYTES);
    if (ids === null) return null;
    result.evidenceAttachmentIds = ids;
  }
  if (Object.hasOwn(body, 'claimNo')) {
    if (body.claimNo !== null) {
      const value = string(body.claimNo, MAX_SHORT_FIELD_BYTES, false);
      if (value === null) return null;
      result.claimNo = value;
    } else {
      result.claimNo = null;
    }
  }
  if (Object.hasOwn(body, 'factoryReference')) {
    if (body.factoryReference !== null) {
      const value = string(body.factoryReference, MAX_SHORT_FIELD_BYTES, false);
      if (value === null) return null;
      result.factoryReference = value;
    } else {
      result.factoryReference = null;
    }
  }

  return result;
}

// The full POST .../service-reports body parser. The body is optional in
// its entirety ({} — no draft input at all — is valid), unlike
// parseServiceJobCreateRequest()'s always-present `intake` key.
export function parseServiceReportDraftRequest(value: unknown): ServiceReportDraftInput | null {
  const body = record(value);
  if (!body) return null;
  const keys = Object.keys(body);
  if (keys.length === 0) return {};
  if (keys.length === 1 && Object.hasOwn(body, 'input')) {
    return parseServiceReportDraftInput(body.input);
  }
  return null;
}

export function isValidReportId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export interface ActiveDraftLock {
  draftReportId: string;
}

// Thrown when a Service Job already has an active draft — a legitimate
// business rejection, never retried (matches business rule #033).
export class ActiveDraftExistsError extends Error {}
// Thrown only if the parent Service Job vanished between the route's own
// brand-authorization read and this transaction's read — Service Jobs are
// never deleted in this system, so this is defense-in-depth, not an
// expected path.
export class ServiceJobMissingError extends Error {}
// F5d-66 Phase 2B-R2 — thrown when a serviceReportDraftKeys/{key} document
// resolves to a Service Report whose serviceJobId does not match the
// serviceJobId this request was made against. Under normal operation this
// never happens (each client-side logical attempt is scoped to one
// serviceJobId — see src/hooks/serviceReportDraftAttemptKey.ts), but a key
// is only ever guaranteed globally unique, not bound to a specific
// serviceJob by construction; without this check, a key genuinely reused
// or replayed across two different Service Job URLs would silently return
// the wrong job's draft content. Defense-in-depth, never a duplicate write
// — this rejects before any commit is attempted.
export class IdempotencyKeyJobMismatchError extends Error {}

export interface ServiceReportCreationDataAccess {
  beginTransaction(): Promise<AllocationTransaction>;
  getDraftKey(transaction: AllocationTransaction, key: string): Promise<string | null>;
  getServiceReport(
    transaction: AllocationTransaction,
    reportId: string
  ): Promise<ServiceReport | null>;
  getActiveDraftLock(
    transaction: AllocationTransaction,
    serviceJobId: string
  ): Promise<ActiveDraftLock | null>;
  // F5d-66 — deliberately the exact same method name/signature as
  // ServiceJobCreationDataAccess.getSequence (widened to include
  // 'repair_report'); a single firestoreClient.ts implementation already
  // satisfies both interfaces structurally, so no new Firestore-reading
  // code is introduced for FR-{YYYY}-{SEQ} allocation. The type union must
  // stay byte-for-byte identical to ServiceJobCreationDataAccess's — a
  // FirestoreClient implementing both interfaces requires TypeScript to see
  // one identical property type, not just an assignable subset.
  getSequence(
    transaction: AllocationTransaction,
    brandId: BrandId,
    type: 'tracking_number' | 'service_request' | 'repair_report',
    year: number
  ): Promise<number | null>;
  getServiceJob(transaction: AllocationTransaction, id: string): Promise<ServiceJob | null>;
  commitDraftCreation(
    transaction: AllocationTransaction,
    input: {
      key: string;
      report: ServiceReport;
      brandId: BrandId;
      sequence: number;
      year: number;
    }
  ): Promise<void>;
}

export async function allocateServiceReportDraft(input: {
  serviceJobId: string;
  brandId: BrandId;
  key: string;
  input: ServiceReportDraftInput;
  dataAccess: ServiceReportCreationDataAccess;
  now?: () => Date;
}): Promise<ServiceReport> {
  const now = input.now ?? (() => new Date());
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginTransaction();

    const existingReportId = await input.dataAccess.getDraftKey(transaction, input.key);
    if (existingReportId) {
      const existing = await input.dataAccess.getServiceReport(transaction, existingReportId);
      if (!existing) throw new Error('Idempotency record has no canonical Service Report');
      // A replay key is bound to the Service Job it was originally issued
      // for, never merely globally unique by key — see
      // IdempotencyKeyJobMismatchError's own comment.
      if (existing.serviceJobId !== input.serviceJobId) {
        throw new IdempotencyKeyJobMismatchError(
          `Idempotency key is already associated with a different Service Job`
        );
      }
      return existing;
    }

    // Reading the lock here (even though nothing is written to it yet on
    // this branch) is what makes Firestore's own transaction OCC do the
    // right thing on a genuine race: if another concurrent attempt creates
    // this lock between this read and this attempt's commit, Firestore
    // aborts this transaction with a conflict, this loop retries, and the
    // retry's fresh read correctly finds the now-existing lock and rejects
    // with ActiveDraftExistsError instead of allocating a second draft.
    const lock = await input.dataAccess.getActiveDraftLock(transaction, input.serviceJobId);
    if (lock) {
      throw new ActiveDraftExistsError(
        `Service Job "${input.serviceJobId}" already has an active draft Service Report`
      );
    }

    const serviceJob = await input.dataAccess.getServiceJob(transaction, input.serviceJobId);
    if (!serviceJob) {
      throw new ServiceJobMissingError(`Service Job "${input.serviceJobId}" does not exist`);
    }

    const current = now();
    const year = bangkokNumberingYear(current);
    const currentValue =
      (await input.dataAccess.getSequence(transaction, input.brandId, 'repair_report', year)) ??
      0;
    if (!Number.isInteger(currentValue) || currentValue < 0) {
      throw new Error('Firestore Service Report number sequence is malformed');
    }
    const sequence = currentValue + 1;
    const reportNo = formatServiceReportNumber(year, sequence);
    const reportId = crypto.randomUUID();
    const draft = createServiceReportDraft(reportId, reportNo, serviceJob, input.input, current);

    try {
      await input.dataAccess.commitDraftCreation(transaction, {
        key: input.key,
        report: draft,
        brandId: input.brandId,
        sequence,
        year,
      });
      return draft;
    } catch (error) {
      if (error instanceof TransactionConflictError && attempt + 1 < MAX_TRANSACTION_RETRIES)
        continue;
      throw error;
    }
  }
  throw new Error('Service Report draft transaction retries exhausted');
}
