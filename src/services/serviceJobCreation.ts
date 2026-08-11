import type {
  CustomerSearchResult,
  RegisteredProduct,
  ServiceIntakeData,
  TimelineEvent,
} from '../types';
import { isCanonicalBrandId, type BrandId } from '../types';
import type { NewDurableServiceJob } from '../repositories/types';
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

export interface NewServiceJobInput {
  brandId: BrandId;
  customer: CustomerSearchResult;
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
