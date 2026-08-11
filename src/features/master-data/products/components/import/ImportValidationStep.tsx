import { formatImportSummary } from '../../../../../imports/shared';
import type { ImportPreview, ImportRowStatus } from '../../../../../imports/shared';
import type { ProductImportRecord } from '../../../../../imports/products';

const ROW_STATUS_STYLES: Record<ImportRowStatus, string> = {
  new: 'bg-success-50 text-success-700 ring-success-200',
  updated: 'bg-brand-50 text-brand-700 ring-brand-100',
  skipped: 'bg-neutral-100 text-neutral-500 ring-neutral-200',
  error: 'bg-danger-50 text-danger-600 ring-danger-200',
};

const ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  new: 'ใหม่',
  updated: 'อัปเดต',
  skipped: 'ข้าม',
  error: 'ผิดพลาด',
};

function ImportRowStatusBadge({ status }: { status: ImportRowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ROW_STATUS_STYLES[status]}`}
    >
      {ROW_STATUS_LABELS[status]}
    </span>
  );
}

export function ImportValidationStep({
  preview,
}: {
  preview: ImportPreview<ProductImportRecord>;
}) {
  const summaryLines = formatImportSummary(preview.summary, 'สินค้า');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {summaryLines.map((line) => (
          <div
            key={line.label}
            className="rounded-2xl bg-white/70 px-3 py-3 text-center ring-1 ring-black/5"
          >
            <p className="text-2xl font-semibold text-ink">{line.count}</p>
            <p className="mt-0.5 text-xs text-neutral-400">{line.label}</p>
          </div>
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto rounded-2xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50/95 backdrop-blur">
            <tr className="border-b border-black/5 text-left text-xs font-medium uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-2.5">แถว</th>
              <th className="px-4 py-2.5">สถานะ</th>
              <th className="px-4 py-2.5">แบรนด์</th>
              <th className="px-4 py-2.5">รุ่น</th>
              <th className="px-4 py-2.5">ชื่อสินค้า</th>
              <th className="px-4 py-2.5">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {preview.rows.map((row) => (
              <tr key={row.rowNumber}>
                <td className="px-4 py-2.5 text-neutral-400">{row.rowNumber}</td>
                <td className="px-4 py-2.5">
                  <ImportRowStatusBadge status={row.status} />
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{row.record?.brand}</td>
                <td className="px-4 py-2.5 text-neutral-600">{row.record?.model}</td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {row.record?.productName}
                </td>
                <td className="px-4 py-2.5">
                  {row.issues.length > 0 && (
                    <ul className="space-y-0.5">
                      {row.issues.map((issue, index) => (
                        <li
                          key={index}
                          className={
                            issue.severity === 'error'
                              ? 'text-danger-600'
                              : 'text-warning-600'
                          }
                        >
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
