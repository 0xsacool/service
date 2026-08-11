import type { ReactNode } from 'react';

export function GlassCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[1.5rem] bg-white/70 backdrop-blur-xl ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}
