import { SearchX, UserPlus } from 'lucide-react';
import { GlassCard } from '../GlassCard';
import { backendKind } from '../../../config/backend';

// F5d-49B (Terra P2 UX honesty). Two independent gaps:
// 1. Search-dimension wording - same rationale as SearchInput.tsx/
//    SearchEmptyState.tsx: Firestore mode has no marketplace/order data.
// 2. "+ New Customer" - customer creation is intentionally unwired in every
//    backend (NewServiceJob.tsx never passes onCreateNewCustomer at all, so
//    this has always been a silent no-op), but presenting it as a live
//    action specifically misleads a Firestore-mode staff member into
//    thinking they can register a walk-in customer right now. Hidden
//    (never disabled-but-visible, which would still invite a click) behind
//    an honest inline note instead - no customer-creation behavior is
//    implemented by this change.
const RETRY_HINT =
  backendKind === 'mock'
    ? 'ลองค้นหาด้วยชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่องอื่น'
    : 'ลองค้นหาด้วยชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่องอื่น';

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
      {backendKind === 'mock' ? (
        <button type="button" onClick={onCreateNew} className="mt-2 w-full max-w-sm">
          <GlassCard className="flex items-center justify-center gap-2 px-6 py-4 text-base font-medium text-brand-600 transition-all hover:bg-white">
            <UserPlus className="h-5 w-5" />
            สร้างลูกค้าใหม่
          </GlassCard>
        </button>
      ) : (
        <p className="mt-2 text-xs text-neutral-400">
          การสร้างลูกค้าใหม่ยังไม่รองรับในโหมดนี้
        </p>
      )}
    </div>
  );
}
