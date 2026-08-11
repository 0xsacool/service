import type { ParsedImportFile } from './types';

const PREVIEW_ROW_LIMIT = 10;

// A quick sanity check before validation runs: does this look like the
// right file? Shows the detected columns and a sample of raw rows exactly
// as parsed — no normalization, no business rules applied yet.
export function ImportPreviewStep({ file }: { file: ParsedImportFile }) {
  const sample = file.rows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-500">
          <span className="font-medium text-ink">{file.fileName}</span> — พบข้อมูล{' '}
          {file.rows.length} แถว
        </span>
        {file.rows.length > PREVIEW_ROW_LIMIT && (
          <span className="text-xs text-neutral-400">
            แสดง {PREVIEW_ROW_LIMIT} แถวแรก
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-neutral-50/70 text-left text-xs font-medium uppercase tracking-wide text-neutral-400">
              {file.header.map((column, index) => (
                <th key={index} className="px-4 py-2.5 whitespace-nowrap">
                  {column || `คอลัมน์ที่ ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {sample.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {file.header.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="px-4 py-2.5 whitespace-nowrap text-neutral-600"
                  >
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
