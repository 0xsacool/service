import { Phone, ShoppingBag, Wrench, Clock } from 'lucide-react';
import type { CustomerSearchResult } from '../../../types';
import { GlassCard } from '../GlassCard';
import { PrimaryButton } from '../Button';
import { formatDateShort } from '../../../utils/formatDate';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function CustomerResultCard({
  customer,
  onSelect,
}: {
  customer: CustomerSearchResult;
  onSelect?: (customer: CustomerSearchResult) => void;
}) {
  return (
    <GlassCard className="flex flex-col gap-4 p-5 animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-500 text-base font-semibold text-white">
          {initials(customer.name)}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-ink">{customer.name}</p>
          {customer.marketplace && customer.username && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
              <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
              {customer.marketplace} · @{customer.username}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            {customer.phone}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
            <span className="flex items-center gap-1">
              <Wrench className="h-3.5 w-3.5" />
              {customer.previousServiceJobs} งานบริการก่อนหน้า
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              เข้ารับบริการล่าสุด {formatDateShort(customer.lastVisit)}
            </span>
          </p>
        </div>
      </div>
      <PrimaryButton
        onClick={() => onSelect?.(customer)}
        className="w-full shrink-0 sm:w-auto"
      >
        ใช้ข้อมูลลูกค้านี้
      </PrimaryButton>
    </GlassCard>
  );
}
