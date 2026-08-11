import type { ComponentType, ReactNode } from 'react';

// Icon + title + description + optional action, with no opinion on its own
// outer layout (no wrapping flex/padding) — callers keep their existing
// wrapper so this can drop into different page contexts without imposing a
// second layer of layout classes.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <Icon className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {description && <p className="mt-2 text-neutral-500">{description}</p>}
      {action}
    </>
  );
}
