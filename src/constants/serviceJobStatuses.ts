import type { ServiceJobStatus } from '../types';

// The status picker in ServiceJobDetails.tsx renders exactly this list —
// deliberately still the original 7, not including Cancelled/Rejected
// (added to ServiceJobStatus in F5c as a data-model/business-logic
// prerequisite for file retention). Exposing them as clickable options in
// the existing status picker is a staff-facing capability change beyond
// this sprint's "prerequisites only" scope; see the F5c completion report.
export const SERVICE_JOB_STATUSES: ServiceJobStatus[] = [
  'Received',
  'Diagnosing',
  'Awaiting Parts',
  'In Repair',
  'Quality Check',
  'Ready for Pickup',
  'Completed',
];

// BUSINESS_RULES.md "Service Job Status Flow": any status can transition to
// Cancelled or Rejected, and Completed/Cancelled/Rejected are all terminal
// — a service job reaching any of these three sets closedAt and is closed.
export const TERMINAL_SERVICE_JOB_STATUSES: ServiceJobStatus[] = [
  'Completed',
  'Cancelled',
  'Rejected',
];
