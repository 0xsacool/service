import { Loader2 } from 'lucide-react';

// Scaffolded for Sprint 3/4, when the data-access hooks (useServiceJobs,
// useCustomers, useProducts) start returning real isLoading states from
// async Supabase queries instead of always-false mock reads. Not yet
// rendered anywhere today.
export function LoadingState({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      <p className="text-sm text-neutral-500">{label}</p>
    </div>
  );
}
