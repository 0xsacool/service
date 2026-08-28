export type {
  ServiceJobStatus,
  Priority,
  TimelineEvent,
  ServiceJob,
  ChannelId,
  OrderVerification,
} from './serviceJob';
export {
  CHANNEL_IDS,
  ORDER_VERIFICATIONS,
  isChannelId,
  isOrderVerification,
} from './serviceJob';
export {
  CANONICAL_BRAND_IDS,
  getBrandCode,
  getBrandDisplayLabel,
  getBrandName,
  isCanonicalBrandId,
} from './brand';
export type { BrandId } from './brand';
export type { Customer, NewCustomerDraft } from './customer';
export { createEmptyNewCustomerDraft } from './customer';
export type { Product } from './product';
export type { CustomerSearchResult } from './search';
export type { RegisteredProduct, WarrantyStatus } from './registeredProduct';
export type { ServiceIntakeData, PhotoEvidence } from './serviceIntake';
export type {
  ProductStatus,
  ProductCategory,
  AccessoryDefinition,
  CommonProblemStatus,
  CommonProblemDefinition,
  ProductMasterEntry,
} from './productMaster';
export type {
  Attachment,
  AttachmentCategory,
  CanonicalAttachmentKey,
  RetentionStatus,
  RetentionExtension,
} from './attachment';
export {
  STAFF_ROLES,
  type StaffRole,
  type ApprovalRole,
  type WarrantyOutcome,
  type ApprovalState,
  type FinalContentDigest,
  type RequestFingerprint,
  type ServiceReportV2Content,
  type EditableServiceReportField,
  type ServiceReportV2DraftPatch,
  type ServiceReportV2Draft,
  type ServiceReportV2Final,
  type ServiceReportV2,
  type ServiceReportDocument,
  type ServiceReportApprovalEvent,
  type BrandApprovalPolicy,
  type ServiceReportActiveDraftSlot,
  type ServiceReportSuccessorClaim,
  type AttachmentRetentionHold,
  type AttachmentDeletionClaimState,
  type AttachmentDeletionClaim,
} from './serviceReportV2';
export {
  RESULT_STATUSES,
  SERVICE_ACTIONS,
  type ResultStatus,
  type ServiceAction,
  type ServiceReport,
  type ServiceReportDraftInput,
  type ServiceReportDraftPatch,
  type ServiceReportPart,
  type ServiceReportSnapshot,
} from './serviceReport';
export type {
  ApprovalQueueItemV1,
  ApprovalQueueMode,
  ApprovalQueuePageV1,
  ApprovalQueueRequest,
  ApprovalReviewV1,
  ServiceReportHistoryItem,
  ServiceReportHistoryItemLegacyV1,
  ServiceReportHistoryItemV2,
  ServiceReportHistoryV1,
} from './serviceReportWorkerReads';
