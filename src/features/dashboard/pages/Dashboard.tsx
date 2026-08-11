import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  Wrench,
  CheckCircle2,
  ArrowUpRight,
  Plus,
  TrendingUp,
  PackageOpen,
} from 'lucide-react';
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
import { ROUTES, SERVICE_JOB_STATUSES } from '../../../constants';
import { statusLabel } from '../../../services/serviceJobPresentation';

export function Dashboard() {
  const navigate = useNavigate();
  const { serviceJobs: claims } = useServiceJobs();

  const active = claims.filter(
    (c) => c.status !== 'Completed' && c.status !== 'Ready for Pickup'
  ).length;
  const inRepair = claims.filter((c) => c.status === 'In Repair').length;
  const ready = claims.filter((c) => c.status === 'Ready for Pickup').length;
  const completed = claims.filter((c) => c.status === 'Completed').length;

  const stats = [
    {
      label: 'งานบริการที่กำลังดำเนินการ',
      value: active,
      delta: '+3 รายการในสัปดาห์นี้',
      icon: Inbox,
      tint: 'bg-brand-50 text-brand-600',
    },
    {
      label: 'กำลังซ่อมอยู่',
      value: inRepair,
      delta: 'เริ่มวันนี้ 2 รายการ',
      icon: Wrench,
      tint: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'พร้อมรับสินค้า',
      value: ready,
      delta: 'แจ้งลูกค้า',
      icon: CheckCircle2,
      tint: 'bg-success-50 text-success-600',
    },
    {
      label: 'เสร็จสิ้น (30 วัน)',
      value: completed,
      delta: '+12% จากเดือนก่อน',
      icon: TrendingUp,
      tint: 'bg-amber-50 text-amber-600',
    },
  ];

  // Weekly intake bar chart (sample)
  const weekly = [
    { day: 'จ.', value: 8 },
    { day: 'อ.', value: 12 },
    { day: 'พ.', value: 6 },
    { day: 'พฤ.', value: 14 },
    { day: 'ศ.', value: 10 },
    { day: 'ส.', value: 4 },
    { day: 'อา.', value: 2 },
  ];
  const maxWeekly = Math.max(...weekly.map((w) => w.value));

  const recent = [...claims]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 5);

  const statusBreakdown = SERVICE_JOB_STATUSES.filter(
    (status) => status !== 'Completed'
  ).map((status) => ({
    status,
    count: claims.filter((c) => c.status === status).length,
  }));
  const totalBreakdown = statusBreakdown.reduce((s, x) => s + x.count, 0) || 1;

  return (
    <PageContainer>
      <PageHeader
        title="สวัสดีตอนเช้า, Daniel"
        subtitle="ภาพรวมงานบริการที่ศูนย์วันนี้"
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
            <p className="mt-2 text-xs font-medium text-neutral-400">{s.delta}</p>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Weekly intake chart */}
        <GlassCard className="p-6 lg:col-span-2 animate-[rise_0.55s_cubic-bezier(0.22,1,0.36,1)_both]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                งานบริการที่รับเข้าในสัปดาห์นี้
              </h2>
              <p className="text-sm text-neutral-500">
                รายการใหม่ที่รับเข้ามาในสัปดาห์นี้
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-3 py-1 text-sm font-medium text-success-700 ring-1 ring-success-200">
              <ArrowUpRight className="h-4 w-4" />
              +12%
            </span>
          </div>
          <div className="flex h-48 items-end justify-between gap-2 sm:gap-4">
            {weekly.map((w) => (
              <div key={w.day} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-xl bg-gradient-to-t from-brand-500 to-cyan-400 transition-all duration-500 hover:from-brand-600 hover:to-cyan-500"
                    style={{ height: `${(w.value / maxWeekly) * 100}%` }}
                    title={`${w.value} งานบริการ`}
                  />
                </div>
                <span className="text-xs font-medium text-neutral-400">{w.day}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Status breakdown */}
        <GlassCard className="p-6 animate-[rise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]">
          <h2 className="text-lg font-semibold tracking-tight text-ink">แยกตามสถานะ</h2>
          <p className="text-sm text-neutral-500">สถานะงานบริการปัจจุบัน</p>
          <div className="mt-5 space-y-3.5">
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
      </div>

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
        </div>
      </GlassCard>

      {/* Awaiting parts callout */}
      <GlassCard className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between animate-[rise_0.7s_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <PackageOpen className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-ink">มี 2 งานบริการรออะไหล่</p>
            <p className="text-sm text-neutral-500">
              อะไหล่หนึ่งรายการจะมาถึงพรุ่งนี้ — จัดตารางซ่อมได้เลย
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate(ROUTES.serviceJobs)}
          className="rounded-full bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
        >
          ตรวจสอบคิว
        </button>
      </GlassCard>
    </PageContainer>
  );
}
