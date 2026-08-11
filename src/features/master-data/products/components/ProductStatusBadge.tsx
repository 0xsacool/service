import type { ProductStatus } from '../../../../types';

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const isActive = status === 'Active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${
        isActive
          ? 'bg-success-50 text-success-700 ring-success-200'
          : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-success-500' : 'bg-neutral-400'}`}
      />
      {status === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
    </span>
  );
}
