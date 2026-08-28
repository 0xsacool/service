import type { ApprovalConsoleRepository } from './workerServiceReportReadRepository';

export function createMockApprovalConsoleRepository(): ApprovalConsoleRepository {
  return {
    async fetchPendingApprovalQueue(request) {
      const normalizedSearch = request.mode === 'queue'
        ? null
        : request.mode === 'report-number'
          ? request.reportNo.trim().toUpperCase()
          : request.trackingReference.trim();
      return {
        queueContractVersion: 1,
        mode: request.mode,
        normalizedSearch,
        pageSize: request.pageSize ?? 25,
        items: [],
        nextCursor: null,
      };
    },

    async fetchApprovalReview() {
      throw new Error('No pending mock Approval Review exists');
    },
  };
}
