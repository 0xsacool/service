import { Mail, Phone, Sparkles } from 'lucide-react';
import type { NewCustomerDraft } from '../../../types';
import { GlassCard, SecondaryButton } from '../../../shared/components';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

// The "working with this not-yet-durable customer" state — deliberately
// distinct from CustomerSummaryCard (which renders a real, already-durable
// CustomerSearchResult and would show a nonsensical "last visit" date for a
// customer with no history at all). The banner below is the one place this
// pending state is made explicit to staff, matching this project's existing
// honesty-over-liveness convention (F5d-49B/49D).
export function NewCustomerSummaryCard({
  customer,
  onChangeCustomer,
}: {
  customer: NewCustomerDraft;
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
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {customer.phone}
            </p>
            {customer.email && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                {customer.email}
              </p>
            )}
          </div>
        </div>
        <SecondaryButton
          onClick={onChangeCustomer}
          className="w-full px-4 py-2.5 text-sm sm:w-auto"
        >
          เปลี่ยนลูกค้า
        </SecondaryButton>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 ring-1 ring-brand-100">
        <Sparkles className="h-4 w-4 shrink-0" />
        ลูกค้าใหม่ — ยังไม่บันทึก จะบันทึกพร้อมกับงานบริการเมื่อกด "บันทึกและพิมพ์"
      </div>
    </GlassCard>
  );
}
