import type { ReactNode } from 'react';

// Extracted from the identical header pattern in Dashboard and ClaimsList
// (title + subtitle + a primary action, in a row that stacks on mobile).
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-neutral-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
