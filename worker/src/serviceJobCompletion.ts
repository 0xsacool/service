import { bangkokIsoDate, bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import {
  formatReturnFormNumber,
  hasTrustedReturnFormMetadata,
} from '../../src/services/productReturnForm.ts';
import type { BrandId } from './brands.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import { appendServiceJobStatusTimelineEvent } from '../../src/services/serviceJobTimeline.ts';
import {
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';

const MAX_COMPLETION_RETRIES = 5;
const MAX_SEQUENCE_VALUE = 999999;

function nextSequence(value: number | null): number {
  const current = value ?? 0;
  if (
    !Number.isInteger(current) ||
    current < 0 ||
    current >= MAX_SEQUENCE_VALUE
  ) {
    throw new Error('Return Form sequence is malformed or exhausted');
  }
  return current + 1;
}

export interface ServiceJobCompletionDataAccess {
  beginServiceJobTransaction(): Promise<AllocationTransaction>;
  getServiceJob(
    transaction: AllocationTransaction,
    id: string
  ): Promise<ServiceJob | null>;
  getSequence(
    transaction: AllocationTransaction,
    brandId: BrandId,
    type: 'tracking_number' | 'service_request' | 'repair_report' | 'return_form',
    year: number
  ): Promise<number | null>;
  commitServiceJobCompletion(
    transaction: AllocationTransaction,
    input: {
      serviceJobId: string;
      brandId: BrandId;
      returnFormNumber: string;
      sequence: number;
      year: number;
      closedAt: string;
      updatedAt: string;
      timeline: ServiceJob['timeline'];
    }
  ): Promise<void>;
}

export class ServiceJobCompletionNotFoundError extends Error {}
export class ServiceJobCompletionBrandMismatchError extends Error {}
export class ServiceJobCompletionTerminalError extends Error {}
export class ServiceJobCompletionHistoricalStateError extends Error {}

export async function completeServiceJob(input: {
  serviceJobId: string;
  brandId: BrandId;
  dataAccess: ServiceJobCompletionDataAccess;
  now?: () => Date;
}): Promise<ServiceJob> {
  const now = input.now ?? (() => new Date());

  for (let attempt = 0; attempt < MAX_COMPLETION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginServiceJobTransaction();
    const current = await input.dataAccess.getServiceJob(
      transaction,
      input.serviceJobId
    );

    if (!current) {
      throw new ServiceJobCompletionNotFoundError('Service Job not found');
    }
    if (current.brandId !== input.brandId) {
      throw new ServiceJobCompletionBrandMismatchError('Service Job brand mismatch');
    }

    if (current.status === 'Completed') {
      if (!hasTrustedReturnFormMetadata(current)) {
        throw new ServiceJobCompletionHistoricalStateError(
          'Completed Service Job is missing trusted Return Form metadata'
        );
      }
      return current;
    }

    if (current.status === 'Cancelled' || current.status === 'Rejected') {
      throw new ServiceJobCompletionTerminalError(
        'Terminal Service Job cannot transition to Completed'
      );
    }

    const completedAt = now();
    const year = bangkokNumberingYear(completedAt);
    const sequence = nextSequence(
      await input.dataAccess.getSequence(
        transaction,
        input.brandId,
        'return_form',
        year
      )
    );
    const returnFormNumber = formatReturnFormNumber(year, sequence);
    const closedAt = completedAt.toISOString();
    const updatedAt = bangkokIsoDate(completedAt);
    const timeline = appendServiceJobStatusTimelineEvent(
      current.timeline,
      'Completed',
      completedAt
    );

    try {
      await input.dataAccess.commitServiceJobCompletion(transaction, {
        serviceJobId: input.serviceJobId,
        brandId: input.brandId,
        returnFormNumber,
        sequence,
        year,
        closedAt,
        updatedAt,
        timeline,
      });
      return {
        ...current,
        status: 'Completed',
        returnFormNumber,
        closedAt,
        updatedAt,
        timeline,
      };
    } catch (error) {
      if (
        error instanceof TransactionConflictError &&
        attempt + 1 < MAX_COMPLETION_RETRIES
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Service Job completion transaction retries exhausted');
}
