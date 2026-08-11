import { SearchX, UserPlus } from 'lucide-react';
import { GlassCard } from '../GlassCard';

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
        <p className="font-medium text-ink">ไม่พบข้อมูลสำหรับ “{query}”</p>
        <p className="mt-1 text-sm text-neutral-500">
          ลองค้นหาด้วยชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่องอื่น
        </p>
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
