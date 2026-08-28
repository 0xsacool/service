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
  ServiceReportDocument,
  ServiceReportV2,
  ServiceReportV2Content,
  ServiceReportV2DraftPatch,
  FinalContentDigest,
  ServiceReportHistoryItem,
} from '../types';
import type { BrandId } from '../types';
import type {
  CustomerIntakeSelector,
  ServiceJobIntakePayload,
} from '../services/serviceJobCreation';
import type { ProductImportRequest } from '../services/productImportRequest';
import type { ProductImportRowIssue } from '../services/productImportClassification';

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
  // PI-3 Slice 2 reconciliation — getProducts() above is a synchronous
  // facade over a cache (an onSnapshot listener in the Firestore
  // implementation, a plain Map in Mock). After a Worker-mediated write
  // (Product Import), the browser's own onSnapshot connection has no
  // ordering guarantee relative to the Worker's HTTP response reaching the
  // browser first — reading getProducts() immediately after commit() can
  // return pre-write data. This forces a genuine server round-trip before
  // the caller treats getProducts() as canonical, same rationale as
  // firestoreServiceJobRepository.ts's issuePublicTrackingCode() using
  // getDocFromServer() rather than trusting the live listener's timing.
  // Pass specific ids for a targeted refresh (exactly the rows an import
  // touched); omit for a full collection refresh (used when the caller has
  // no list of what changed, e.g. recovering from stale_catalog). The Mock
  // repository's cache is already synchronously authoritative, so this is a
  // no-op there.
  refreshFromServer(productIds?: readonly string[]): Promise<void>;
}

// PI-3 Slice 2 — the codes worker/src/index.ts's POST /products/import can
// return, mirrored here so a caller can react without importing anything
// Worker-side. `stale_catalog` and everything else conclusive need different
// recovery (re-preview vs hard stop), which is why this carries a `code` in
// addition to `status`/`isConclusive` — WorkerServiceReportError/
// PublicTrackingIssuanceError only ever needed the conclusive/ambiguous
// split because they only have one conclusive recovery path each.
export type ProductImportErrorCode =
  | 'authentication_required'
  | 'forbidden'
  | 'validation_failed'
  | 'stale_catalog'
  | 'idempotency_mismatch'
  | 'payload_too_large'
  | 'transaction_retry_exhausted'
  | 'dependency_unavailable';

// Slice 2 reconciliation — this is the ACTUAL wire shape of
// worker/src/index.ts's 400 validation_failed body (`rows: error.rows
// .filter((row) => row.errors.length > 0).map((row) => ({ rowNumber,
// errors }))`), not the full ClassifiedProductImportRow. The earlier draft
// of this type claimed the full row shape (status/productId/changedFields/
// categoryId included) — never true at runtime, just never observed
// because nothing read those fields yet.
export interface ProductImportRowError {
  rowNumber: number;
  errors: ProductImportRowIssue[];
}

