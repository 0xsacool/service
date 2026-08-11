import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// For a failed data operation inside an otherwise-normal page (e.g. a fetch
// that returned an error) — distinct from ErrorBoundary, which catches
// render crashes. Scaffolded for Sprint 3/4; not yet rendered anywhere,
// since mock data reads can't fail today.
export function ErrorState({
  title = 'เกิดข้อผิดพลาด',
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-50 text-danger-500">
        <AlertTriangle className="h-8 w-8" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {description && <p className="max-w-sm text-sm text-neutral-500">{description}</p>}
      {action}
    </div>
  );
}
