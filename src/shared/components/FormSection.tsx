import type { ComponentType, ReactNode } from 'react';
import { GlassCard } from './GlassCard';

// Promoted from a local helper in NewClaim.tsx so future forms (Customer and
// Product Instance intake, Sprint 2/3) can reuse the same sectioned-card
// pattern instead of redefining it.
export function FormSection({
  icon: Icon,
  title,
  subtitle,
  children,
  headingId,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  subtitle: string;
  children: ReactNode;
  headingId?: string;
}) {
  return (
    <GlassCard className="p-6 animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h2 id={headingId} className="font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <p className="text-sm text-neutral-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </GlassCard>
  );
}
