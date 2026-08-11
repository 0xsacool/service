import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { GlassCard } from './GlassCard';

// First introduced for Sprint P3's Add Product / Import Products dialogs —
// both need the same overlay + Escape/click-outside dismiss behavior, so
// it's shared rather than duplicated between the two.
export function Modal({
  title,
  onClose,
  children,
  maxWidthClassName = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <GlassCard
        className={`relative flex max-h-[90vh] w-full ${maxWidthClassName} flex-col bg-white/95 animate-[rise_0.3s_cubic-bezier(0.22,1,0.36,1)_both]`}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h2 className="font-semibold tracking-tight text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </GlassCard>
    </div>
  );
}
