import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, ChevronDown } from 'lucide-react';
import type { ServiceJobStatus } from '../../../types';
import { useServiceJobs } from '../../../hooks/useServiceJobs';
import {
  StatusBadge,
  PriorityPill,
  GlassCard,
  PrimaryButton,
  PageHeader,
  PageContainer,
} from '../../../shared/components';
import { formatDateShort } from '../../../utils/formatDate';
import type { StaffOutletContext } from '../../../shared/layouts/StaffLayout';
import { ROUTES, SERVICE_JOB_STATUSES } from '../../../constants';
import { statusLabel } from '../../../services/serviceJobPresentation';

const statusFilters: (ServiceJobStatus | 'All')[] = ['All', ...SERVICE_JOB_STATUSES];

export function ServiceJobDetailLink({ id }: { id: string }) {
  return (
    <Link
      to={ROUTES.serviceJobDetails(id)}
      onClick={(event) => event.stopPropagation()}
      className="rounded text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      aria-label={`เปิดรายละเอียดงานบริการ ${id}`}
    >
      {id}
    </Link>
  );
}

export function ServiceJobsList() {
  const navigate = useNavigate();
  const { search } = useOutletContext<StaffOutletContext>();
  const { serviceJobs: claims } = useServiceJobs();
  const [filter, setFilter] = useState<ServiceJobStatus | 'All'>('All');

  const filtered = claims.filter((c) => {
    const matchesStatus = filter === 'All' || c.status === filter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      c.id.toLowerCase().includes(q) ||
      c.customerName.toLowerCase().includes(q) ||
      c.product.toLowerCase().includes(q) ||
      c.issue.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <PageContainer>
      <PageHeader
        title="งานบริการทั้งหมด"
        subtitle={`แสดง ${filtered.length} งานบริการ`}
        action={
          <PrimaryButton onClick={() => navigate(ROUTES.newServiceJob)}>
            <Plus className="h-5 w-5" />
            สร้างงานบริการ
          </PrimaryButton>
        }
      />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 animate-[fade-in_0.5s_ease_both]">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
              filter === f
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 backdrop-blur hover:bg-white'
            }`}
          >
            {f === 'All' ? 'ทั้งหมด' : statusLabel(f)}
          </button>
        ))}
      </div>

      {/* Table on desktop */}
      <GlassCard className="hidden overflow-hidden animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both] lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-black/5 text-left text-xs font-medium uppercase tracking-wider text-neutral-400">
              <th className="px-5 py-3.5">งานบริการ</th>
              <th className="px-5 py-3.5">ลูกค้า</th>
              <th className="px-5 py-3.5">สินค้า</th>
              <th className="px-5 py-3.5">ความสำคัญ</th>
              <th className="px-5 py-3.5">สถานะ</th>
              <th className="px-5 py-3.5">อัปเดตล่าสุด</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(ROUTES.serviceJobDetails(c.id))}
                className="cursor-pointer transition-colors hover:bg-neutral-50/70"
              >
                <td className="px-5 py-4">
                  <span className="font-medium">
                    <ServiceJobDetailLink id={c.id} />
                  </span>
                </td>
                <td className="px-5 py-4 text-neutral-600">{c.customerName}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-neutral-100">
                      <img
                        src={c.photos[0]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{c.product}</p>
                      <p className="truncate text-xs text-neutral-400">{c.issue}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <PriorityPill priority={c.priority} />
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={c.status} size="sm" />
                </td>
                <td className="px-5 py-4 text-sm text-neutral-500">
                  {formatDateShort(c.updatedAt)}
                </td>
                <td className="px-5 py-4 text-right">
                  <ChevronDown className="ml-auto h-4 w-4 -rotate-90 text-neutral-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-neutral-400">
            ไม่พบงานบริการตามตัวกรอง
          </div>
        )}
      </GlassCard>

      {/* Cards on mobile */}
      <div className="space-y-3 lg:hidden">
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => navigate(ROUTES.serviceJobDetails(c.id))}
            className="block w-full text-left animate-[rise_0.4s_ease_both]"
          >
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
                  <img src={c.photos[0]} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-ink">{c.product}</p>
                    <PriorityPill priority={c.priority} />
                  </div>
                  <p className="truncate text-sm text-neutral-500">
                    {c.id} · {c.customerName}
                  </p>
                  <div className="mt-2">
                    <StatusBadge status={c.status} size="sm" />
                  </div>
                </div>
              </div>
            </GlassCard>
          </button>
        ))}
        {filtered.length === 0 && (
          <GlassCard className="p-8 text-center text-neutral-400">
            ไม่พบงานบริการตามตัวกรอง
          </GlassCard>
        )}
      </div>
    </PageContainer>
  );
}
