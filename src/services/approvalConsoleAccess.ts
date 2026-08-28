import { backendKind } from '../config/backend';
import type { StaffRole } from '../types/serviceReportV2';

// Phase 6R-B.2 (SF-1) — deliberately NOT shaped like
// canImportProductCatalogForBackend (src/services/productCatalogAccess.ts).
// That gate is always-capable in mock because Product Import is a per-staff
// convenience capability; Approval Console access is a role boundary, and
// Decision 047 requires every role other than approver/admin to fail closed.
// A mock-mode bypass made technician/roleless staff pass the UI gate, so the
// backend kind is no longer consulted at all: the same role predicate applies
// in mock and in Firestore, and a roleless/no-profile staff member (which is
// every mock session, since createMockSession carries no staffProfile) reads
// as denied identically to 'technician'.
//
// This is UX/defense-in-depth only. The Worker's own
// approval_console_access_denied check (worker/src/serviceReportReadRoutes.ts)
// remains the sole authorization boundary and is unaffected by this file.
// canImportProducts is never a parameter — it is a separate, unrelated
// capability (Product Import) and must not gate Approval Console access.
export function canAccessApprovalConsoleForBackend(
  kind: 'mock' | 'firestore' | null,
  role: StaffRole | null | undefined
): boolean {
  return role === 'approver' || role === 'admin';
}

export function canAccessApprovalConsole(role: StaffRole | null | undefined): boolean {
  return canAccessApprovalConsoleForBackend(backendKind, role);
}
