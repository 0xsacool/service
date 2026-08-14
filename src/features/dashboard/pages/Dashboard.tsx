import { useNavigate } from 'react-router-dom';
import { Inbox, Wrench, CheckCircle2, Plus } from 'lucide-react';
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
import { ROUTES } from '../../../constants';
import { statusLabel } from '../../../services/serviceJobPresentation';
import { aggregateDashboardServiceJobs } from '../dashboardAggregation';

export function Dashboard() {
  const navigate = useNavigate();
  const { serviceJobs: claims } = useServiceJobs();
  const { active, inRepair, ready, completed, awaitingParts, statusBreakdown } =
    aggregateDashboardServiceJobs(claims);

  const stats = [
    {
      label: 'งานบริการที่กำลังดำเนินการ',
      value: active,
      icon: Inbox,
      tint: 'bg-brand-50 text-brand-600',
    },
    {
      label: 'กำลังซ่อมอยู่',
      value: inRepair,
      icon: Wrench,
      tint: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'พร้อมรับสินค้า',
      value: ready,
      icon: CheckCircle2,
      tint: 'bg-success-50 text-success-600',
    },
    {
      label: 'เสร็จสิ้นทั้งหมด',
      value: completed,
      icon: CheckCircle2,
      tint: 'bg-amber-50 text-amber-600',
    },
  ];

  const recent = [...claims]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 5);

  const totalBreakdown = statusBreakdown.reduce((s, x) => s + x.count, 0) || 1;

  return (
    <PageContainer>
      <PageHeader
        title="ภาพรวมงานบริการ"
        subtitle="ข้อมูลปัจจุบันจากงานบริการของแบรนด์ที่คุณรับผิดชอบ"
        action={
          <PrimaryButton onClick={() => navigate(ROUTES.newServiceJob)}>
            <Plus className="h-5 w-5" />
            สร้างงานบริการ
          </PrimaryButton>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 stagger">
        {stats.map((s) => (
          <GlassCard key={s.label} className="p-5">
            <div
              className={`mb-3 flex h-10 w-10 items-center justify-center rounded-2xl ${s.tint}`}
            >
              <s.icon className="h-5 w-5" strokeWidth={2} />
            </div>
            <p className="text-3xl font-semibold tracking-tight text-ink">{s.value}</p>
            <p className="text-sm text-neutral-500">{s.label}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-6 animate-[rise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]">
        <h2 className="text-lg font-semibold tracking-tight text-ink">แยกตามสถานะ</h2>
        <p className="text-sm text-neutral-500">สถานะงานบริการปัจจุบัน</p>
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {statusBreakdown.map((s) => (
            <div key={s.status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-neutral-600">{statusLabel(s.status)}</span>
                <span className="font-semibold text-ink">{s.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-brand-500/80 transition-all duration-500"
                  style={{ width: `${(s.count / totalBreakdown) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Recent claims */}
      <GlassCard className="overflow-hidden animate-[rise_0.65s_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="flex items-center justify-between border-b border-black/5 p-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              งานบริการล่าสุด
            </h2>
            <p className="text-sm text-neutral-500">กิจกรรมล่าสุดจากศูนย์บริการ</p>
          </div>
          <button
            onClick={() => navigate(ROUTES.serviceJobs)}
            className="rounded-full px-4 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
          >
            ดูทั้งหมด
          </button>
        </div>
        <div className="divide-y divide-black/5">
          {recent.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(ROUTES.serviceJobDetails(c.id))}
              className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-neutral-50/70 sm:px-5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-neutral-100">
                <img src={c.photos[0]} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-ink">{c.product}</p>
                  <span className="hidden text-sm text-neutral-400 sm:inline">·</span>
                  <span className="hidden text-sm text-neutral-400 sm:inline">
                    {c.id}
                  </span>
                </div>
                <p className="truncate text-sm text-neutral-500">
                  {c.customerName} · อัปเดต {formatDateShort(c.updatedAt)}
                </p>
              </div>
              <div className="hidden sm:block">
                <PriorityPill priority={c.priority} />
              </div>
              <StatusBadge status={c.status} size="sm" />
            </button>
          ))}
          {recent.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">
              ยังไม่มีงานบริการในแบรนด์นี้
            </p>
          ) : null}
        </div>
      </GlassCard>

      {awaitingParts > 0 ? (
        <GlassCard className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between animate-[rise_0.7s_cubic-bezier(0.22,1,0.36,1)_both]">
          <div>
            <p className="font-semibold text-ink">
              มี {awaitingParts} งานบริการที่กำลังรออะไหล่
            </p>
            <p className="text-sm text-neutral-500">
              เปิดรายการงานบริการเพื่อตรวจสอบรายละเอียดและลำดับคิว
            </p>
          </div>
          <button
            onClick={() => navigate(ROUTES.serviceJobs)}
            className="rounded-full bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
          >
            ดูงานบริการทั้งหมด
          </button>
        </GlassCard>
      ) : null}
    </PageContainer>
  );
}
