import type { MouseEventHandler } from 'react';
import type { ProductStatus } from '../../../../types';

export function ProductStatusBadge({
  status,
  onClick,
  disabled = false,
  ariaLabel,
}: {
  status: ProductStatus;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const isActive = status === 'Active';
  const className = `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${
    isActive
      ? 'bg-success-50 text-success-700 ring-success-200'
      : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
  } ${onClick ? 'transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400' : ''}`;

  const content = (
    <>
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-success-500' : 'bg-neutral-400'}`}
      />
      {isActive ? 'ใช้งาน' : 'เลิกใช้'}
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}
