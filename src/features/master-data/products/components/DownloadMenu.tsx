import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import { SecondaryButton } from '../../../../shared/components';

// One small dropdown shared by Export Products and Download Template —
// both offer the same Excel/CSV choice, just with different builders
// behind them.
export function DownloadMenu({
  label,
  icon: Icon,
  onSelectExcel,
  onSelectCsv,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelectExcel: () => void;
  onSelectCsv: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <SecondaryButton onClick={() => setOpen((o) => !o)} className="px-4 py-2.5 text-sm">
        <Icon className="h-4 w-4" />
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </SecondaryButton>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-black/5">
          <button
            onClick={() => {
              onSelectExcel();
              setOpen(false);
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Excel (.xls)
          </button>
          <button
            onClick={() => {
              onSelectCsv();
              setOpen(false);
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            CSV
          </button>
        </div>
      )}
    </div>
  );
}
