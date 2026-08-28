import { useState } from 'react';
import type { ApprovalQueueMode, ApprovalQueueRequest } from '../../../types/serviceReportWorkerReads';
import { Field, inputClass } from '../../../shared/components';

const MODE_LABELS: Record<ApprovalQueueMode, string> = {
  queue: 'คิวที่รอการอนุมัติ',
  'report-number': 'ค้นหาเลขที่ใบรายงาน',
  'tracking-reference': 'ค้นหาเลขติดตาม',
};

const PAGE_SIZE = 25;

// Phase 6R-B — mode is expressed purely via ApprovalQueueRequest (D25); this
// component only decides which request shape to send. Exact search only: a
// search request is only sent once the field has non-blank text, otherwise
// the base pending queue stays visible underneath the empty search field —
// this doubles as "return to base queue" (clear the text, or press the
// queue tab). No client-side format re-validation beyond non-empty; the
// repository/Worker remain the authoritative validators and their thrown
// error surfaces through the queue's own error state.
export function ApprovalQueueSearchControls({
  onRequestChange,
}: {
  onRequestChange: (request: ApprovalQueueRequest) => void;
}) {
  const [uiMode, setUiMode] = useState<ApprovalQueueMode>('queue');
  const [searchText, setSearchText] = useState('');

  const selectMode = (mode: ApprovalQueueMode) => {
    setUiMode(mode);
    setSearchText('');
    onRequestChange({ mode: 'queue', pageSize: PAGE_SIZE });
  };

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    if (value.trim().length === 0) {
      onRequestChange({ mode: 'queue', pageSize: PAGE_SIZE });
      return;
    }
    if (uiMode === 'report-number') {
      onRequestChange({ mode: 'report-number', reportNo: value, pageSize: PAGE_SIZE });
    } else if (uiMode === 'tracking-reference') {
      onRequestChange({ mode: 'tracking-reference', trackingReference: value, pageSize: PAGE_SIZE });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="โหมดการค้นหา">
        {(Object.keys(MODE_LABELS) as ApprovalQueueMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={uiMode === mode}
            onClick={() => selectMode(mode)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 ${
              uiMode === mode
                ? 'bg-brand-500 text-white'
                : 'bg-white/80 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
            }`}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {uiMode !== 'queue' ? (
        <Field
          label={
            uiMode === 'report-number'
              ? 'เลขที่ใบรายงาน (ค้นหาแบบตรงตัวเท่านั้น)'
              : 'เลขติดตามงานบริการ (ค้นหาแบบตรงตัวเท่านั้น)'
          }
        >
          <input
            value={searchText}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={
              uiMode === 'report-number'
                ? 'เลขที่ใบรายงาน เช่น FR-2026-000001'
                : 'เลขติดตามงานบริการ'
            }
            className={inputClass()}
          />
        </Field>
      ) : null}
    </div>
  );
}
