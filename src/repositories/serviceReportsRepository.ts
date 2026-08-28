import type {
  BrandId,
  ServiceReportDocument,
  ServiceReportDraftInput,
  ServiceReportDraftPatch,
  ServiceReportV2,
  ServiceReportV2Content,
  ServiceReportV2DraftPatch,
  ServiceReportHistoryItem,
} from '../types';
import {
  createServiceReportDraft,
  finalizeServiceReport,
  formatServiceReportNumber,
  orderServiceReports,
  updateServiceReportDraft,
} from '../services/serviceReport';
import {
  buildSuccessorContent,
  computeServiceReportFinalDigest,
  createServiceJobSnapshotV2,
  isServiceReportV2,
  normalizeServiceReportV2DraftPatch,
} from '../services/serviceReportV2';
import { bangkokNumberingYear } from '../services/bangkokTime';
import { serviceJobsRepository } from './serviceJobsRepository';
import type { ServiceReportsRepository } from './types';

const reportsById = new Map<string, ServiceReportDocument>();
const nextSequenceByBrandYear = new Map<string, number>();

function requireServiceJob(serviceJobId: string) {
  const serviceJob = serviceJobsRepository.getById(serviceJobId);
  if (!serviceJob) {
    throw new Error(`Cannot use Service Report: no Service Job "${serviceJobId}" exists`);
  }
  return serviceJob;
}

function toHistoryItem(report: ServiceReportDocument): ServiceReportHistoryItem {
  const common = {
    historyItemVersion: 1 as const,
    id: report.id,
    serviceJobId: report.serviceJobId,
    reportNo: report.reportNo,
    status: report.status,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    finalizedAt: report.finalizedAt,
    technician: report.technician,
    customerReportedProblem: report.customerReportedProblem,
    inspectionFindings: report.inspectionFindings,
    serviceActions: [...report.serviceActions],
    parts: report.parts.map((part) => ({ ...part })),
    technicianRemark: report.technicianRemark,
    resultStatus: report.resultStatus,
    resultDetail: report.resultDetail,
    evidenceAttachmentIds: [...report.evidenceAttachmentIds],
    claimNo: report.claimNo,
    factoryReference: report.factoryReference,
    snapshot: report.snapshot ? { ...report.snapshot } : null,
  };
  return isServiceReportV2(report)
    ? {
        ...common,
        sourceSchemaVersion: 2,
        warrantyOutcome: report.warrantyOutcome,
        approvalState: report.approvalState,
        contentRevision: report.contentRevision,
        finalContentDigest: report.finalContentDigest,
        predecessorReportId: report.predecessorReportId,
      }
    : { ...common, sourceSchemaVersion: 1 };
}

async function allocateReportNumber(brandId: BrandId, year: number): Promise<string> {
  const key = `${brandId}:${year}`;
  const sequence = nextSequenceByBrandYear.get(key) ?? 1;
  nextSequenceByBrandYear.set(key, sequence + 1);
  return formatServiceReportNumber(year, sequence);
}

