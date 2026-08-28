import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import type { ApprovalReviewState } from '../../../hooks/useApprovalConsoleReads';
import {
  GlassCard,
  LoadingState,
  ErrorState,
  SecondaryButton,
} from '../../../shared/components';
import { formatDate } from '../../../utils/formatDate';
import { warrantyOutcomeColor, warrantyOutcomeLabel } from '../../../services/serviceJobPresentation';
import { SERVICE_ACTION_LABELS, RESULT_STATUS_LABELS } from '../approvalConsoleUi';
import { EvidenceList } from './EvidenceList';
import { ApprovalDecisionControls } from './ApprovalDecisionControls';

function ReadOnlySection({ title, value }: { title: string; value: string }) {
  return (
    <GlassCard className="p-6">
      <h3 className="mb-3 font-semibold text-ink">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-700">
        {value || 'ยังไม่มีการบันทึกข้อมูล'}
      </p>
    </GlassCard>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

// Phase 6R-B — same loading/error/stale convention as ApprovalQueueList,
// applied to a single ApprovalReviewV1. Never renders finalContentDigest,
// a raw uid, or any infrastructure/internal detail — only the DTO's
// business/display fields.
export function ApprovalReviewPanel({
  review,
  onBack,
}: {
  review: ApprovalReviewState;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" /> กลับไปยังคิว
      </button>

      {review.error ? (
        <ErrorState
          title="โหลดใบรายงานไม่สำเร็จ"
          description={review.error.message}
          action={
            <SecondaryButton onClick={review.refresh} disabled={review.isLoading}>
              <RefreshCw className={review.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              ลองอีกครั้ง
            </SecondaryButton>
          }
        />
      ) : null}

      {review.isStale && !review.error ? (
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
                  กรุณารีเฟรชก่อนดำเนินการอนุมัติหรือปฏิเสธ
                </p>
              </div>
            </div>
            <SecondaryButton
              onClick={review.refresh}
              disabled={review.isLoading}
              className="px-4 py-2.5 text-sm"
            >
              <RefreshCw className={review.isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              รีเฟรช
            </SecondaryButton>
          </div>
        </GlassCard>
      ) : null}

      {review.isLoading && review.review === null && !review.error ? (
        <GlassCard className="p-8">
          <LoadingState label="กำลังโหลดใบรายงาน…" />
        </GlassCard>
      ) : review.review ? (
        <>
          <GlassCard className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                {review.review.reportNo}
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${warrantyOutcomeColor(review.review.content.warrantyOutcome)}`}
              >
                {warrantyOutcomeLabel(review.review.content.warrantyOutcome)}
              </span>
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              เลขติดตาม {review.review.snapshot.trackingReference} · สรุปผลเมื่อ{' '}
              {formatDate(review.review.finalizedAt)}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <SummaryValue label="ลูกค้า" value={review.review.snapshot.customerName} />
              <SummaryValue label="สินค้า" value={review.review.snapshot.productName} />
              <SummaryValue
                label="รุ่น / SKU"
                value={review.review.snapshot.modelOrSku ?? 'ไม่มีข้อมูล'}
              />
              <SummaryValue label="หมายเลขเครื่อง" value={review.review.snapshot.serialNumber} />
              <SummaryValue
                label="ช่างผู้ดำเนินการ"
                value={review.review.finalizedBy.displayName ?? 'ไม่ระบุชื่อ'}
              />
              <SummaryValue
                label="สร้างโดย"
                value={review.review.createdBy.displayName ?? 'ไม่ระบุชื่อ'}
              />
            </div>
          </GlassCard>

          <ReadOnlySection
            title="อาการที่ลูกค้าแจ้ง"
            value={review.review.content.customerReportedProblem}
          />
          <ReadOnlySection
            title="ผลการตรวจสอบทางเทคนิค"
            value={review.review.content.inspectionFindings}
          />

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">การดำเนินการบริการ</h3>
            <div className="flex flex-wrap gap-2">
              {review.review.content.serviceActions.length > 0 ? (
                review.review.content.serviceActions.map((action) => (
                  <span
                    key={action}
                    className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
                  >
                    {SERVICE_ACTION_LABELS[action]}
                  </span>
                ))
              ) : (
                <span className="text-sm text-neutral-400">ยังไม่มีการบันทึกการดำเนินการ</span>
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">อะไหล่</h3>
            {review.review.content.parts.length > 0 ? (
              <div className="space-y-2">
                {review.review.content.parts.map((part, index) => (
                  <div
                    key={`${index}-${part.partNo ?? 'part'}`}
                    className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm ring-1 ring-black/5"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-ink">{part.description}</span>
                      <span className="text-neutral-500">จำนวน {part.quantity}</span>
                    </div>
                    <p className="mt-1 text-neutral-500">
                      {part.partNo ? `${part.partNo} · ` : ''}
                      {part.remark}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-400">ยังไม่มีการบันทึกอะไหล่</p>
            )}
          </GlassCard>

          <ReadOnlySection title="หมายเหตุจากช่าง" value={review.review.content.technicianRemark} />

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">ผลลัพธ์</h3>
            <p className="font-medium text-ink">
              {review.review.content.resultStatus
                ? RESULT_STATUS_LABELS[review.review.content.resultStatus]
                : 'ยังไม่มีการบันทึกผลลัพธ์'}
            </p>
            {review.review.content.resultDetail ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                {review.review.content.resultDetail}
              </p>
            ) : null}
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">เลขเคลม / โรงงาน</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SummaryValue label="เลขที่เคลม" value={review.review.content.claimNo ?? '—'} />
              <SummaryValue
                label="เลขอ้างอิงโรงงาน"
                value={review.review.content.factoryReference ?? '—'}
              />
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">หลักฐาน</h3>
            <EvidenceList
              evidenceAttachmentIds={review.review.content.evidenceAttachmentIds}
              serviceJobId={review.review.serviceJobId}
              reportId={review.review.reportId}
            />
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="mb-4 font-semibold text-ink">การพิจารณา</h3>
            {/* Phase 6R-B.3 (R6R-SF5) defense in depth: keying by the exact
                review identity destroys A's open-modal state when B becomes
                current, independently of the component's own owner check. */}
            <ApprovalDecisionControls
              key={`${review.review.serviceJobId}\0${review.review.reportId}`}
              review={review}
            />
          </GlassCard>
        </>
      ) : null}
    </div>
  );
}
