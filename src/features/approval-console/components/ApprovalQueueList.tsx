import { AlertTriangle, ClipboardList, RefreshCw } from 'lucide-react';
import type { ApprovalQueueState } from '../../../hooks/useApprovalConsoleReads';
import type { ApprovalQueueItemV1 } from '../../../types/serviceReportWorkerReads';
import { GlassCard, LoadingState, EmptyState, ErrorState, SecondaryButton } from '../../../shared/components';
import { ApprovalQueueRow } from './ApprovalQueueRow';

// Phase 6R-B — the loading/empty/list/error/stale convention this repo
// established in ServiceReportsSection.tsx (D24 comment: "a failed
// authoritative refetch must never read as current"), applied identically
// here to the D25 approval queue.
//
// Phase 6R-B.2 (SF-4) — the branch order below is the rendering contract:
// retained items always win (a failed refresh keeps showing what did load,
// with the error block above it); otherwise a failure renders as the error
// alone; otherwise only queue.hasAuthoritativeData may claim the queue is
// empty; otherwise nothing has loaded yet and this is still loading. The
// previous ordering keyed the empty state off items.length alone, so a
// failed first request rendered ErrorState and "ไม่มีรายการที่รอการอนุมัติ"
// together — a failure that read as an authoritative empty queue.
export function ApprovalQueueList({
  queue,
  onSelect,
}: {
  queue: ApprovalQueueState;
  onSelect: (item: ApprovalQueueItemV1) => void;
}) {
  return (
    <div className="space-y-4">
      {queue.error ? (
        <ErrorState
          title="โหลดรายการที่รอการอนุมัติไม่สำเร็จ"
          description={queue.error.message}
          action={
            <SecondaryButton onClick={queue.refresh} disabled={queue.isLoading}>
              <RefreshCw className={queue.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              ลองอีกครั้ง
            </SecondaryButton>
          }
        />
      ) : null}

      {queue.isStale && !queue.error ? (
        <GlassCard
          className="border border-warning-200 bg-warning-50/60 p-4 ring-warning-200"
          aria-live="polite"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" />
              <div>
                <p className="font-semibold text-ink">ข้อมูลอาจไม่เป็นปัจจุบัน</p>
                <p className="mt-1 text-sm text-neutral-600">
                  แสดงรายการล่าสุดที่โหลดสำเร็จ ยังไม่ได้ยืนยันกับเซิร์ฟเวอร์
                </p>
              </div>
            </div>
            <SecondaryButton
              onClick={queue.refresh}
              disabled={queue.isLoading}
              className="px-4 py-2.5 text-sm"
            >
              <RefreshCw className={queue.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              รีเฟรช
            </SecondaryButton>
          </div>
        </GlassCard>
      ) : null}

      {queue.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {queue.items.map((item) => (
              <ApprovalQueueRow key={item.reportId} item={item} onSelect={onSelect} />
            ))}
          </div>
          {queue.nextCursor !== null ? (
            <div className="flex justify-center">
              <SecondaryButton onClick={queue.loadMore} disabled={queue.isLoadingMore}>
                {queue.isLoadingMore ? 'กำลังโหลดเพิ่มเติม…' : 'โหลดเพิ่มเติม'}
              </SecondaryButton>
            </div>
          ) : null}
        </>
      ) : queue.error ? null : queue.hasAuthoritativeData ? (
        <GlassCard className="p-8">
          <EmptyState
            icon={ClipboardList}
            title="ไม่มีรายการที่รอการอนุมัติ"
            description="เมื่อมีใบรายงานที่สรุปผลรอการพิจารณา รายการจะปรากฏที่นี่"
          />
        </GlassCard>
      ) : (
        <GlassCard className="p-8">
          <LoadingState label="กำลังโหลดรายการที่รอการอนุมัติ…" />
        </GlassCard>
      )}
    </div>
  );
}
