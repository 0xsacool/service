import { useState } from 'react';
import { Modal, PrimaryButton, SecondaryButton } from '../../../../../shared/components';
import { runProductImport } from '../../../../../imports/products';
import type {
  ProductImportContext,
  ProductImportRecord,
} from '../../../../../imports/products';
import type { ImportPreview } from '../../../../../imports/shared';
import type { ImportCommitResult } from '../../../../../hooks/useProductMaster';
import { ImportChooseFile } from './ImportChooseFile';
import { ImportPreviewStep } from './ImportPreviewStep';
import { ImportValidationStep } from './ImportValidationStep';
import { ImportResultStep } from './ImportResultStep';
import type { ParsedImportFile } from './types';

type WizardStep = 'chooseFile' | 'preview' | 'validation' | 'result';

const STEP_LABELS: Record<WizardStep, string> = {
  chooseFile: 'เลือกไฟล์',
  preview: 'ตรวจสอบตัวอย่าง',
  validation: 'สรุปการตรวจสอบ',
  result: 'สรุปผลการดำเนินการ',
};

// Orchestrates the Choose File -> Preview -> Validation Summary -> Import
// -> Completed Summary workflow. Parsing (CSV -> rows) happens in
// ImportChooseFile; everything from "Continue to Validation" onward reuses
// the Sprint P2 Import Framework as-is (runProductImport) — this file
// never re-implements normalization or validation, only sequences the UI
// around them and commits the result through the product repository.
export function ImportProductsWizard({
  onClose,
  buildImportContext,
  commitImportRows,
}: {
  onClose: () => void;
  buildImportContext: () => ProductImportContext;
  commitImportRows: (
    rows: ImportPreview<ProductImportRecord>['rows']
  ) => ImportCommitResult;
}) {
  const [step, setStep] = useState<WizardStep>('chooseFile');
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview<ProductImportRecord> | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const reset = () => {
    setStep('chooseFile');
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  const handleFileParsed = (parsed: ParsedImportFile) => {
    setFile(parsed);
    setStep('preview');
  };

  const handleRunValidation = () => {
    if (!file) return;
    const context = buildImportContext();
    const importPreview = runProductImport(
      { kind: 'matrix', header: file.header, rows: file.rows },
      context
    );
    setPreview(importPreview);
    setStep('validation');
  };

  const handleImport = () => {
    if (!preview) return;
    const commitResult = commitImportRows(preview.rows);
    setResult(commitResult);
    setStep('result');
  };

  const importableCount = preview
    ? preview.summary.newCount + preview.summary.updatedCount
    : 0;

  return (
    <Modal title="นำเข้าสินค้า" onClose={onClose} maxWidthClassName="max-w-3xl">
      <div className="space-y-5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {STEP_LABELS[step]}
        </p>

        {step === 'chooseFile' && <ImportChooseFile onFileParsed={handleFileParsed} />}

        {step === 'preview' && file && <ImportPreviewStep file={file} />}

        {step === 'validation' && preview && <ImportValidationStep preview={preview} />}

        {step === 'result' && result && preview && (
          <ImportResultStep
            result={result}
            summary={preview.summary}
            onImportAnother={reset}
            onDone={onClose}
          />
        )}

        {step !== 'result' && (
          <div className="flex justify-between border-t border-black/5 pt-4">
            {step === 'chooseFile' ? (
              <SecondaryButton onClick={onClose}>ยกเลิก</SecondaryButton>
            ) : (
              <SecondaryButton
                onClick={() => setStep(step === 'validation' ? 'preview' : 'chooseFile')}
              >
                กลับ
              </SecondaryButton>
            )}

            {step === 'preview' && (
              <PrimaryButton onClick={handleRunValidation}>ไปตรวจสอบ</PrimaryButton>
            )}
            {step === 'validation' && (
              <PrimaryButton
                onClick={handleImport}
                className={importableCount === 0 ? 'pointer-events-none opacity-50' : ''}
              >
                นำเข้า {importableCount} รายการ
              </PrimaryButton>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
