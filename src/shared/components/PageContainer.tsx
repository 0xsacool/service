import type { ReactNode } from 'react';

// Extracted from the identical `mx-auto max-w-{N} space-y-6` wrapper repeated
// across Dashboard, ClaimsList, ClaimDetails, and NewClaim — only the
// max-width differs per page.
export function PageContainer({
  children,
  maxWidthClassName = 'max-w-6xl',
  className = '',
}: {
  children: ReactNode;
  maxWidthClassName?: string;
  className?: string;
}) {
  return (
    <div className={`mx-auto ${maxWidthClassName} space-y-6 ${className}`.trim()}>
      {children}
    </div>
  );
}
