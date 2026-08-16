import type {
  CustomerSearchResult,
  NewCustomerDraft,
  RegisteredProduct,
  ServiceIntakeData,
  TimelineEvent,
} from '../types';
import { isCanonicalBrandId, type BrandId } from '../types';
import type { NewDurableServiceJob } from '../repositories/types';
import type { BackendKind } from '../config/backend';
import type { CreatePathAssertion } from '../config/runtimeDiagnostics';
import { formatTime } from '../utils/formatDate';
import { bangkokIsoDate } from './bangkokTime';

export function createReceivedTimelineEvent(receivedAt: Date): TimelineEvent {
  return {
    status: 'Received',
    title: 'Claim received',
    description: 'Product received at the service counter and logged into the system.',
    date: bangkokIsoDate(receivedAt),
    time: formatTime(receivedAt),
    done: true,
    current: true,
  };
}

// F5d-65 — the customer half of intake is now one of two shapes: an already
// existing, already-searched-for customer, or a not-yet-durable walk-in
// entered inline (NewCustomerDraft). Both carry name/phone/email directly so
// buildServiceJobIntakePayload() below needs no branch at all; only the
// discriminant (`kind`) and the existing customer's id differ. A discriminated
// union here (CLAUDE.md: narrowing over assertions) makes "existing id +
// new-customer fields at once" structurally unrepresentable, not just
// runtime-rejected.
export type IntakeCustomer =
  ({ kind: 'existing' } & CustomerSearchResult) | ({ kind: 'new' } & NewCustomerDraft);

// The Worker-facing declaration of which customer branch this creation
// attempt is for. Deliberately minimal — `customerId` exists only so the
// Worker's request parser can reject a malformed/ambiguous body before any
// Firestore call (DECISIONS.md-style fail-closed parsing); the allocator
// itself only ever inspects `kind`. A brand-new customer carries no id yet
// (the Worker allocates one), so the 'new' branch has no id field at all —
// not an optional one, so an "existing id + new" mix can't be constructed.
export type CustomerIntakeSelector =
  { kind: 'existing'; customerId: string } | { kind: 'new' };

export function buildCustomerIntakeSelector(
  customer: IntakeCustomer
): CustomerIntakeSelector {
  return customer.kind === 'existing'
    ? { kind: 'existing', customerId: customer.id }
    : { kind: 'new' };
}

export interface NewServiceJobInput {
  brandId: BrandId;
  customer: IntakeCustomer;
  product: RegisteredProduct;
  intake: ServiceIntakeData;
}

export interface ServiceJobIntakePayload {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  product: string;
  productCategory: string;
  serialNumber: string;
  problemDescription: string;
  problemChips: string[];
  accessories: string[];
  internalNotes: string;
  photos: string[];
  warranty: boolean;
}

export function buildServiceJobIntakePayload(
  input: Omit<NewServiceJobInput, 'brandId'>
): ServiceJobIntakePayload {
  return {
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    customerEmail: input.customer.email,
    product: `${input.product.productName} ${input.product.model}`.trim(),
    productCategory: input.product.category,
    serialNumber: input.product.serialNumber,
    problemDescription: input.intake.problemDescription,
    problemChips: input.intake.problemChips,
    accessories: input.intake.accessories,
    internalNotes: input.intake.internalNotes,
    photos: input.intake.photos.map((photo) => photo.dataUrl),
    warranty: input.product.warrantyStatus === 'in_warranty',
  };
}

export function buildServerOwnedServiceJob(
  brandId: BrandId,
  intake: ServiceJobIntakePayload,
  now: Date
): NewDurableServiceJob {
  if (!isCanonicalBrandId(brandId)) {
    throw new Error('Cannot create Service Job without a canonical brandId');
  }
  const createdAt = bangkokIsoDate(now);
  const chipsSummary = intake.problemChips.join(', ');
  const issue =
    chipsSummary || intake.problemDescription.trim().slice(0, 80) || 'Reported issue';
  const description =
    intake.problemDescription.trim() ||
    chipsSummary ||
    'No additional description provided.';
  const internalNotes = intake.internalNotes.trim();
  return {
    brandId,
    customerName: intake.customerName,
    customerPhone: intake.customerPhone,
    customerEmail: intake.customerEmail,
    product: intake.product,
    productCategory: intake.productCategory,
    serialNumber: intake.serialNumber,
    issue,
    description,
    status: 'Received',
    priority: 'Normal',
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: intake.warranty,
    photos: intake.photos,
    accessories: intake.accessories,
    timeline: [createReceivedTimelineEvent(now)],
    notes: internalNotes
      ? [{ author: 'Staff', date: createdAt, text: internalNotes }]
      : [],
  };
}

// Assembles a complete ServiceJob from the three pieces confirmed during
// intake — the one place this mapping happens, so NewServiceJob.tsx (and
// any future consumer) never has to re-derive issue/description fallback
// logic, tracking number generation, or the initial timeline event itself.
export function buildNewDurableServiceJob(
  input: NewServiceJobInput
): NewDurableServiceJob {
  if (!isCanonicalBrandId(input.brandId)) {
    throw new Error('Cannot create Service Job without a canonical brandId');
  }

  return buildServerOwnedServiceJob(
    input.brandId,
    buildServiceJobIntakePayload(input),
    new Date()
  );
}

export interface ServiceJobCreateDelegates<T> {
  // Only invoked when backendKind === 'mock' — never gated on Worker
  // readiness, since Mock development must never depend on Worker
  // configuration (F5d-54B Objective 2).
  createViaMock: () => Promise<T>;
  // Only invoked once createPathReadiness.ok === true. Deliberately a
  // lazy delegate (a function, not an already-started Promise) so that
  // nothing it does — including idempotency-key generation — can run
  // before the readiness check below (F5d-54B Objective 5).
  createViaFirestore: () => Promise<T>;
}

// F5d-54B — Terra (F5d-54A) found that assertFirestoreWorkerCreatePath()
// was computed and logged but never enforced: a Service Job create could
// still reach the Firestore repository even when the assertion reported
// `ok: false` (e.g. backendKind=firestore with a non-worker files backend).
// This function is the actual fail-closed enforcement — the runtime
// indicator and the [Create Path] console log remain observability only.
// A Firestore create is allowed only when createPathReadiness.ok is true;
// everything else (Worker fetch, attachment processing, any mutation)
// lives inside createViaFirestore and therefore can never run otherwise.
export async function performServiceJobCreate<T>(
  backendKind: BackendKind | null,
  createPathReadiness: CreatePathAssertion,
  delegates: ServiceJobCreateDelegates<T>
): Promise<T> {
  if (backendKind === 'mock') {
    return await delegates.createViaMock();
  }
  if (!createPathReadiness.ok) {
    throw new Error(
      `Firestore create path is not ready for Worker mode (${createPathReadiness.reasons.join('; ')}). Contact a developer before retrying.`
    );
  }
  return await delegates.createViaFirestore();
}
