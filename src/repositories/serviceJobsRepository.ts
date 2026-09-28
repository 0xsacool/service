import type { ServiceJob } from '../types';
import type {
  NewDurableServiceJob,
  ServiceJobCreateInput,
  ServiceJobsRepository,
} from './types';
import { mockServiceJobs } from './mockData/serviceJobs.mock';
import {
  formatServiceJobTrackingNumber,
  formatServiceRequestNumber,
  formatReturnFormNumber,
  nextServiceJobSequence,
  serviceJobNumberingYear,
} from './firestore/serviceJobAllocation';
import {
  generatePublicTrackingCode,
  hashPublicTrackingCode,
} from '../services/publicTrackingCode';
import { bumpDataVersion } from './dataVersion';
import { bangkokIsoDate, bangkokNumberingYear } from '../services/bangkokTime';
import { isTrustworthyServiceJobClosedAt } from '../services/serviceJobClosure';
import { isValidReturnFormNumber } from '../services/productReturnForm';

// Session-only persistence, same pattern as productMasterRepository.ts — a
// Map (not the previous mockServiceJobs/createdServiceJobs array split)
// because this repository now supports updates as well as creates (Sprint
// F4B's Save Changes workflow writes here too, alongside useCreateServiceJob).
// Seeded once from the static mock fixture; every read after that goes
// through the Map so a job created or updated this session is immediately
// visible everywhere. Lost on refresh — expected for a mock repository, not
// a bug.
const jobsById = new Map<string, ServiceJob>(mockServiceJobs.map((job) => [job.id, job]));

export const serviceJobsRepository: ServiceJobsRepository = {
  getAll() {
    return Array.from(jobsById.values());
  },
  getById(id) {
    return jobsById.get(id);
  },
  getByTrackingNumber(trackingNumber) {
    // In the current mock model, `id` and the tracking number are the same
    // value. A real backend (DATABASE_SCHEMA.md) separates these into
    // distinct columns — this repository is the seam that absorbs that
    // difference.
    return jobsById.get(trackingNumber);
  },
  async create(job: ServiceJobCreateInput) {
    if ('idempotencyKey' in job) {
      throw new Error('Mock Service Job creation requires a local durable draft');
    }
    if ('id' in job) {
      if (jobsById.has(job.id)) {
        throw new Error(`Cannot create Service Job "${job.id}": target already exists`);
      }
      jobsById.set(job.id, job);
      bumpDataVersion();
      return job;
    }
    const draft: NewDurableServiceJob = job;
    const year = serviceJobNumberingYear(draft.createdAt);
    const brandJobs = Array.from(jobsById.values()).filter(
      (existing) => existing.brandId === draft.brandId
    );
    const trackingPrefix = formatServiceJobTrackingNumber(draft.brandId, year, 1).slice(
      0,
      -6
    );
    const requestPrefix = formatServiceRequestNumber(year, 1).slice(0, -6);
    const highestTracking = brandJobs.reduce((highest, existing) => {
      if (!existing.id.startsWith(trackingPrefix)) return highest;
      return Math.max(highest, Number(existing.id.slice(-6)) || 0);
    }, 0);
    const highestRequest = brandJobs.reduce((highest, existing) => {
      if (!existing.serviceRequestNumber?.startsWith(requestPrefix)) return highest;
      return Math.max(highest, Number(existing.serviceRequestNumber.slice(-6)) || 0);
    }, 0);
    const id = formatServiceJobTrackingNumber(
      draft.brandId,
      year,
      nextServiceJobSequence(highestTracking)
    );
    if (jobsById.has(id)) {
      throw new Error(`Cannot create Service Job "${id}": target already exists`);
    }
    const created: ServiceJob = {
      ...draft,
      id,
      returnFormNumber: null,
      serviceRequestNumber: formatServiceRequestNumber(
        year,
        nextServiceJobSequence(highestRequest)
      ),
    };
    jobsById.set(created.id, created);
    bumpDataVersion();
    return created;
  },
  async update(id, patch) {
    const existing = jobsById.get(id);
    if (!existing) {
      throw new Error(`Cannot update service job "${id}": no such job exists`);
    }
    if (patch.status === 'Completed') {
      throw new Error('Use complete() for the trusted Completed transition');
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'brandId') ||
      Object.prototype.hasOwnProperty.call(patch, 'returnFormNumber') ||
      Object.prototype.hasOwnProperty.call(patch, 'publicTrackingTokenHash') ||
      Object.prototype.hasOwnProperty.call(patch, 'publicTrackingCodeHash')
    ) {
      throw new Error(
        'Cannot change Service Job ownership or public tracking capability'
      );
    }
    const updated = { ...existing, ...patch };
    jobsById.set(id, updated);
    bumpDataVersion();
    return updated;
  },
  async complete(id) {
    const existing = jobsById.get(id);
    if (!existing) {
      throw new Error(`Cannot complete service job "${id}": no such job exists`);
    }
    if (existing.status === 'Completed') {
      if (
        !isValidReturnFormNumber(existing.returnFormNumber) ||
        !isTrustworthyServiceJobClosedAt(existing.closedAt)
      ) {
        throw new Error('Completed Service Job is missing trusted Return Form metadata');
      }
      return existing;
    }
    if (existing.status === 'Cancelled' || existing.status === 'Rejected') {
      throw new Error('Terminal Service Job cannot be completed');
    }
    if (!existing.brandId) {
      throw new Error('Cannot allocate Return Form without a canonical brand');
    }
    const now = new Date();
    const year = bangkokNumberingYear(now);
    const prefix = formatReturnFormNumber(year, 1).slice(0, -6);
    const highest = Array.from(jobsById.values())
      .filter((job) => job.brandId === existing.brandId)
      .reduce((current, job) => {
        if (!job.returnFormNumber?.startsWith(prefix)) return current;
        return Math.max(current, Number(job.returnFormNumber.slice(-6)) || 0);
      }, 0);
    const updated: ServiceJob = {
      ...existing,
      status: 'Completed',
      returnFormNumber: formatReturnFormNumber(year, nextServiceJobSequence(highest)),
      closedAt: now.toISOString(),
      updatedAt: bangkokIsoDate(now),
    };
    jobsById.set(id, updated);
    bumpDataVersion();
    return updated;
  },
  async issuePublicTrackingCode(id) {
    const existing = jobsById.get(id);
    if (!existing) {
      throw new Error(
        `Cannot issue public tracking code for "${id}": no such job exists`
      );
    }
    const code = generatePublicTrackingCode(new Date());
    const codeHash = await hashPublicTrackingCode(code);
    const updated: ServiceJob = { ...existing, publicTrackingCodeHash: codeHash };
    jobsById.set(id, updated);
    bumpDataVersion();
    return { code, job: updated };
  },
};
