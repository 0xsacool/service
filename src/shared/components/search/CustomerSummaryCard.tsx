import { Phone, ShoppingBag, Wrench, Clock, Info } from 'lucide-react';
import type { CustomerSearchResult } from '../../../types';
import { GlassCard } from '../GlassCard';
import { SecondaryButton } from '../Button';
import { formatDateShort } from '../../../utils/formatDate';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

// The collapsed, "working with this customer" state UniversalSearch hands
// off to once a customer is selected — deliberately more compact than
// CustomerResultCard (small secondary action instead of a full-width
// primary button) since its job here is confirmation, not choice.
export function CustomerSummaryCard({
  customer,
  onChangeCustomer,
}: {
  customer: CustomerSearchResult;
  onChangeCustomer: () => void;
}) {
  return (
    <GlassCard className="p-5 animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-500 text-sm font-semibold text-white">
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
        <SecondaryButton
          onClick={onChangeCustomer}
          className="w-full px-4 py-2.5 text-sm sm:w-auto"
        >
          เปลี่ยนลูกค้า
        </SecondaryButton>
      </div>

      {customer.previousServiceJobs > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 ring-1 ring-brand-100">
          <Info className="h-4 w-4 shrink-0" />
          ลูกค้ารายนี้มีประวัติงานบริการแล้ว {customer.previousServiceJobs} รายการ
        </div>
      )}
    </GlassCard>
  );
}
