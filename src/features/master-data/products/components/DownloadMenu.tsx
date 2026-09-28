import { useEffect, useId, useRef, useState } from 'react';
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
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();

    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <SecondaryButton
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="px-4 py-2.5 text-sm"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <Icon className="h-4 w-4" />
        {label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </SecondaryButton>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label={`${label} รูปแบบไฟล์`}
          className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-black/5"
        >
          <button
            ref={firstItemRef}
            type="button"
            onClick={() => {
              onSelectExcel();
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            Excel (.xls)
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectCsv();
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            CSV
          </button>
        </div>
      )}
    </div>
  );
}
