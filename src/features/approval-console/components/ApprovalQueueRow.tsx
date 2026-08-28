import { ImageIcon } from 'lucide-react';
import type { ApprovalQueueItemV1 } from '../../../types/serviceReportWorkerReads';
import { GlassCard, SecondaryButton } from '../../../shared/components';
import { formatDateShort } from '../../../utils/formatDate';
import { warrantyOutcomeColor, warrantyOutcomeLabel } from '../../../services/serviceJobPresentation';
import { RESULT_STATUS_LABELS } from '../approvalConsoleUi';

export function ApprovalQueueRow({
  item,
  onSelect,
}: {
  item: ApprovalQueueItemV1;
  onSelect: (item: ApprovalQueueItemV1) => void;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink">{item.reportNo}</h3>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${warrantyOutcomeColor(item.warrantyOutcome)}`}
            >
              {warrantyOutcomeLabel(item.warrantyOutcome)}
            </span>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            {item.productName}
            {item.modelOrSku ? ` · ${item.modelOrSku}` : ''} · {item.customerName}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            หมายเลขเครื่อง {item.serialNumber} · เลขติดตาม {item.trackingReference}
          </p>
          <p className="mt-2 text-sm text-neutral-600">{item.customerReportedProblem}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span>ช่าง {item.technician}</span>
            <span>สรุปผลเมื่อ {formatDateShort(item.finalizedAt)}</span>
            {item.resultStatus ? <span>{RESULT_STATUS_LABELS[item.resultStatus]}</span> : null}
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="h-3.5 w-3.5" /> หลักฐาน {item.evidenceCount} รายการ
            </span>
          </div>
        </div>
        <SecondaryButton onClick={() => onSelect(item)} className="shrink-0 px-4 py-2.5 text-sm">
          เปิดพิจารณา
        </SecondaryButton>
      </div>
    </GlassCard>
  );
}
