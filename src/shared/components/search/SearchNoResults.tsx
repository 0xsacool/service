import { SearchX, UserPlus } from 'lucide-react';
import { GlassCard } from '../GlassCard';

// F5d-49B (Terra P2 UX honesty) established that this control must never
// look live while unwired. F5d-65 wires it — NewServiceJob.tsx now passes a
// real onCreateNewCustomer in every backend mode (Worker-mediated atomic
// creation, DECISIONS.md-style fail-closed — see
// src/services/serviceJobCreation.ts) — so the mode-conditional hide is
// removed for the button itself. The search-dimension wording split
// (marketplace/order only in Mock) no longer applies either — F5d-69 added
// real Firestore-mode support for both (DECISIONS.md #041).
const RETRY_HINT = 'ลองค้นหาด้วยชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่องอื่น';

export function SearchNoResults({
  query,
  onCreateNew,
}: {
  query: string;
  onCreateNew?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center animate-[fade-in_0.4s_ease_both]">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <SearchX className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium text-ink">ไม่พบข้อมูลสำหรับ "{query}"</p>
        <p className="mt-1 text-sm text-neutral-500">{RETRY_HINT}</p>
      </div>
      <button type="button" onClick={onCreateNew} className="mt-2 w-full max-w-sm">
        <GlassCard className="flex items-center justify-center gap-2 px-6 py-4 text-base font-medium text-brand-600 transition-all hover:bg-white">
          <UserPlus className="h-5 w-5" />
          สร้างลูกค้าใหม่
        </GlassCard>
      </button>
    </div>
  );
}
