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
  return (
    <div className="space-y-4">
      <Field label="แบรนด์">
        <input
          list="product-brand-options"
          value={value.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          placeholder="e.g. BRUNO"
          className={inputClass()}
        />
        <datalist id="product-brand-options">
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {errors.brand && <p className="mt-1.5 text-xs text-danger-600">{errors.brand}</p>}
      </Field>

      <Field label="หมวดหมู่">
        <select
          value={value.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
          className={inputClass()}
        >
          <option value="">เลือกหมวดหมู่…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId && (
          <p className="mt-1.5 text-xs text-danger-600">{errors.categoryId}</p>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="รุ่น">
          <input
            value={value.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="e.g. BOE021"
            className={inputClass()}
          />
          {errors.model && (
            <p className="mt-1.5 text-xs text-danger-600">{errors.model}</p>
          )}
        </Field>

        <Field label="SKU">
          <input
            value={value.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            placeholder="e.g. BOE021-WH"
            className={inputClass()}
          />
          {errors.sku && <p className="mt-1.5 text-xs text-danger-600">{errors.sku}</p>}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ชื่อสินค้า">
          <input
            value={value.productName}
            onChange={(e) => onChange({ productName: e.target.value })}
            placeholder="e.g. Compact Hot Plate"
            className={inputClass()}
          />
          {errors.productName && (
            <p className="mt-1.5 text-xs text-danger-600">{errors.productName}</p>
          )}
        </Field>

        <Field label="ระยะประกัน (เดือน)">
          <input
            type="number"
            min={1}
            value={value.warrantyMonths}
            onChange={(e) => onChange({ warrantyMonths: Number(e.target.value) })}
            className={inputClass()}
          />
          {errors.warrantyMonths && (
            <p className="mt-1.5 text-xs text-danger-600">{errors.warrantyMonths}</p>
          )}
        </Field>
      </div>

      <Field label="สถานะ">
        <div className="flex gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ status: option })}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                value.status === option
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
              }`}
            >
              {option === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
