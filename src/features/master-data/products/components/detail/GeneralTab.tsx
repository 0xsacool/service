import { useState } from 'react';
import {
  Building2,
  Layers,
  Package,
  Hash,
  Tag,
  ShieldCheck,
  BadgeCheck,
  Pencil,
  Check,
} from 'lucide-react';
import type { ProductCategory, ProductMasterEntry } from '../../../../../types';
import type { NewProductInput } from '../../../../../services/productMasterAdmin';
import { validateNewProductInput } from '../../../../../validation';
import {
  GlassCard,
  Row,
  PrimaryButton,
  SecondaryButton,
} from '../../../../../shared/components';
import { ProductStatusBadge } from '../ProductStatusBadge';
import { ProductFieldsForm } from '../ProductFieldsForm';

function toInput(product: ProductMasterEntry): NewProductInput {
  return {
    brand: product.brand,
    categoryId: product.categoryId,
    model: product.model,
    sku: product.sku ?? '',
    productName: product.name,
    warrantyMonths: product.warrantyMonths,
    status: product.status,
  };
}

export function GeneralTab({
  product,
  categories,
  brands,
  onSave,
  canEdit,
}: {
  product: ProductMasterEntry;
  categories: ProductCategory[];
  brands: string[];
  onSave: (input: NewProductInput) => void;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState<NewProductInput>(() => toInput(product));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categoryName =
    categories.find((c) => c.id === product.categoryId)?.name ?? 'ไม่ระบุหมวดหมู่';

  const startEditing = () => {
    setValue(toInput(product));
    setErrors({});
    setIsEditing(true);
  };

  const handleChange = (patch: Partial<NewProductInput>) => {
    setValue((current) => ({ ...current, ...patch }));
  };

  const handleSave = () => {
    const input: NewProductInput = {
      ...value,
      brand: value.brand.trim(),
      model: value.model.trim(),
      sku: value.sku.trim(),
      productName: value.productName.trim(),
    };

    const result = validateNewProductInput(input);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    onSave(input);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <GlassCard className="p-6">
        <ProductFieldsForm
          categories={categories}
          brands={brands}
          value={value}
          errors={errors}
          onChange={handleChange}
        />
        <div className="mt-6 flex justify-end gap-3 border-t border-black/5 pt-4">
          <SecondaryButton onClick={() => setIsEditing(false)}>ยกเลิก</SecondaryButton>
          <PrimaryButton onClick={handleSave}>
            <Check className="h-4 w-4" />
            บันทึกการเปลี่ยนแปลง
          </PrimaryButton>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-semibold tracking-tight text-ink">ข้อมูลทั่วไป</h2>
        {canEdit && (
          <button
            onClick={startEditing}
            className="flex items-center gap-2 rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
          >
            <Pencil className="h-4 w-4" />
            แก้ไข
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Row icon={Building2} label="แบรนด์">
          {product.brand}
        </Row>
        <Row icon={Layers} label="หมวดหมู่">
          {categoryName}
        </Row>
        <Row icon={Package} label="รุ่น">
          {product.model}
        </Row>
        <Row icon={Hash} label="SKU">
          {product.sku ?? '—'}
        </Row>
        <Row icon={Tag} label="ชื่อสินค้า">
          {product.name}
        </Row>
        <Row icon={ShieldCheck} label="ระยะประกัน">
          {product.warrantyMonths} เดือน
        </Row>
        <Row icon={BadgeCheck} label="สถานะ">
          <ProductStatusBadge status={product.status} />
        </Row>
      </div>
    </GlassCard>
  );
}
