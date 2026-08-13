import { Search } from 'lucide-react';
import { GlassCard } from '../GlassCard';
import { backendKind } from '../../../config/backend';

// F5d-49B (Terra P2 UX honesty): Firestore-mode search has no backing data
// for marketplace username or order number (DATABASE_SCHEMA.md
// `customer_channel_contacts`/`product_instances` were never migrated —
// DECISIONS.md #038) — advertising them here would promise a search that
// silently never matches. Mock mode keeps the full, actually-supported
// dimension list.
const DEFAULT_PLACEHOLDER =
  backendKind === 'mock'
    ? 'ค้นหาชื่อผู้ใช้ ออเดอร์ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง…'
    : 'ค้นหาชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง…';
const CAPTION =
  backendKind === 'mock'
    ? 'ค้นหาได้จากชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง'
    : 'ค้นหาได้จากชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง';

export function SearchInput({
  value,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
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
      <p className="mt-3 text-center text-sm text-neutral-400">{CAPTION}</p>
    </div>
  );
}
