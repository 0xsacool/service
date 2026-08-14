import { SERVICE_JOB_STATUSES, TERMINAL_SERVICE_JOB_STATUSES } from '../../constants';
import type { ServiceJob, ServiceJobStatus } from '../../types';
import { isTerminalServiceJobStatus } from '../../validation';

const dashboardStatusOrder: ServiceJobStatus[] = [
  ...SERVICE_JOB_STATUSES,
  ...TERMINAL_SERVICE_JOB_STATUSES.filter(
    (status) => !SERVICE_JOB_STATUSES.includes(status)
  ),
];

export function aggregateDashboardServiceJobs(
  serviceJobs: readonly Pick<ServiceJob, 'status'>[]
) {
  return {
    active: serviceJobs.filter(
      (job) =>
        !isTerminalServiceJobStatus(job.status) && job.status !== 'Ready for Pickup'
    ).length,
    inRepair: serviceJobs.filter((job) => job.status === 'In Repair').length,
    ready: serviceJobs.filter((job) => job.status === 'Ready for Pickup').length,
    completed: serviceJobs.filter((job) => job.status === 'Completed').length,
    awaitingParts: serviceJobs.filter((job) => job.status === 'Awaiting Parts').length,
    statusBreakdown: dashboardStatusOrder.map((status) => ({
      status,
      count: serviceJobs.filter((job) => job.status === status).length,
    })),
  };
}
