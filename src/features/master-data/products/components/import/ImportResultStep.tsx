import { CheckCircle2 } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../../../../../shared/components';
import type { ImportCommitResult } from '../../../../../hooks/useProductMaster';
import type { ImportSummary } from '../../../../../imports/shared';

export function ImportResultStep({
  result,
  summary,
  onImportAnother,
  onDone,
}: {
  result: ImportCommitResult;
  summary: ImportSummary;
  onImportAnother: () => void;
  onDone: () => void;
}) {
  const untouched = summary.skippedCount + summary.errorCount;

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-50 text-success-600">
        <CheckCircle2 className="h-8 w-8" />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-ink">นำเข้าเสร็จสมบูรณ์</h3>
        <p className="mt-1 text-sm text-neutral-500">
          สร้างสินค้าใหม่ {result.created} รายการ และอัปเดต {result.updated} รายการ
          {untouched > 0 &&
            ` — ${untouched} row${untouched === 1 ? '' : 's'} left untouched (already up to date or had errors)`}
          .
        </p>
      </div>

      <div className="flex flex-col-reverse justify-center gap-3 sm:flex-row">
        <SecondaryButton onClick={onImportAnother}>นำเข้าไฟล์อื่น</SecondaryButton>
        <PrimaryButton onClick={onDone}>เสร็จสิ้น</PrimaryButton>
      </div>
    </div>
  );
}
