import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { RegisteredProduct } from '../../../types';
import { useCustomerProducts } from '../../../hooks/useCustomerProducts';
import { GlassCard } from '../GlassCard';
import { SecondaryButton } from '../Button';
import { ProductCard } from './ProductCard';

export interface ProductSelectionProps {
  customerId: string;
  onSelectProduct?: (product: RegisteredProduct) => void;
  onRegisterNewProduct?: () => void;
  className?: string;
}

// Sorted by useCustomerProducts (most recently serviced, then most
// frequently serviced, then never-serviced "Others") — this component only
// renders that order, it doesn't decide it.
export function ProductSelection({
  customerId,
  onSelectProduct,
  onRegisterNewProduct,
  className = '',
}: ProductSelectionProps) {
  const { products } = useCustomerProducts(customerId);
  const [showRegisterNotice, setShowRegisterNotice] = useState(false);

  const handleRegisterNewProduct = () => {
    setShowRegisterNotice(true);
    onRegisterNewProduct?.();
  };

  return (
    <div className={className}>
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink animate-[fade-in_0.4s_ease_both]">
        สินค้าที่ลงทะเบียนไว้
      </h2>

      {products.length > 0 ? (
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onSelect={onSelectProduct} />
          ))}
        </div>
      ) : (
        <GlassCard className="p-8 text-center text-neutral-400 animate-[fade-in_0.4s_ease_both]">
          ยังไม่มีสินค้าที่ลงทะเบียนไว้สำหรับลูกค้ารายนี้
        </GlassCard>
      )}

      <SecondaryButton
        onClick={handleRegisterNewProduct}
        className="mt-4 w-full justify-center px-6 py-4 text-base"
      >
        <Plus className="h-5 w-5" />
        ลงทะเบียนสินค้าใหม่
      </SecondaryButton>
      {showRegisterNotice && (
        <p className="mt-2 text-center text-sm text-neutral-400 animate-[fade-in_0.3s_ease_both]">
          การลงทะเบียนสินค้าใหม่จะเปิดใช้งานในระยะถัดไป
        </p>
      )}
    </div>
  );
}