export class ProductImportError extends Error {
  public readonly status: number | null;
  public readonly code: ProductImportErrorCode | null;
  // Populated only for validation_failed, mirroring the Worker's response
  // body so the wizard can show row-specific detail without a second round
  // trip.
  public readonly rowErrors: ProductImportRowError[] | null;
  constructor(
    message: string,
    status: number | null,
    code: ProductImportErrorCode | null,
    rowErrors: ProductImportRowError[] | null = null
  ) {
    super(message);
    this.name = 'ProductImportError';
    this.status = status;
    this.code = code;
    this.rowErrors = rowErrors;
  }
  // Same rule as PublicTrackingIssuanceError: a 4xx status is a definite
  // server verdict already reached before any write. No status at all
  // (network failure) or a 5xx leaves the outcome genuinely unknown — only
  // then is it safe to retry with the SAME idempotency key.
  get isConclusive(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

// Slice 2 reconciliation — mirrors worker/src/productImport.ts's
// CompletedProductImportRow exactly (rowNumber/status/productId/warnings as
// message strings). 'error' never appears here: a request with any error
// row is rejected wholesale by ProductImportValidationError before any
// CompletedProductImportRow is ever built, and productId is always a real
// id (server-allocated for 'new', looked up for 'updated'/'skipped') —
// never null, unlike the classification-time row shape.
export interface ProductImportCommittedRow {
  rowNumber: number;
  status: 'new' | 'updated' | 'skipped';
  productId: string;
  warnings: string[];
}

export interface ProductImportCommitResult {
  importId: string;
  replayed: boolean;
  catalogFingerprintBefore: string;
  catalogFingerprintAfter: string;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    warnings: number;
  };
  rows: ProductImportCommittedRow[];
}

// PI-3 Slice 2 — same caller-owns-idempotency-key pattern as
// ServiceReportsRepository.createDraft: only the caller (the wizard
// controller) knows whether a given commit() call is a fresh attempt or a
// same-key retry of an ambiguous prior outcome.
export interface ProductImportRepository {
  commit(
    request: ProductImportRequest,
    idempotencyKey: string
  ): Promise<ProductImportCommitResult>;
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
// regardless of what backs getForJob() later.
export interface AttachmentsRepository {
  getForJob(jobId: string): Attachment[];
  upload(input: UploadAttachmentInput): Promise<Attachment>;
  /**
   * Resolves an attachment id to a viewable URL. Asynchronous in every
   * implementation — Mock reads the Blob it holds locally, Worker-backed
   * performs an authenticated GET through the Worker and reads the response
   * Blob. Neither returns the raw R2 key, a provider URL, a signed URL, or a
   * public URL, and no implementation may start doing so.
   *
   * The returned string is a browser object URL created by
   * `URL.createObjectURL`, and ownership of it transfers to the CALLER. A
   * fresh URL is created per call; the repository retains no reference and
   * never revokes it. The caller must call `URL.revokeObjectURL(url)` once
   * the preview/download no longer needs it — when replacing it, when losing
   * ownership of the surface that displayed it, and on unmount — and must not
   * persist it, because it is valid only for the lifetime of the document
   * that created it.
   *
   * Phase 6R-B.3 (Phase 4R.6R finding R6R-SF2): this replaces wording that
   * called the method synchronous and described Worker-backed resolution as
   * direct provider-string construction. Neither was ever true of the
   * implementations, and useEvidencePreview.ts / useServiceReportEvidence.ts
   * have always depended on the caller-owned disposable behavior stated here.
   */
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
  public readonly code: string | null;
  public readonly retryClass: 'never' | 'reload' | 'same-idempotency-key' | 'operator' | null;
  constructor(
    message: string,
    status: number,
    code: string | null = null,
    retryClass: 'never' | 'reload' | 'same-idempotency-key' | 'operator' | null = null
  ) {
    super(message);
    this.name = 'WorkerServiceReportError';
    this.status = status;
    this.code = code;
    this.retryClass = retryClass;
  }
}

export interface TrustedPrintResult {
  printState: 'legacy-v1' | 'v2-draft' | 'v2-pending' | 'v2-approved' | 'v2-rejected' | 'integrity-incident';
  report: ServiceReportDocument;
  event: Record<string, unknown> | null;
  evidence: { canonicalAttachmentKey: string; status: 'available' | 'missing' }[];
  verifiedAt: string;
}

export interface ServiceReportsRepository {
  fetchHistoryForServiceJob(
    serviceJobId: string,
    signal?: AbortSignal
  ): Promise<readonly ServiceReportHistoryItem[]>;
  listForServiceJob(serviceJobId: string): ServiceReportDocument[];
  getById(reportId: string): ServiceReportDocument | undefined;
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
  createDraftV2(
    serviceJobId: string,
    content: ServiceReportV2Content,
    idempotencyKey: string
  ): Promise<ServiceReportV2>;
  updateDraftV2(
    reportId: string,
    expectedContentRevision: number,
    patch: ServiceReportV2DraftPatch
  ): Promise<ServiceReportV2>;
  finalizeV2(
    reportId: string,
    expectedContentRevision: number,
    idempotencyKey: string
  ): Promise<ServiceReportV2>;
  decideV2(
    reportId: string,
    decision: 'approved' | 'rejected',
    rejectionReason: string | null,
    expectedFinalDigest: FinalContentDigest,
    idempotencyKey: string
  ): Promise<ServiceReportV2>;
  createSuccessorV2(
    predecessorReportId: string,
    expectedPredecessorDigest: FinalContentDigest,
    confirmedOmittedEvidenceAttachmentIds: string[],
    idempotencyKey: string
  ): Promise<ServiceReportV2>;
  trustedPrint(reportId: string, contractVersion: 1 | 2, mode: 'normal' | 'diagnostic'): Promise<TrustedPrintResult>;
}
