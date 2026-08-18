import { Search } from 'lucide-react';
import type { CustomerSearchResult } from '../../../types';
import { RecentSearches } from './RecentSearches';
import { RecentCustomers } from './RecentCustomers';

// F5d-49B (Terra P2 UX honesty) — see SearchInput.tsx's identical rationale.
// F5d-69 closed the Firestore-mode gap this used to branch around; both
// modes advertise the same dimensions now.
const BARE_PROMPT = 'เริ่มพิมพ์ชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง';

// The idle state (no query typed yet) — Recent Searches and Recent
// Customers, each only rendered when non-empty. The bare prompt below only
// shows for a staff member's very first-ever search, before any recents
// exist.
export function SearchEmptyState({
  recentSearches,
  recentCustomers,
  onSelectRecentSearch,
  onSelectCustomer,
}: {
  recentSearches: string[];
  recentCustomers: CustomerSearchResult[];
  onSelectRecentSearch: (term: string) => void;
  onSelectCustomer?: (customer: CustomerSearchResult) => void;
}) {
  if (recentSearches.length === 0 && recentCustomers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center text-neutral-400">
        <Search className="h-8 w-8" />
        <p className="text-sm">{BARE_PROMPT}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fade-in_0.4s_ease_both]">
      <RecentSearches searches={recentSearches} onSelect={onSelectRecentSearch} />
      <RecentCustomers customers={recentCustomers} onSelectCustomer={onSelectCustomer} />
    </div>
  );
}
