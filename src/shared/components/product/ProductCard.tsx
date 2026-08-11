import { ShieldCheck, ShieldOff, Hash, Clock, Wrench } from 'lucide-react';
import type { RegisteredProduct } from '../../../types';
import { GlassCard } from '../GlassCard';
import { PrimaryButton } from '../Button';
import { formatDateShort } from '../../../utils/formatDate';
import { productCategoryIcon } from './productCategoryIcon';

export function ProductCard({
  product,
  onSelect,
}: {
  product: RegisteredProduct;
  onSelect?: (product: RegisteredProduct) => void;
}) {
  const neverServiced = product.lastServiceDate === '—';
  const inWarranty = product.warrantyStatus === 'in_warranty';

  return (
    <GlassCard className="flex flex-col gap-4 p-5 animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="flex h-32 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-50 text-neutral-300">
        {productCategoryIcon(product.category, 'h-12 w-12')}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {product.brand}
        </p>
        <p className="text-lg font-semibold text-ink">
          {product.productName} {product.model}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
          <Hash className="h-3.5 w-3.5 shrink-0" />
          {product.serialNumber}
        </p>
      </div>

      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${
          inWarranty
            ? 'bg-success-50 text-success-700 ring-success-200'
            : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
        }`}
      >
        {inWarranty ? (
          <ShieldCheck className="h-3.5 w-3.5" />
        ) : (
          <ShieldOff className="h-3.5 w-3.5" />
        )}
        {inWarranty ? 'อยู่ในประกัน' : 'หมดประกัน'}
      </span>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {neverServiced
            ? 'ยังไม่เคยเข้ารับบริการ'
            : `เข้ารับบริการล่าสุด ${formatDateShort(product.lastServiceDate)}`}
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="h-3.5 w-3.5" />
          {product.previousServiceCount} ครั้งก่อนหน้า
        </span>
      </p>

      <PrimaryButton onClick={() => onSelect?.(product)} className="w-full">
        ใช้สินค้านี้
      </PrimaryButton>
    </GlassCard>
  );
}
