import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backgroundStates = Array.from(document.body.children)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay
      )
      .map((element) => ({ element, inert: element.inert }));
    backgroundStates.forEach(({ element }) => {
      element.inert = true;
    });

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0
      );
    const preferredInitialFocus = dialog.querySelector<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
    );
    const animationFrame = window.requestAnimationFrame(() => {
      if (preferredInitialFocus && preferredInitialFocus.getClientRects().length > 0) {
        preferredInitialFocus.focus();
      } else {
        dialog.focus();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const overlays = document.querySelectorAll<HTMLElement>('[data-modal-overlay]');
      if (overlays[overlays.length - 1] !== overlay) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', onKeyDown);
      backgroundStates.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const content = (
    <div
      ref={overlayRef}
      data-modal-overlay
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${maxWidthClassName} focus:outline-none`}
      >
        <GlassCard className="flex max-h-[90vh] flex-col bg-white/95 animate-[rise_0.3s_cubic-bezier(0.22,1,0.36,1)_both]">
          <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
            <h2 id={titleId} className="font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="ปิดกล่องโต้ตอบ"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </GlassCard>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
