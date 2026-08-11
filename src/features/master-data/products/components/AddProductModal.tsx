import { useState } from 'react';
import type { ProductCategory } from '../../../../types';
import type { NewProductInput } from '../../../../services/productMasterAdmin';
import { validateNewProductInput } from '../../../../validation';
import { Modal, PrimaryButton, SecondaryButton } from '../../../../shared/components';
import { ProductFieldsForm } from './ProductFieldsForm';

const EMPTY_INPUT: NewProductInput = {
  brand: '',
  categoryId: '',
  model: '',
  sku: '',
  productName: '',
  warrantyMonths: 12,
  status: 'Active',
};

export function AddProductModal({
  categories,
  brands,
  onClose,
  onCreate,
}: {
  categories: ProductCategory[];
  brands: string[];
  onClose: () => void;
  onCreate: (input: NewProductInput) => void;
}) {
  const [value, setValue] = useState<NewProductInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (patch: Partial<NewProductInput>) => {
    setValue((current) => ({ ...current, ...patch }));
  };

  const handleSubmit = () => {
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

    onCreate(input);
  };

  return (
    <Modal title="เพิ่มสินค้า" onClose={onClose} maxWidthClassName="max-w-xl">
      <div className="space-y-4">
        <ProductFieldsForm
          categories={categories}
          brands={brands}
          value={value}
          errors={errors}
          onChange={handleChange}
        />

        <div className="flex justify-end gap-3 pt-2">
          <SecondaryButton onClick={onClose}>ยกเลิก</SecondaryButton>
          <PrimaryButton onClick={handleSubmit}>เพิ่มสินค้า</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
