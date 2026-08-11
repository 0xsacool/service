import type { ServiceJobStatus } from '../types';
import { TERMINAL_SERVICE_JOB_STATUSES } from '../constants';
import type { ValidationResult } from './types';
import { VALID } from './types';

// Placeholder only — no real rules yet. The actual required-field and format
// checks (BUSINESS_RULES.md "Intake Workflow & Required Fields") land in
// Sprint 2, once the form collects real input instead of being decorative.
// Always returns valid today, so wiring this into NewClaim's submit handler
// has no effect on current behavior.
export function validateNewServiceJobInput(): ValidationResult {
  return VALID;
}

// Status-transition legality belongs in a shared function, not scattered
// across callers (CLAUDE.md) — the one place "is this status terminal"
// gets decided, used by buildServiceJobUpdate to drive closedAt (F5c).
export function isTerminalServiceJobStatus(status: ServiceJobStatus): boolean {
  return TERMINAL_SERVICE_JOB_STATUSES.includes(status);
}
