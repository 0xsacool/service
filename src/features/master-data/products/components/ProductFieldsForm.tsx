import { useId } from 'react';
import type { ProductCategory, ProductStatus } from '../../../../types';
import type { NewProductInput } from '../../../../services/productMasterAdmin';
import { Field, inputClass } from '../../../../shared/components';

const STATUS_OPTIONS: ProductStatus[] = ['Active', 'Legacy'];

// The Brand/Category/Model/SKU/Product Name/Warranty Months/Status field
// set — shared by Add Product (a modal) and the Product Detail General tab
// (an inline edit form), so the fields, layout, and error display live in
// exactly one place instead of being copy-pasted between them.
export function ProductFieldsForm({
  categories,
  brands,
  value,
  errors,
  onChange,
}: {
  categories: ProductCategory[];
  brands: string[];
  value: NewProductInput;
  errors: Record<string, string>;
  onChange: (patch: Partial<NewProductInput>) => void;
}) {
  const formId = useId();
  const idFor = (field: string) => `${formId}-${field}`;
  const errorProps = (field: string) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? idFor(`${field}-error`) : undefined,
  });

  return (
    <div className="space-y-4">
      <Field label="แบรนด์">
        <input
          list={idFor('brand-options')}
          value={value.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          placeholder="เช่น BRUNO"
          className={inputClass()}
          {...errorProps('brand')}
        />
        <datalist id={idFor('brand-options')}>
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {errors.brand && (
          <p
            id={idFor('brand-error')}
            role="alert"
            className="mt-1.5 text-xs text-danger-700"
          >
            {errors.brand}
          </p>
        )}
      </Field>

      <Field label="หมวดหมู่">
        <select
          value={value.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
          className={inputClass()}
          {...errorProps('categoryId')}
        >
          <option value="">เลือกหมวดหมู่…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId && (
          <p
            id={idFor('categoryId-error')}
            role="alert"
            className="mt-1.5 text-xs text-danger-700"
          >
            {errors.categoryId}
          </p>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="รุ่น">
          <input
            value={value.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="เช่น BOE021"
            className={inputClass()}
            {...errorProps('model')}
          />
          {errors.model && (
            <p
              id={idFor('model-error')}
              role="alert"
              className="mt-1.5 text-xs text-danger-700"
            >
              {errors.model}
            </p>
          )}
        </Field>

        <Field label="SKU">
          <input
            value={value.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            placeholder="เช่น BOE021-WH"
            className={inputClass()}
            {...errorProps('sku')}
          />
          {errors.sku && (
            <p
              id={idFor('sku-error')}
              role="alert"
              className="mt-1.5 text-xs text-danger-700"
            >
              {errors.sku}
            </p>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ชื่อสินค้า">
          <input
            value={value.productName}
            onChange={(e) => onChange({ productName: e.target.value })}
            placeholder="เช่น Compact Hot Plate"
            className={inputClass()}
            {...errorProps('productName')}
          />
          {errors.productName && (
            <p
              id={idFor('productName-error')}
              role="alert"
              className="mt-1.5 text-xs text-danger-700"
            >
              {errors.productName}
            </p>
          )}
        </Field>

        <Field label="ระยะประกัน (เดือน)">
          <input
            type="number"
            min={1}
            value={value.warrantyMonths}
            onChange={(e) => onChange({ warrantyMonths: Number(e.target.value) })}
            className={inputClass()}
            {...errorProps('warrantyMonths')}
          />
          {errors.warrantyMonths && (
            <p
              id={idFor('warrantyMonths-error')}
              role="alert"
              className="mt-1.5 text-xs text-danger-700"
            >
              {errors.warrantyMonths}
            </p>
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-neutral-700">สถานะ</legend>
        <div className="flex gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ status: option })}
              aria-pressed={value.status === option}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                value.status === option
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
              }`}
            >
              {option === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
