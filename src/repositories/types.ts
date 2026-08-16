import type {
  ServiceJob,
  Customer,
  Product,
  CustomerSearchResult,
  RegisteredProduct,
  ProductCategory,
  AccessoryDefinition,
  CommonProblemDefinition,
  ProductMasterEntry,
  Attachment,
  AttachmentCategory,
  ServiceReport,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import type { BrandId } from '../types';
import type {
  CustomerIntakeSelector,
  ServiceJobIntakePayload,
} from '../services/serviceJobCreation';

export type ServiceJobUpdate = Omit<
  Partial<ServiceJob>,
  'brandId' | 'publicTrackingTokenHash' | 'publicTrackingCodeHash'
>;

export type NewDurableServiceJob = Omit<
  ServiceJob,
  'id' | 'brandId' | 'serviceRequestNumber'
> & {
  brandId: BrandId;
};

export interface ServiceJobIntakeAttempt {
  idempotencyKey: string;
  intake: ServiceJobIntakePayload;
  // F5d-65 — which customer branch this attempt is for. The Firestore
  // repository forwards this to the Worker unchanged; it never inspects or
  // acts on it directly (see firestoreServiceJobRepository.ts).
  customer: CustomerIntakeSelector;
}

// Only ServiceJobIntakeAttempt is accepted by the Firestore repository. The
// other members keep Mock fixtures and legacy offline tests intentionally usable.
export type ServiceJobCreateInput =
  ServiceJobIntakeAttempt | NewDurableServiceJob | ServiceJob;

// Interface-first so a real Supabase-backed implementation (Sprint 3/4) can
// satisfy the same contract without touching any hook or component that
// consumes it — only the object assigned to e.g. `serviceJobsRepository`
// changes.
export interface ServiceJobsRepository {
  getAll(): ServiceJob[];
  getById(id: string): ServiceJob | undefined;
  getByTrackingNumber(trackingNumber: string): ServiceJob | undefined;
  create(job: ServiceJobCreateInput): Promise<ServiceJob>;
  update(id: string, patch: ServiceJobUpdate): Promise<ServiceJob>;
}

export interface CustomersRepository {
  getAll(): Customer[];
}

export interface ProductsRepository {
  getAll(): Product[];
}

export interface SearchRepository {
  search(query: string): CustomerSearchResult[];
  getRecentSearches(): string[];
  getRecentCustomers(): CustomerSearchResult[];
}

export interface RegisteredProductsRepository {
  getForCustomer(customerId: string): RegisteredProduct[];
}

export interface ProductMasterRepository {
  getCategories(): ProductCategory[];
  getProducts(): ProductMasterEntry[];
  getProductById(id: string): ProductMasterEntry | undefined;
  getAccessoriesForProduct(productId: string): AccessoryDefinition[];
  getCommonProblemsForProduct(productId: string): CommonProblemDefinition[];
  createProduct(entry: ProductMasterEntry): ProductMasterEntry;
  updateProduct(id: string, patch: Partial<ProductMasterEntry>): ProductMasterEntry;
}

// The Product Knowledge Base (Sprint P4) — owns the reusable master
// catalogs (accessories, common problems) that products reference by id.
// Kept separate from ProductMasterRepository (which owns product identity
// fields) so future knowledge types — Service Manual, Repair Guide,
// Exploded View, Spare Parts — extend this same repository family without
// redesigning either one.
export interface ProductKnowledgeRepository {
  getAllAccessories(): AccessoryDefinition[];
  getAccessoriesByIds(ids: string[]): AccessoryDefinition[];
  createAccessory(accessory: AccessoryDefinition): AccessoryDefinition;
  getAllCommonProblems(): CommonProblemDefinition[];
  getCommonProblemsByIds(ids: string[]): CommonProblemDefinition[];
  createCommonProblem(problem: CommonProblemDefinition): CommonProblemDefinition;
  updateCommonProblem(
    id: string,
    patch: Partial<CommonProblemDefinition>
  ): CommonProblemDefinition;
}

// The file itself is never part of the input's return shape — Attachment's
// fields (id/path/size/uploadedAt/contentType-confirmed) are only known
// once the upload actually completes, so this is a distinct input type
// rather than Partial<Attachment>.
export interface UploadAttachmentInput {
  jobId: string;
  category: AttachmentCategory;
  file: Blob;
  fileName: string;
  contentType: string;
  uploadedBy: string;
}

// F5b (approved F5 architecture proposal, decision D-E): the one repository
// family in this codebase with genuinely async mutations. getForJob() stays
// synchronous, matching every other repository's sync-facade-over-cache
// shape (DECISIONS.md #018) — today that cache is Mock's in-memory Map or
// the Worker-backed implementation's session-only upload/delete index (see
// workerAttachmentsRepository.ts), and should become a real Firestore
// onSnapshot-backed cache once attachment metadata moves there. upload()/
// deleteAttachment() can never be sync facades — they're real byte
// transport to the Worker, not a cached read — so they stay Promises
// regardless of what backs getForJob() later. getDownloadUrl() is sync
// because both implementations can answer it without a round-trip: Mock via
// a local object URL it already holds, Worker-backed via direct string
// construction (id is always the R2 key — see workerAttachmentsRepository.ts).
export interface AttachmentsRepository {
  getForJob(jobId: string): Attachment[];
  upload(input: UploadAttachmentInput): Promise<Attachment>;
  getDownloadUrl(id: string): Promise<string>;
  deleteAttachment(id: string): Promise<void>;
}

export interface ServiceReportsRepository {
  listForServiceJob(serviceJobId: string): ServiceReport[];
  getById(reportId: string): ServiceReport | undefined;
  createDraft(
    serviceJobId: string,
    input?: ServiceReportDraftInput
  ): Promise<ServiceReport>;
  updateDraft(reportId: string, patch: ServiceReportDraftPatch): Promise<ServiceReport>;
  finalize(reportId: string): Promise<ServiceReport>;
}
