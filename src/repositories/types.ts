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
// F5d-69G — the raw public tracking code (SRV-YYYY-MMDD-XXXXXX) is only ever
// knowable for the single moment it is issued (DECISIONS.md #041's one-way-
// hash security property): it is never re-derivable from a stored
// ServiceJob, which only ever carries the hash. It is therefore returned
// only by the explicit issuance operation below — never by create(), whose
// idempotent replay could otherwise commit a credential and then lose it.
export interface PublicTrackingCodeIssuance {
  code: string;
  job: ServiceJob;
}

// F5d-69G Phase 2-FIX — carries the HTTP status (when there was one) so the
// staff UI can tell a CONCLUSIVE rejection (401/403/400 — nothing was
// written, issuance definitely did not happen) apart from an AMBIGUOUS
// outcome (network failure, or 5xx — the request's real server-side effect
// is unknown, so the credential may in fact be active and simply undelivered).
// The two must never be reported to staff with the same wording, and an
// ambiguous outcome must never trigger an automatic retry/rotation: the only
// safe recovery is an explicit staff-initiated rotation. Same shape and
// rationale as WorkerServiceReportError above, kept at this repository seam
// for the same dependency reason (DECISIONS.md #006/#017).
export class PublicTrackingIssuanceError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'PublicTrackingIssuanceError';
    this.status = status;
  }
  // A conclusive rejection means the Worker positively refused before any
  // write. Anything else (no status at all, or a server-side failure) leaves
  // the outcome genuinely unknown.
  get isConclusive(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

export interface ServiceJobsRepository {
  getAll(): ServiceJob[];
  getById(id: string): ServiceJob | undefined;
  getByTrackingNumber(trackingNumber: string): ServiceJob | undefined;
  create(job: ServiceJobCreateInput): Promise<ServiceJob>;
  update(id: string, patch: ServiceJobUpdate): Promise<ServiceJob>;
  // F5d-69G — staff-triggered only, never automatic and never part of
  // creation. Serves both "issue" (job currently inactive) and "rotate" (job
  // already active) — see worker/src/publicTrackingCodeIssuance.ts's module
  // comment for why there is deliberately only one operation for both, and
  // why an ambiguous/lost response is safely recovered by rotating again
  // rather than by any form of plaintext recovery.
  issuePublicTrackingCode(id: string): Promise<PublicTrackingCodeIssuance>;
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

// F5d-66 Phase 2B-R — carries the HTTP status alongside the Worker's error
// message so a caller (useServiceReports.ts) can distinguish a conclusive
// rejection (e.g. 400/401/403/409 — retrying with the same idempotency key
// serves no purpose) from a genuinely ambiguous outcome (network failure,
// 500, or any other status — the request's real server-side effect is
// unknown, and reusing the same key on retry is what lets a
// lost-success-response replay the canonical draft instead of erroring).
// Defined here (the repository seam), not inside
// firestoreServiceReportsRepository.ts, so hooks can reference it without
// importing a concrete backend implementation file directly — matching
// this project's existing repository-interface-only dependency rule
// (DECISIONS.md #006/#017). Never thrown by the Mock repository.
export class WorkerServiceReportError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkerServiceReportError';
    this.status = status;
  }
}

export interface ServiceReportsRepository {
  listForServiceJob(serviceJobId: string): ServiceReport[];
  getById(reportId: string): ServiceReport | undefined;
  // F5d-66 Phase 2B-R — idempotencyKey is owned by the caller (see
  // useServiceReports.ts), not generated inside this method: only the
  // caller initiating a retry knows whether a given call is a resumption
  // of an earlier logical attempt or a genuinely new one. Optional and
  // ignored by the Mock implementation, which has no real idempotency
  // concept; the Firestore implementation generates its own key when
  // omitted, preserving every existing direct call site untouched.
  createDraft(
    serviceJobId: string,
    input?: ServiceReportDraftInput,
    idempotencyKey?: string
  ): Promise<ServiceReport>;
  updateDraft(reportId: string, patch: ServiceReportDraftPatch): Promise<ServiceReport>;
  finalize(reportId: string): Promise<ServiceReport>;
}
