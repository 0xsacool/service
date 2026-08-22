import { useReducer, useRef, useState } from 'react';
import { Modal, PrimaryButton, SecondaryButton } from '../../../../../shared/components';
import { runProductImport } from '../../../../../imports/products';
import type {
  ProductImportContext,
  ProductImportRecord,
} from '../../../../../imports/products';
import type { ImportPreviewRow } from '../../../../../imports/shared';
import type { ImportCommitResult } from '../../../../../hooks/useProductMaster';
import { ImportChooseFile } from './ImportChooseFile';
import { ImportPreviewStep } from './ImportPreviewStep';
import { ImportValidationStep } from './ImportValidationStep';
import { ImportResultStep } from './ImportResultStep';
import type { ParsedImportFile } from './types';
import {
  initialWizardState,
  reduce,
  submitImport,
  type WizardState,
} from './importWizardController';
import {
  discard,
  mintIdempotencyKey,
  retainForRetry,
  startAttempt,
  type PendingAttemptState,
} from '../../../../../services/productImportPendingAttempt';

const STEP_LABELS: Record<WizardState['step'], string> = {
  chooseFile: 'เลือกไฟล์',
  preview: 'ตรวจสอบตัวอย่าง',
  validation: 'สรุปการตรวจสอบ',
  submitting: 'กำลังนำเข้า',
  staleCatalog: 'ข้อมูลสินค้ามีการเปลี่ยนแปลง',
  error: 'เกิดข้อผิดพลาด',
  result: 'สรุปผลการดำเนินการ',
};

// A same-key ambiguous-failure retry (network error / 5xx) is attempted
// automatically this many times before falling back to a manual retry
// button — bounded so a genuinely-down Worker can't loop forever.
const MAX_AUTOMATIC_RETRIES = 1;

