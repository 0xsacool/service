import { Loader2 } from 'lucide-react';

// Architecturally ready for Phase 2's async/debounced search — not reachable
// today since searchRepository.search() resolves synchronously.
export function SearchLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      <p className="text-sm text-neutral-500">กำลังค้นหา…</p>
    </div>
  );
}