export const serviceReportsRepository: ServiceReportsRepository = {
  async fetchHistoryForServiceJob(serviceJobId) {
    return serviceReportsRepository
      .listForServiceJob(serviceJobId)
      .map(toHistoryItem);
  },

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
    if (isServiceReportV2(report)) {
      throw new Error('Use updateDraftV2 for a V2 Service Report');
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
    if (isServiceReportV2(report)) {
      throw new Error('Use finalizeV2 for a V2 Service Report');
    }
    const serviceJob = requireServiceJob(report.serviceJobId);
    const finalized = finalizeServiceReport(report, serviceJob);
    reportsById.set(reportId, finalized);
    return finalized;
  },

  async createDraftV2(
    serviceJobId: string,
    content: ServiceReportV2Content
  ) {
    const serviceJob = requireServiceJob(serviceJobId);
    if (!serviceJob.brandId) throw new Error('A canonical brand is required');
    if (Array.from(reportsById.values()).some((report) => report.serviceJobId === serviceJobId && report.status === 'draft')) {
      throw new Error('An active draft already exists');
    }
    const now = new Date().toISOString();
    const reportId = crypto.randomUUID();
    const report: ServiceReportV2 = {
      schemaVersion: 2,
      reportId,
      id: reportId,
      serviceJobId,
      reportNo: await allocateReportNumber(serviceJob.brandId, bangkokNumberingYear(new Date())),
      brandId: serviceJob.brandId,
      status: 'draft',
      activeDraftGeneration: Array.from(reportsById.values()).filter((item) => item.serviceJobId === serviceJobId).length + 1,
      createdAt: now,
      createdByUid: 'mock-staff',
      createdByRoleSnapshot: 'technician',
      createdByDisplayNameSnapshot: null,
      contentRevision: 0,
      updatedAt: now,
      predecessorReportId: null,
      ...content,
      snapshot: null,
      finalizedAt: null,
      finalizedByUid: null,
      finalizedByRoleSnapshot: null,
      finalizedByDisplayNameSnapshot: null,
      finalizedFromRevision: null,
      finalContentDigest: null,
      approvalState: 'not-submitted',
      currentApprovalEventId: null,
      approvalDecidedAt: null,
    };
    reportsById.set(reportId, report);
    return report;
  },

  async updateDraftV2(
    reportId: string,
    expectedContentRevision: number,
    patch: ServiceReportV2DraftPatch
  ) {
    const report = reportsById.get(reportId);
    const normalized = normalizeServiceReportV2DraftPatch(patch);
    if (!report || !isServiceReportV2(report) || report.status !== 'draft' || !normalized) {
      throw new Error('The V2 draft cannot be updated');
    }
    if (report.contentRevision !== expectedContentRevision) throw new Error('stale_revision');
    const updated: ServiceReportV2 = {
      ...report,
      ...normalized,
      contentRevision: report.contentRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    reportsById.set(reportId, updated);
    return updated;
  },

  async finalizeV2(reportId, expectedContentRevision) {
    const report = reportsById.get(reportId);
    if (!report || !isServiceReportV2(report) || report.status !== 'draft') throw new Error('The V2 draft cannot be finalized');
    if (report.contentRevision !== expectedContentRevision || report.contentRevision < 1) throw new Error('stale_revision');
    const serviceJob = requireServiceJob(report.serviceJobId);
    const snapshot = createServiceJobSnapshotV2(serviceJob);
    if (!snapshot) throw new Error('The Service Job snapshot is invalid');
    const now = new Date().toISOString();
    const candidate: Extract<ServiceReportV2, { status: 'final' }> = {
      ...report,
      status: 'final',
      snapshot,
      finalizedAt: now,
      finalizedByUid: 'mock-staff',
      finalizedByRoleSnapshot: 'technician',
      finalizedByDisplayNameSnapshot: null,
      finalizedFromRevision: report.contentRevision,
      finalContentDigest: `sha256:v1:${'0'.repeat(64)}`,
      approvalState: 'pending',
      currentApprovalEventId: null,
      approvalDecidedAt: null,
      updatedAt: now,
    };
    const finalized = { ...candidate, finalContentDigest: await computeServiceReportFinalDigest(candidate) };
    reportsById.set(reportId, finalized);
    return finalized;
  },

  async decideV2(reportId, decision, _reason, expectedDigest) {
    const report = reportsById.get(reportId);
    if (!report || !isServiceReportV2(report) || report.status !== 'final' || report.finalContentDigest !== expectedDigest) {
      throw new Error('The V2 report cannot be decided');
    }
    const decided: ServiceReportV2 = {
      ...report,
      approvalState: decision,
      currentApprovalEventId: report.reportId,
      approvalDecidedAt: new Date().toISOString(),
    };
    reportsById.set(reportId, decided);
    return decided;
  },

  async createSuccessorV2(predecessorReportId, expectedDigest, omissions) {
    const predecessor = reportsById.get(predecessorReportId);
    if (!predecessor || !isServiceReportV2(predecessor) || predecessor.status !== 'final' ||
        predecessor.approvalState !== 'rejected' || predecessor.finalContentDigest !== expectedDigest) {
      throw new Error('The predecessor cannot create a successor');
    }
    const content = buildSuccessorContent(predecessor);
    content.evidenceAttachmentIds = content.evidenceAttachmentIds.filter((key) => !omissions.includes(key));
    const successor = await serviceReportsRepository.createDraftV2(predecessor.serviceJobId, content, crypto.randomUUID());
    const linked = { ...successor, predecessorReportId };
    reportsById.set(linked.id, linked);
    return linked;
  },

  async trustedPrint(reportId, contractVersion) {
    const report = reportsById.get(reportId);
    if (!report) throw new Error('The report does not exist');
    return {
      printState: contractVersion === 1 ? 'legacy-v1' :
        !isServiceReportV2(report) || report.status === 'draft' ? 'v2-draft' :
        report.approvalState === 'pending' ? 'v2-pending' :
        report.approvalState === 'approved' ? 'v2-approved' : 'v2-rejected',
      report,
      event: null,
      evidence: [],
      verifiedAt: new Date().toISOString(),
    };
  },
};
