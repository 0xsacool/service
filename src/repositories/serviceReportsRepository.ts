import type {
  BrandId,
  ServiceReport,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
} from '../types';
import {
  createServiceReportDraft,
  finalizeServiceReport,
  formatServiceReportNumber,
  orderServiceReports,
  updateServiceReportDraft,
} from '../services/serviceReport';
import { bangkokNumberingYear } from '../services/bangkokTime';
import { serviceJobsRepository } from './serviceJobsRepository';
import type { ServiceReportsRepository } from './types';

const reportsById = new Map<string, ServiceReport>();
const nextSequenceByBrandYear = new Map<string, number>();

function requireServiceJob(serviceJobId: string) {
  const serviceJob = serviceJobsRepository.getById(serviceJobId);
  if (!serviceJob) {
    throw new Error(`Cannot use Service Report: no Service Job "${serviceJobId}" exists`);
  }
  return serviceJob;
}

async function allocateReportNumber(brandId: BrandId, year: number): Promise<string> {
  const key = `${brandId}:${year}`;
  const sequence = nextSequenceByBrandYear.get(key) ?? 1;
  nextSequenceByBrandYear.set(key, sequence + 1);
  return formatServiceReportNumber(year, sequence);
}

export const serviceReportsRepository: ServiceReportsRepository = {
  listForServiceJob(serviceJobId) {
    if (!serviceJobsRepository.getById(serviceJobId)) return [];
    return orderServiceReports(
      Array.from(reportsById.values()).filter(
        (report) => report.serviceJobId === serviceJobId
      )
    );
  },

  getById(reportId) {
    const report = reportsById.get(reportId);
    return report && serviceJobsRepository.getById(report.serviceJobId)
      ? report
      : undefined;
  },

  // F5d-66 Phase 2B-R — the interface's optional idempotencyKey parameter
  // is simply not declared here: Mock has no real network/idempotency
  // concept, and TypeScript's structural function typing permits an
  // implementation with fewer parameters than the interface it satisfies.
  async createDraft(serviceJobId, input: ServiceReportDraftInput = {}) {
    const serviceJob = requireServiceJob(serviceJobId);
    if (!serviceJob.brandId) {
      throw new Error(
        `Cannot create Service Report without Service Job brand "${serviceJobId}"`
      );
    }
    if (
      Array.from(reportsById.values()).some(
        (report) => report.serviceJobId === serviceJobId && report.status === 'draft'
      )
    ) {
      throw new Error(
        `Cannot create Service Report: Service Job "${serviceJobId}" already has an active draft`
      );
    }
    const report = createServiceReportDraft(
      crypto.randomUUID(),
      await allocateReportNumber(serviceJob.brandId, bangkokNumberingYear(new Date())),
      serviceJob,
      input
    );
    reportsById.set(report.id, report);
    return report;
  },

  async updateDraft(reportId, patch: ServiceReportDraftPatch) {
    const report = reportsById.get(reportId);
    if (!report) {
      throw new Error(`Cannot update Service Report "${reportId}": no report exists`);
    }
    const updated = updateServiceReportDraft(report, patch);
    reportsById.set(reportId, updated);
    return updated;
  },

  async finalize(reportId) {
    const report = reportsById.get(reportId);
    if (!report) {
      throw new Error(`Cannot finalize Service Report "${reportId}": no report exists`);
    }
    const serviceJob = requireServiceJob(report.serviceJobId);
    const finalized = finalizeServiceReport(report, serviceJob);
    reportsById.set(reportId, finalized);
    return finalized;
  },
};
