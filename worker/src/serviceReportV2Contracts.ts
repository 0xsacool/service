import type { CanonicalAttachmentKey } from '../../src/types/attachment.ts';
import type { ServiceReportDraftPatch } from '../../src/types/serviceReport.ts';
import type {
  FinalContentDigest,
  ServiceReportV2Content,
  ServiceReportV2DraftPatch,
} from '../../src/types/serviceReportV2.ts';
import {
  computeRequestFingerprint,
  isCanonicalTimestampMs,
  isFinalContentDigest,
  isLowercaseUuidV4,
  normalizeServiceReportV2Content,
  normalizeServiceReportV2DraftPatch,
} from '../../src/services/serviceReportV2.ts';
import {
  canonicalizeEvidenceKeys,
  parseConfirmedOmissionSet,
} from '../../src/services/evidenceOmission.ts';
import { parseServiceReportDraftInput } from './serviceReportCreation.ts';

export type RetryClass = 'never' | 'reload' | 'same-idempotency-key' | 'operator';

export class ServiceReportV2Error extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryClass: RetryClass;
  readonly safeData: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryClass: RetryClass,
    safeData: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = 'ServiceReportV2Error';
    this.status = status;
    this.code = code;
    this.retryClass = retryClass;
    this.safeData = safeData;
  }
}

export function v2Success(
  requestId: string,
  data: unknown,
  replayed: boolean,
  status = 200
): Response {
  return new Response(JSON.stringify({ ok: true, requestId, replayed, data }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function v2Failure(requestId: string, error: ServiceReportV2Error): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      requestId,
      error: {
        code: error.code,
        message: error.message,
        retryClass: error.retryClass,
        ...(error.safeData ?? {}),
      },
    }),
    {
      status: error.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

class StrictJsonParser {
  private index = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): unknown {
    const value = this.value();
    this.whitespace();
    if (this.index !== this.source.length) throw new SyntaxError('Trailing JSON data');
    return value;
  }

  private value(): unknown {
    this.whitespace();
    const character = this.source[this.index];
    if (character === '{') return this.object();
    if (character === '[') return this.array();
    if (character === '"') return this.string();
    if (character === 't') return this.literal('true', true);
    if (character === 'f') return this.literal('false', false);
    if (character === 'n') return this.literal('null', null);
    return this.number();
  }

  private object(): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.whitespace();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (true) {
      this.whitespace();
      if (this.source[this.index] !== '"') throw new SyntaxError('Expected object key');
      const key = this.string();
      if (keys.has(key)) throw new SyntaxError('Duplicate JSON member');
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ':') throw new SyntaxError('Expected colon');
      this.index += 1;
      result[key] = this.value();
      this.whitespace();
      const delimiter = this.source[this.index];
      if (delimiter === '}') {
        this.index += 1;
        return result;
      }
      if (delimiter !== ',') throw new SyntaxError('Expected object delimiter');
      this.index += 1;
    }
  }

  private array(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.whitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.whitespace();
      const delimiter = this.source[this.index];
      if (delimiter === ']') {
        this.index += 1;
        return result;
      }
      if (delimiter !== ',') throw new SyntaxError('Expected array delimiter');
      this.index += 1;
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (!escaped && character === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) throw new SyntaxError('Control in JSON string');
      if (!escaped && character === '\\') escaped = true;
      else escaped = false;
      this.index += 1;
    }
    throw new SyntaxError('Unterminated JSON string');
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index)
    );
    if (!match) throw new SyntaxError('Invalid JSON value');
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new SyntaxError('Invalid JSON number');
    return value;
  }

  private literal<T>(source: string, value: T): T {
    if (!this.source.startsWith(source, this.index)) throw new SyntaxError('Invalid JSON literal');
    this.index += source.length;
    return value;
  }

  private whitespace(): void {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1;
  }
}

export function parseStrictJson(source: string): unknown {
  return new StrictJsonParser(source).parse();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? result
    : null;
}

function validation(message = 'The request body is not valid'): never {
  throw new ServiceReportV2Error(400, 'validation_failed', message, 'never');
}

export function requireV2IdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!isLowercaseUuidV4(key)) {
    throw new ServiceReportV2Error(
      428,
      'precondition_required',
      'A lowercase UUIDv4 Idempotency-Key is required',
      'never'
    );
  }
  return key;
}

