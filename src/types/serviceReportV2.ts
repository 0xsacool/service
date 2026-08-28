import type { BrandId } from './brand.ts';
import type { CanonicalAttachmentKey } from './attachment.ts';
import type {
  ResultStatus,
  ServiceAction,
  ServiceReportPart,
  ServiceReportSnapshot,
} from './serviceReport.ts';

export const STAFF_ROLES = ['technician', 'approver', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ApprovalRole = Extract<StaffRole, 'approver' | 'admin'>;
export type WarrantyOutcome = 'covered' | 'chargeable' | 'undetermined';
export type ApprovalState = 'not-submitted' | 'pending' | 'approved' | 'rejected';
export type FinalContentDigest = `sha256:v1:${string}`;
export type RequestFingerprint = `sha256:req-v1:${string}`;

export interface ServiceReportV2Content {
  technician: string;
  customerReportedProblem: string;
  inspectionFindings: string;
  serviceActions: ServiceAction[];
  parts: ServiceReportPart[];
  technicianRemark: string;
  resultStatus: ResultStatus | null;
  resultDetail: string;
  evidenceAttachmentIds: CanonicalAttachmentKey[];
  claimNo: string | null;
  factoryReference: string | null;
  warrantyOutcome: WarrantyOutcome;
}

export type EditableServiceReportField = keyof ServiceReportV2Content;
export type ServiceReportV2DraftPatch = Partial<ServiceReportV2Content>;

interface ServiceReportV2Base extends ServiceReportV2Content {
  schemaVersion: 2;
  reportId: string;
  id: string;
  serviceJobId: string;
  reportNo: string;
  brandId: BrandId;
  activeDraftGeneration: number;
  createdAt: string;
  createdByUid: string;
  createdByRoleSnapshot: StaffRole;
  createdByDisplayNameSnapshot: string | null;
  contentRevision: number;
  updatedAt: string;
  predecessorReportId: string | null;
}

export interface ServiceReportV2Draft extends ServiceReportV2Base {
  status: 'draft';
  snapshot: null;
  finalizedAt: null;
  finalizedByUid: null;
  finalizedByRoleSnapshot: null;
  finalizedByDisplayNameSnapshot: null;
  finalizedFromRevision: null;
  finalContentDigest: null;
  approvalState: 'not-submitted';
  currentApprovalEventId: null;
  approvalDecidedAt: null;
}

export interface ServiceReportV2Final extends ServiceReportV2Base {
  status: 'final';
  snapshot: ServiceReportSnapshot;
  finalizedAt: string;
  finalizedByUid: string;
  finalizedByRoleSnapshot: StaffRole;
  finalizedByDisplayNameSnapshot: string | null;
  finalizedFromRevision: number;
  finalContentDigest: FinalContentDigest;
  approvalState: 'pending' | 'approved' | 'rejected';
  currentApprovalEventId: string | null;
  approvalDecidedAt: string | null;
}

export type ServiceReportV2 = ServiceReportV2Draft | ServiceReportV2Final;

export interface ServiceReportApprovalEvent {
  eventVersion: 1;
  eventId: string;
  reportId: string;
  serviceJobId: string;
  brandId: BrandId;
  reportNo: string;
  activeDraftGeneration: number;
  decision: 'approved' | 'rejected';
  rejectionReason: string | null;
  submissionDigest: FinalContentDigest;
  finalizedFromRevision: number;
  finalizedByUid: string;
  approverUid: string;
  approverRoleSnapshot: ApprovalRole;
  approverDisplayNameSnapshot: string | null;
  decidedAt: string;
  policyVersion: number;
  allowSelfApproval: boolean;
  selfApprovalUsed: boolean;
  requestFingerprint: RequestFingerprint;
  approvedEvidenceRetainUntil: string | null;
}

export interface BrandApprovalPolicy {
  schemaVersion: 1;
  brandId: BrandId;
  allowSelfApproval: boolean;
  policyVersion: number;
  updatedAt: string;
  updatedByUid: string;
}

export interface ServiceReportActiveDraftSlot {
  slotVersion: 1;
  serviceJobId: string;
  brandId: BrandId;
  state: 'active' | 'released';
  activeReportId: string | null;
  generation: number;
  lastReleasedReportId: string | null;
  lastReleasedGeneration: number | null;
  updatedAt: string;
}

export interface ServiceReportSuccessorClaim {
  claimVersion: 1;
  predecessorReportId: string;
  successorReportId: string;
  serviceJobId: string;
  brandId: BrandId;
  createdAt: string;
  createdByUid: string;
}

export interface AttachmentRetentionHold {
  holdVersion: 1;
  holdId: `ah1_${string}`;
  approvalEventId: string;
  reportId: string;
  canonicalAttachmentKey: CanonicalAttachmentKey;
  serviceJobId: string;
  brandId: BrandId;
  approvedAt: string;
  retainUntil: string;
  createdByUid: string;
}

export type AttachmentDeletionClaimState =
  | 'claimed'
  | 'deleting'
  | 'r2-deleted'
  | 'completed'
  | 'released'
  | 'failed';

export interface AttachmentDeletionClaim {
  claimVersion: 1;
  claimId: `dc1_${string}`;
  canonicalAttachmentKey: CanonicalAttachmentKey;
  serviceJobId: string;
  brandId: BrandId;
  operationId: string;
  mode: 'manual' | 'retention';
  requestedByUid: string | null;
  workerAttemptId: string;
  fencingToken: number;
  state: AttachmentDeletionClaimState;
  r2ActionStartedAt: string | null;
  leaseExpiresAt: string | null;
  failureClass:
    | null
    | 'preflight-failed'
    | 'eligibility-changed'
    | 'dependency-unavailable'
    | 'r2-head-failed'
    | 'r2-delete-ambiguous'
    | 'metadata-commit-failed'
    | 'reconciliation-required'
    | 'malformed-state';
  createdAt: string;
  updatedAt: string;
}

export type ServiceReportDocument = import('./serviceReport').ServiceReport | ServiceReportV2;
