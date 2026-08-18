import { useId } from 'react';
import { Search } from 'lucide-react';
import { GlassCard } from '../GlassCard';

// F5d-49B (Terra P2 UX honesty) established that this copy must never
// promise a search dimension that silently never matches. F5d-69 closes
// that gap for Firestore mode specifically: orderNumber/contactChannelIdentity
// are now real ServiceJob fields, matched in memory by
// firestoreSearchRepository.ts (DECISIONS.md #041) — the two modes'
// dimension lists are therefore the same today, so no backendKind branch is
// needed here anymore.
const DEFAULT_PLACEHOLDER = 'ค้นหาชื่อผู้ใช้ ออเดอร์ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง…';
const CAPTION = 'ค้นหาได้จากชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง';

export function SearchInput({
  value,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
  autoFocus = true,
  label = 'ค้นหาลูกค้า',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const inputId = useId();
  const captionId = useId();

  return (
    <div>
      <GlassCard className="flex items-center gap-3 px-5 py-4 sm:px-6 sm:py-5">
        <Search className="h-6 w-6 shrink-0 text-neutral-400" strokeWidth={2} />
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-describedby={captionId}
          className="w-full bg-transparent text-lg text-ink placeholder:text-neutral-400 focus:outline-none sm:text-xl"
        />
      </GlassCard>
      <p id={captionId} className="mt-3 text-center text-sm text-neutral-400">
        {CAPTION}
      </p>
    </div>
  );
}
