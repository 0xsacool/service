import { useId, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { parseCsv } from '../../../../../utils/csv';
import type { ParsedImportFile } from './types';

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// CSV-only today — reading a real .xlsx binary needs a parsing library,
// which this sprint deliberately doesn't add (see Sprint P3's Architecture
// Summary). The Import Framework itself (src/imports/) doesn't care what
// format the file was; this step's only job is turning a File into rows.
export function ImportChooseFile({
  onFileParsed,
}: {
  onFileParsed: (file: ParsedImportFile) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('ขณะนี้รองรับเฉพาะไฟล์ CSV กรุณาแปลงไฟล์ Excel เป็น CSV แล้วลองอีกครั้ง');
      return;
    }

    setIsReading(true);
    try {
      const text = await readFileAsText(file);
      const rows = parseCsv(text);
      if (rows.length < 1) {
        setError('ไฟล์นี้ไม่มีแถวสำหรับนำเข้า');
        return;
      }
      const [header, ...dataRows] = rows;
      if (dataRows.length === 0) {
        setError('ไฟล์นี้มีเฉพาะหัวตาราง จึงไม่มีข้อมูลให้นำเข้า');
        return;
      }
      onFileParsed({ fileName: file.name, header, rows: dataRows });
    } catch {
      setError('อ่านไฟล์ไม่ได้ กรุณาตรวจสอบว่าเป็นไฟล์ CSV ปกติ');
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p id={descriptionId} className="text-sm text-neutral-600">
        เลือกไฟล์ CSV จากตารางสินค้าของบริษัท หรือกรอกข้อมูลจากแม่แบบที่ดาวน์โหลดไว้
      </p>

      <label
        htmlFor={inputId}
        aria-busy={isReading}
        className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-black/10 bg-white/60 px-6 py-10 text-center transition-colors motion-reduce:transition-none hover:border-brand-300 hover:bg-brand-50/40 focus-within:ring-2 focus-within:ring-brand-600 focus-within:ring-offset-2"
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"
          aria-hidden="true"
        >
          {isReading ? (
            <Upload className="h-6 w-6 animate-pulse motion-reduce:animate-none" />
          ) : (
            <FileSpreadsheet className="h-6 w-6" />
          )}
        </div>
        <div>
          <p className="font-medium text-ink" aria-live="polite">
            {isReading ? 'กำลังอ่านไฟล์…' : 'เลือกไฟล์ CSV'}
          </p>
          <p className="mt-1 text-xs text-neutral-600">รองรับเฉพาะไฟล์ .csv</p>
        </div>
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={handleFileChange}
          disabled={isReading}
          aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
          aria-invalid={Boolean(error)}
        />
      </label>

      {error && (
        <div
          id={errorId}
          role="alert"
          className="rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-200"
        >
          {error}
        </div>
      )}
    </div>
  );
}
