import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { RegisteredProduct } from '../../../types';
import { useCustomerProducts } from '../../../hooks/useCustomerProducts';
import { GlassCard } from '../GlassCard';
import { SecondaryButton } from '../Button';
import { ProductCard } from './ProductCard';
import { RegisterProductForm } from './RegisterProductForm';

export interface ProductSelectionProps {
  // F5d-65 — null for a brand-new, not-yet-durable customer (IntakeCustomer
  // kind: 'new'): there is nothing to look up yet, so useCustomerProducts
  // returns an empty list without a repository call.
  customerId: string | null;
  onSelectProduct?: (product: RegisteredProduct) => void;
  className?: string;
}

// Sorted by useCustomerProducts (most recently serviced, then most
// frequently serviced, then never-serviced "Others") — this component only
// renders that order, it doesn't decide it.
export function ProductSelection({
  customerId,
  onSelectProduct,
  className = '',
}: ProductSelectionProps) {
  const { products } = useCustomerProducts(customerId);
  const [isRegistering, setIsRegistering] = useState(false);

  if (isRegistering) {
    return (
      <div className={className}>
        <RegisterProductForm
          onRegister={(product) => {
            setIsRegistering(false);
            onSelectProduct?.(product);
          }}
          onCancel={() => setIsRegistering(false)}
        />
      </div>
    );
  }

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
        onClick={() => setIsRegistering(true)}
        className="mt-4 w-full justify-center px-6 py-4 text-base"
      >
        <Plus className="h-5 w-5" />
        ลงทะเบียนสินค้าใหม่
      </SecondaryButton>
    </div>
  );
}