export interface CreateReportV2Request {
  contractVersion: 2;
  content: ServiceReportV2Content;
}

export function parseCreateReportV2Request(value: unknown): CreateReportV2Request {
  const body = exactRecord(value, ['contractVersion', 'content']);
  if (!body || body.contractVersion !== 2) validation();
  const content = normalizeServiceReportV2Content(body.content);
  if (!content) validation('The complete Service Report content projection is required');
  return { contractVersion: 2, content };
}

export type FinalizeReportRequest =
  | { contractVersion: 2; expectedContentRevision: number }
  | { contractVersion: 1; expectedUpdatedAt: string };

export function parseFinalizeReportRequest(value: unknown): FinalizeReportRequest {
  const body = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (body?.contractVersion === 2) {
    const exact = exactRecord(body, ['contractVersion', 'expectedContentRevision']);
    if (!exact || !Number.isSafeInteger(exact.expectedContentRevision) ||
        Number(exact.expectedContentRevision) < 0) validation();
    return { contractVersion: 2, expectedContentRevision: Number(exact.expectedContentRevision) };
  }
  if (body?.contractVersion === 1) {
    const exact = exactRecord(body, ['contractVersion', 'expectedUpdatedAt']);
    if (!exact || !isCanonicalTimestampMs(exact.expectedUpdatedAt)) validation();
    return { contractVersion: 1, expectedUpdatedAt: String(exact.expectedUpdatedAt) };
  }
  throw new ServiceReportV2Error(428, 'upgrade_required', 'An explicit contractVersion is required', 'never');
}

export interface ApprovalDecisionRequest {
  contractVersion: 2;
  decision: 'approved' | 'rejected';
  rejectionReason: string | null;
  expectedFinalDigest: FinalContentDigest;
}

function normalizeRejectionReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  const length = new TextEncoder().encode(normalized).byteLength;
  if (length < 1 || length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function parseApprovalDecisionRequest(value: unknown): ApprovalDecisionRequest {
  const body = exactRecord(value, [
    'contractVersion', 'decision', 'rejectionReason', 'expectedFinalDigest',
  ]);
  if (!body || body.contractVersion !== 2 || !isFinalContentDigest(body.expectedFinalDigest)) validation();
  if (body.decision === 'approved' && body.rejectionReason === null) {
    return {
      contractVersion: 2,
      decision: 'approved',
      rejectionReason: null,
      expectedFinalDigest: body.expectedFinalDigest,
    };
  }
  if (body.decision === 'rejected') {
    const reason = normalizeRejectionReason(body.rejectionReason);
    if (!reason) validation('A rejection reason between 1 and 2,000 UTF-8 bytes is required');
    return {
      contractVersion: 2,
      decision: 'rejected',
      rejectionReason: reason,
      expectedFinalDigest: body.expectedFinalDigest,
    };
  }
  validation();
}

export interface SuccessorRequest {
  contractVersion: 2;
  expectedPredecessorDigest: FinalContentDigest;
  confirmedOmittedEvidenceAttachmentIds: CanonicalAttachmentKey[];
}

export function parseSuccessorRequest(value: unknown): SuccessorRequest {
  const body = exactRecord(value, [
    'contractVersion', 'expectedPredecessorDigest', 'confirmedOmittedEvidenceAttachmentIds',
  ]);
  if (!body || body.contractVersion !== 2 || !isFinalContentDigest(body.expectedPredecessorDigest)) {
    validation();
  }
  const omissions = parseConfirmedOmissionSet(body.confirmedOmittedEvidenceAttachmentIds);
  if (!omissions.ok) {
    validation(
      omissions.reason === 'duplicate-key'
        ? 'confirmedOmittedEvidenceAttachmentIds must not contain duplicates'
        : 'confirmedOmittedEvidenceAttachmentIds is not valid'
    );
  }
  return {
    contractVersion: 2,
    expectedPredecessorDigest: body.expectedPredecessorDigest,
    confirmedOmittedEvidenceAttachmentIds: omissions.keys,
  };
}

export interface TrustedPrintRequest {
  contractVersion: 1 | 2;
  mode: 'normal' | 'diagnostic';
}

export function parseTrustedPrintRequest(value: unknown): TrustedPrintRequest {
  const body = exactRecord(value, ['contractVersion', 'mode']);
  if (!body || (body.contractVersion !== 1 && body.contractVersion !== 2) ||
      (body.mode !== 'normal' && body.mode !== 'diagnostic')) validation();
  return { contractVersion: body.contractVersion, mode: body.mode };
}

export interface ManualDeletionRequest {
  contractVersion: 2;
  mode: 'manual';
}

export function parseManualDeletionRequest(value: unknown): ManualDeletionRequest {
  const body = exactRecord(value, ['contractVersion', 'mode']);
  if (!body || body.contractVersion !== 2 || body.mode !== 'manual') validation();
  return { contractVersion: 2, mode: 'manual' };
}

export interface LegacyDraftSaveRequest {
  contractVersion: 1;
  expectedUpdatedAt: string;
  patch: ServiceReportDraftPatch;
}

export function parseLegacyDraftSaveRequest(value: unknown): LegacyDraftSaveRequest {
  const body = exactRecord(value, ['contractVersion', 'expectedUpdatedAt', 'patch']);
  if (!body || body.contractVersion !== 1 || !isCanonicalTimestampMs(body.expectedUpdatedAt)) validation();
  const patch = parseServiceReportDraftInput(body.patch);
  if (!patch || Object.keys(patch).length === 0) validation();
  return { contractVersion: 1, expectedUpdatedAt: body.expectedUpdatedAt, patch };
}

export function parseV2DraftPatch(value: unknown): ServiceReportV2DraftPatch {
  const patch = normalizeServiceReportV2DraftPatch(value);
  if (!patch) validation('A non-empty V2 editable-field patch is required');
  return patch;
}

function createFingerprintProjection(serviceJobId: string, request: CreateReportV2Request) {
  const content = request.content;
  return {
    contractVersion: 2,
    operationKind: 'create-report',
    serviceJobId,
    technician: content.technician,
    customerReportedProblem: content.customerReportedProblem,
    inspectionFindings: content.inspectionFindings,
    serviceActions: content.serviceActions,
    parts: content.parts,
    technicianRemark: content.technicianRemark,
    resultStatus: content.resultStatus,
    resultDetail: content.resultDetail,
    evidenceAttachmentIds: content.evidenceAttachmentIds,
    claimNo: content.claimNo,
    factoryReference: content.factoryReference,
    warrantyOutcome: content.warrantyOutcome,
  };
}

export function createReportRequestFingerprint(
  serviceJobId: string,
  request: CreateReportV2Request
): Promise<`sha256:req-v1:${string}`> {
  return computeRequestFingerprint(createFingerprintProjection(serviceJobId, request));
}

export function finalizeRequestFingerprint(
  serviceJobId: string,
  reportId: string,
  request: Extract<FinalizeReportRequest, { contractVersion: 2 }>
): Promise<`sha256:req-v1:${string}`> {
  return computeRequestFingerprint({
    contractVersion: 2,
    operationKind: 'finalize-report',
    serviceJobId,
    reportId,
    expectedContentRevision: request.expectedContentRevision,
  });
}

export function decisionRequestFingerprint(
  serviceJobId: string,
  reportId: string,
  request: ApprovalDecisionRequest
): Promise<`sha256:req-v1:${string}`> {
  return computeRequestFingerprint({
    contractVersion: 2,
    operationKind: 'approval-decision',
    serviceJobId,
    reportId,
    decision: request.decision,
    rejectionReason: request.rejectionReason,
    expectedFinalDigest: request.expectedFinalDigest,
  });
}

export function successorRequestFingerprint(
  serviceJobId: string,
  predecessorReportId: string,
  request: SuccessorRequest
): Promise<`sha256:req-v1:${string}`> {
  return computeRequestFingerprint({
    contractVersion: 2,
    operationKind: 'create-replacement',
    serviceJobId,
    predecessorReportId,
    expectedPredecessorDigest: request.expectedPredecessorDigest,
    confirmedOmittedEvidenceAttachmentIds: canonicalizeEvidenceKeys(
      request.confirmedOmittedEvidenceAttachmentIds
    ),
  });
}

export async function idempotencyDocumentId(rawKey: string): Promise<string> {
  if (!isLowercaseUuidV4(rawKey)) validation('The idempotency key is not valid');
  const bytes = new TextEncoder().encode(`service-report-idempotency-key:v1\0${rawKey}`);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
