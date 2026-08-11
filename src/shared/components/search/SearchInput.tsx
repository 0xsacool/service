import { Search } from 'lucide-react';
import { GlassCard } from '../GlassCard';

export function SearchInput({
  value,
  onChange,
  placeholder = 'ค้นหาชื่อผู้ใช้ ออเดอร์ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง…',
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <GlassCard className="flex items-center gap-3 px-5 py-4 sm:px-6 sm:py-5">
        <Search className="h-6 w-6 shrink-0 text-neutral-400" strokeWidth={2} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-transparent text-lg text-ink placeholder:text-neutral-400 focus:outline-none sm:text-xl"
        />
      </GlassCard>
      <p className="mt-3 text-center text-sm text-neutral-400">
        ค้นหาได้จากชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง
      </p>
    </div>
  );
}
