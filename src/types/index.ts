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
  RetentionStatus,
  RetentionExtension,
} from './attachment';
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