// Orchestrates the Choose File -> Preview -> Validation Summary -> Import
// -> Completed Summary workflow. Parsing (CSV -> rows) happens in
// ImportChooseFile; Preview/Validation reuse the Sprint P2 Import Framework
// as-is (runProductImport) purely for client-side feedback — the actual
// commit is reclassified authoritatively by whichever ProductImportRepository
// backs commitImportRows (mock or Worker), never trusted from this preview.
//
// State/transition logic lives in importWizardController.ts (pure, unit-
// testable); this component is a thin view plus the two things that
// genuinely have to live here: the synchronous double-submit admission
// latch (a useRef, not useState — see PI-3 Slice 2 handoff #9) and the
// pending-idempotency-key bookkeeping for ambiguous-retry vs stale_catalog
// recovery (#12/#13).
export function ImportProductsWizard({
  onClose,
  buildImportContext,
  refreshAndRebuildImportContext,
  commitImportRows,
}: {
  onClose: () => void;
  buildImportContext: () => ProductImportContext;
  refreshAndRebuildImportContext: () => Promise<ProductImportContext>;
  commitImportRows: (
    rows: ImportPreviewRow<ProductImportRecord>[],
    idempotencyKey: string,
    fileName: string | null
  ) => Promise<ImportCommitResult>;
}) {
  const [state, dispatch] = useReducer(reduce, initialWizardState);
  const [pending, setPending] = useState<PendingAttemptState>({ kind: 'idle' });
  const admissionLatch = useRef(false);
  const autoRetryCount = useRef(0);
  // Refs must never be read during render (only in event handlers/effects —
  // see react-hooks/refs). admissionLatch stays the actual synchronous
  // double-submit guard; this mirrors its value into ordinary state purely
  // so the disabled/label attributes below have something render-safe to
  // read, kept in sync at every site that writes the ref.
  const [isBusy, setIsBusy] = useState(false);
  const [isRefreshingStale, setIsRefreshingStale] = useState(false);

  const reset = () => {
    if (admissionLatch.current) return;
    autoRetryCount.current = 0;
    setPending(discard());
    dispatch({ type: 'reset' });
  };

  const handleFileParsed = (parsed: ParsedImportFile) => {
    dispatch({ type: 'fileParsed', file: parsed });
  };

  const runPreview = (file: ParsedImportFile, context: ProductImportContext) => {
    const importPreview = runProductImport(
      { kind: 'matrix', header: file.header, rows: file.rows },
      context
    );
    dispatch({ type: 'previewBuilt', preview: importPreview });
  };

  const handleRunValidation = () => {
    if (state.step !== 'preview') return;
    runPreview(state.file, buildImportContext());
  };

  const handleBack = () => {
    if (admissionLatch.current) return;
    dispatch({ type: 'back' });
  };

  // stale_catalog recovery (#A2/#13) — re-preview must run against a
  // server-CONFIRMED refresh, never the same in-memory products state that
  // was already stale enough to cause the rejection.
  // refreshAndRebuildImportContext performs that refresh and returns a
  // context built directly from the freshly-fetched list, so this never
  // races React's render timing the way reading buildImportContext() right
  // after a setState would. discard() burns the old idempotency key —
  // never resubmit the stale classification's key.
  const handleRefreshAfterStale = async () => {
    if (state.step !== 'staleCatalog' || isRefreshingStale) return;
    const { file } = state;
    setIsRefreshingStale(true);
    setPending(discard());
    try {
      const context = await refreshAndRebuildImportContext();
      runPreview(file, context);
    } finally {
      setIsRefreshingStale(false);
    }
  };

  const runSubmit = async (
    idempotencyKey: string,
    rows: ImportPreviewRow<ProductImportRecord>[],
    fileName: string | null
  ) => {
    const action = await submitImport(
      (key) => commitImportRows(rows, key, fileName),
      idempotencyKey
    );

    if (action.type === 'commitFailedAmbiguous') {
      if (autoRetryCount.current < MAX_AUTOMATIC_RETRIES) {
        autoRetryCount.current += 1;
        setPending((current) => retainForRetry(current));
        dispatch(action);
        // Same key, same rows, same fileName — an ambiguous retry (#12/#13)
        // resubmits the exact same logical request, never a re-derived one.
        void runSubmit(idempotencyKey, rows, fileName);
        return;
      }
      // Automatic retries exhausted — release the latch so a manual retry
      // click can pass through; the key is retained unchanged. Released
      // before dispatch so the re-render it triggers already reflects an
      // enabled retry button.
      admissionLatch.current = false;
      setIsBusy(false);
      dispatch(action);
      return;
    }

    admissionLatch.current = false;
    setIsBusy(false);
    setPending(discard());
    dispatch(action);
  };

  const handleImport = () => {
    if (admissionLatch.current) return;
    if (state.step !== 'validation' || state.preview.summary.errorCount > 0) return;
    admissionLatch.current = true;
    setIsBusy(true);
    autoRetryCount.current = 0;
    const key = pending.kind === 'active' ? pending.idempotencyKey : mintIdempotencyKey();
    setPending(startAttempt(key));
    dispatch({ type: 'submit' });
    void runSubmit(key, state.preview.rows, state.file.fileName);
  };

  const handleManualRetry = () => {
    if (admissionLatch.current) return;
    if (state.step !== 'submitting' || pending.kind !== 'active') return;
    admissionLatch.current = true;
    setIsBusy(true);
    autoRetryCount.current = 0;
    void runSubmit(pending.idempotencyKey, state.preview.rows, state.file.fileName);
  };

  // Covers both in-flight windows the wizard must not let the user abandon
  // mid-request: an active commit, and the stale_catalog server refresh.
  const preventModalClose = state.step === 'submitting' || isRefreshingStale;
  const importableCount =
    state.step === 'validation' || state.step === 'submitting'
      ? state.preview.summary.newCount + state.preview.summary.updatedCount
      : 0;

  return (
    <Modal
      title="นำเข้าสินค้า"
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
      preventClose={preventModalClose}
    >
      <div className="space-y-5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {STEP_LABELS[state.step]}
        </p>

        {state.step === 'chooseFile' && (
          <ImportChooseFile onFileParsed={handleFileParsed} />
        )}

        {state.step === 'preview' && <ImportPreviewStep file={state.file} />}

        {(state.step === 'validation' || state.step === 'submitting') && (
          <ImportValidationStep preview={state.preview} />
        )}

        {state.step === 'submitting' && state.retryMessage && (
          <p className="text-sm text-warning-600">
            การเชื่อมต่อขัดข้อง กำลังลองใหม่โดยใช้คำขอเดิม…
          </p>
        )}

        {state.step === 'staleCatalog' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-neutral-600">
              ข้อมูลสินค้าในระบบมีการเปลี่ยนแปลงระหว่างที่คุณกำลังตรวจสอบ
              กรุณาตรวจสอบตัวอย่างอีกครั้งก่อนนำเข้า
            </p>
            <PrimaryButton onClick={handleRefreshAfterStale} disabled={isRefreshingStale}>
              {isRefreshingStale ? 'กำลังรีเฟรช…' : 'ตรวจสอบตัวอย่างอีกครั้ง'}
            </PrimaryButton>
          </div>
        )}

        {state.step === 'error' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-danger-600">{state.message}</p>
          </div>
        )}

        {state.step === 'result' && (
          <ImportResultStep
            result={state.result}
            summary={state.summary}
            onImportAnother={reset}
            onDone={onClose}
          />
        )}

        {state.step !== 'result' && state.step !== 'staleCatalog' && (
          <div className="flex justify-between border-t border-black/5 pt-4">
            {state.step === 'chooseFile' ? (
              <SecondaryButton onClick={onClose}>ยกเลิก</SecondaryButton>
            ) : (
              <SecondaryButton onClick={handleBack} disabled={isBusy}>
                กลับ
              </SecondaryButton>
            )}

            {state.step === 'preview' && (
              <PrimaryButton onClick={handleRunValidation}>ไปตรวจสอบ</PrimaryButton>
            )}
            {state.step === 'validation' && (
              <PrimaryButton
                onClick={handleImport}
                disabled={importableCount === 0 || state.preview.summary.errorCount > 0}
              >
                {`นำเข้า ${importableCount} รายการ`}
              </PrimaryButton>
            )}
            {state.step === 'submitting' && (
              <PrimaryButton onClick={handleManualRetry} disabled={isBusy}>
                {isBusy ? 'กำลังนำเข้า…' : 'ลองอีกครั้ง'}
              </PrimaryButton>
            )}
            {state.step === 'error' && (
              <PrimaryButton onClick={reset}>ปิด</PrimaryButton>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
