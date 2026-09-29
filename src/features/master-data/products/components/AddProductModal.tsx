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
  onCreate: (input: NewProductInput) => Promise<void>;
}) {
  const [value, setValue] = useState<NewProductInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleChange = (patch: Partial<NewProductInput>) => {
    setValue((current) => ({ ...current, ...patch }));
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (pending) return;
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

    setErrors({});
    setSubmitError(null);
    setPending(true);
    try {
      await onCreate(input);
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'ไม่สามารถเพิ่มสินค้าได้ กรุณาลองใหม่'
      );
    } finally {
      setPending(false);
    }
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

        {submitError && (
          <p
            role="alert"
            className="rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700"
          >
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <SecondaryButton onClick={onClose} disabled={pending}>
            ยกเลิก
          </SecondaryButton>
          <PrimaryButton onClick={handleSubmit} disabled={pending}>
            {pending ? 'กำลังเพิ่มสินค้า...' : 'เพิ่มสินค้า'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
