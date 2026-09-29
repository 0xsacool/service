import type { ServiceJobStatus, TimelineEvent } from '../types';
import { formatTime } from '../utils/formatDate.ts';
import { bangkokIsoDate } from './bangkokTime.ts';

const ORDERED_SERVICE_JOB_STATUSES: readonly ServiceJobStatus[] = [
  'Received',
  'Diagnosing',
  'Awaiting Parts',
  'In Repair',
  'Quality Check',
  'Ready for Pickup',
  'Completed',
];

const STATUS_TIMELINE_TEXT: Record<
  ServiceJobStatus,
  { title: string; description: string }
> = {
  Received: {
    title: 'Claim received',
    description: 'Product received at the service counter and logged into the system.',
  },
  Diagnosing: {
    title: 'Diagnosis pending',
    description: 'The product is being assessed by the service team.',
  },
  'Awaiting Parts': {
    title: 'Awaiting parts',
    description: 'The service job is waiting for required parts.',
  },
  'In Repair': {
    title: 'In repair',
    description: 'Repair work is in progress.',
  },
  'Quality Check': {
    title: 'Quality check',
    description: 'The repaired product is undergoing final verification.',
  },
  'Ready for Pickup': {
    title: 'Ready for pickup',
    description: 'The product is ready to be returned to the customer.',
  },
  Completed: {
    title: 'Completed',
    description:
      'The product was returned to the customer and the service job was closed.',
  },
  Cancelled: {
    title: 'Cancelled',
    description: 'The service job was cancelled and closed.',
  },
  Rejected: {
    title: 'Rejected',
    description: 'The service job was rejected and closed.',
  },
};

export interface ServiceJobProgressState {
  completed: number;
  total: number;
  progress: number;
  terminalException: boolean;
}

export function createServiceJobStatusTimelineEvent(
  status: ServiceJobStatus,
  occurredAt: Date
): TimelineEvent {
  const text = STATUS_TIMELINE_TEXT[status];
  return {
    status,
    title: text.title,
    description: text.description,
    date: bangkokIsoDate(occurredAt),
    time: formatTime(occurredAt),
    done: true,
  };
}

export function appendServiceJobStatusTimelineEvent(
  events: readonly TimelineEvent[],
  status: ServiceJobStatus,
  occurredAt: Date
): TimelineEvent[] {
  return [...events, createServiceJobStatusTimelineEvent(status, occurredAt)];
}

export function authoritativeTimelineCurrentIndex(
  events: readonly TimelineEvent[],
  status: ServiceJobStatus
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.status === status) return index;
  }
  return -1;
}

export function serviceJobProgressState(
  status: ServiceJobStatus
): ServiceJobProgressState {
  const total = ORDERED_SERVICE_JOB_STATUSES.length;
  const index = ORDERED_SERVICE_JOB_STATUSES.indexOf(status);

  if (index >= 0) {
    const completed = index + 1;
    return {
      completed,
      total,
      progress: Math.round((completed / total) * 100),
      terminalException: false,
    };
  }

  return {
    completed: total,
    total,
    progress: 100,
    terminalException: true,
  };
}
