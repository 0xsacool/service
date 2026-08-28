import { Outlet, useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { useAuthSession } from './authSessionContext';
import { canAccessApprovalConsole } from '../services/approvalConsoleAccess';
import { GlassCard, PageContainer, EmptyState, SecondaryButton } from '../shared/components';
import { ROUTES } from '../constants';

// Phase 6R-B — composes INSIDE <StaffLayout>, not before it like
// StaffRouteGuard: by the time this renders, the staff member is already an
// authenticated, in-app user (StaffRouteGuard already guarantees
// session.status is 'mock' or 'authorized'), just possibly the wrong role for
// this one page — so denial renders inside the normal shell chrome (sidebar,
// topbar) rather than StaffRouteGuard's bare pre-shell <p>, which is reserved
// for signed-out/loading/no-profile states.
//
// This is UX/defense-in-depth only. The Worker's own
// approval_console_access_denied check remains the sole authorization
// boundary regardless of what renders here.
export function ApprovalConsoleRouteGuard() {
  const { staffProfile } = useAuthSession();
  const navigate = useNavigate();
  const role = staffProfile?.repairReportActor?.role ?? null;

  if (canAccessApprovalConsole(role)) return <Outlet />;

  return (
    <PageContainer>
      <GlassCard className="p-10">
        <EmptyState
          icon={LockKeyhole}
          title="ไม่มีสิทธิ์เข้าถึง Approval Console"
          description="หน้านี้สำหรับผู้มีบทบาทผู้อนุมัติหรือผู้ดูแลระบบเท่านั้น"
          action={
            <SecondaryButton onClick={() => navigate(ROUTES.dashboard)} className="mt-4">
              กลับหน้าภาพรวม
            </SecondaryButton>
          }
        />
      </GlassCard>
    </PageContainer>
  );
}
