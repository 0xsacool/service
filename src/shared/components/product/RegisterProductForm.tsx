import { useState } from 'react';
import { AlertTriangle, PackagePlus } from 'lucide-react';
import type {
  ProductMasterEntry,
  RegisteredProduct,
  WarrantyStatus,
} from '../../../types';
import {
  buildManualRegisteredProduct,
  checkSerialAgainstServiceHistory,
  createEmptyManualProductEntry,
  validateManualProductEntry,
} from '../../../services/productRegistration';
import { useProductMaster } from '../../../hooks/useProductMaster';
import { useServiceJobs } from '../../../hooks/useServiceJobs';
import { Field } from '../Field';
import { FormSection } from '../FormSection';
import { PrimaryButton, SecondaryButton } from '../Button';
import { inputClass } from '../../../utils/inputClass';

const CATALOG_NONE = '';
const CATALOG_MANUAL = 'manual';

const SERIAL_ALREADY_KNOWN_MESSAGE =
  'หมายเลขเครื่องนี้มีประวัติงานบริการอยู่แล้ว ไม่สามารถลงทะเบียนเป็นสินค้าใหม่ได้ กรุณาตรวจสอบหมายเลขเครื่อง หรือค้นหาลูกค้าเดิมแล้วเลือกสินค้าจากประวัติของลูกค้ารายนั้น';

// F5d-65 — activates the previously inert "ลงทะเบียนสินค้าใหม่" action.
// Per DECISIONS.md #037 this collects intake data for the new Service Job
// only — it does not create a product_instances/registered-products record
// of any kind (none exists). Confirming here calls the exact same
// onRegister callback ProductSelection already wires to onSelectProduct, so
// downstream (intake, Save & Print) treats a manual entry identically to a
// picked ProductCard.
//
// Blocker fix: this component takes no customer phone and makes no
// ownership judgement — see checkSerialAgainstServiceHistory()'s comment for
// why phone equality cannot prove a serial belongs to the selected customer.
export function RegisterProductForm({
  onRegister,
  onCancel,
}: {
  onRegister: (product: RegisteredProduct) => void;
  onCancel: () => void;
}) {
  const { products: catalog } = useProductMaster();
  const { serviceJobs } = useServiceJobs();

  const [catalogSelection, setCatalogSelection] = useState<string>(CATALOG_NONE);
  const [entry, setEntry] = useState(createEmptyManualProductEntry());
  // Starts unselected. There is no default warranty value anywhere in this
  // path — an unconfirmed warranty blocks submission rather than silently
  // becoming 'out_of_warranty' (F5d-65 blocker fix, P1 #1).
  const [warrantyStatus, setWarrantyStatus] = useState<WarrantyStatus | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const matchedCatalogEntry: ProductMasterEntry | undefined =
    catalogSelection !== CATALOG_NONE && catalogSelection !== CATALOG_MANUAL
      ? catalog.find((product) => product.id === catalogSelection)
      : undefined;

  const usingManualEntry = catalogSelection === CATALOG_MANUAL || catalog.length === 0;

  const handleCatalogChange = (id: string) => {
    setCatalogSelection(id);
    const matched = catalog.find((product) => product.id === id);
    if (matched) {
      setEntry((current) => ({
        ...current,
        brand: matched.brand,
        productName: matched.name,
        model: matched.model,
        category: matched.categoryId,
      }));
    }
  };

  const handleConfirm = () => {
    const result = validateManualProductEntry(entry, warrantyStatus);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    const history = checkSerialAgainstServiceHistory(entry.serialNumber, serviceJobs);
    if (history.kind === 'already-in-service-history') {
      setConflictMessage(SERIAL_ALREADY_KNOWN_MESSAGE);
      return;
    }
    setConflictMessage(null);

    // validateManualProductEntry() already rejected a null warranty, so this
    // narrowing is the same rule stated once more for the type system — never
    // a fallback that could substitute a value of its own.
    if (warrantyStatus === null) return;
    onRegister(buildManualRegisteredProduct(entry, warrantyStatus, matchedCatalogEntry));
  };

  return (
    <FormSection
      icon={PackagePlus}
      title="ลงทะเบียนสินค้าใหม่"
      subtitle="กรอกข้อมูลสินค้าสำหรับงานบริการนี้"
      headingId="register-product-heading"
    >
      {catalog.length > 0 && (
        <Field label="เลือกจากรายการสินค้า">
          <select
            value={catalogSelection}
            onChange={(e) => handleCatalogChange(e.target.value)}
            className={inputClass()}
          >
            <option value={CATALOG_NONE}>เลือกสินค้าจากรายการ…</option>
            {catalog.map((product) => (
              <option key={product.id} value={product.id}>
                {product.brand} — {product.name} {product.model}
              </option>
            ))}
            <option value={CATALOG_MANUAL}>ไม่พบในรายการ / กรอกเอง</option>
          </select>
        </Field>
      )}

      {usingManualEntry && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="แบรนด์ (ไม่บังคับ)">
            <input
              value={entry.brand}
              onChange={(e) =>
                setEntry((current) => ({ ...current, brand: e.target.value }))
              }
              className={inputClass()}
            />
          </Field>
          <Field label="รุ่น (ไม่บังคับ)">
            <input
              value={entry.model}
              onChange={(e) =>
                setEntry((current) => ({ ...current, model: e.target.value }))
              }
              className={inputClass()}
            />
          </Field>
        </div>
      )}

      {!usingManualEntry && matchedCatalogEntry && (
        <p className="text-sm text-neutral-500">
          {matchedCatalogEntry.brand} — {matchedCatalogEntry.name}{' '}
          {matchedCatalogEntry.model}
        </p>
      )}

      <Field label="ชื่อสินค้า">
        <input
          value={entry.productName}
          onChange={(e) =>
            setEntry((current) => ({ ...current, productName: e.target.value }))
          }
          disabled={!usingManualEntry && Boolean(matchedCatalogEntry)}
          aria-invalid={Boolean(errors.productName)}
          className={inputClass()}
        />
        {errors.productName && (
          <p role="alert" className="mt-1.5 text-xs text-danger-600">
            {errors.productName}
          </p>
        )}
      </Field>

      <Field label="หมวดหมู่">
        <input
          value={entry.category}
          onChange={(e) =>
            setEntry((current) => ({ ...current, category: e.target.value }))
          }
          disabled={!usingManualEntry && Boolean(matchedCatalogEntry)}
          aria-invalid={Boolean(errors.category)}
          className={inputClass()}
        />
        {errors.category && (
          <p role="alert" className="mt-1.5 text-xs text-danger-600">
            {errors.category}
          </p>
        )}
      </Field>

      <Field
        label="หมายเลขเครื่อง (ไม่บังคับ)"
        hint={
          entry.serialNumber.trim()
            ? undefined
            : 'หากไม่กรอกหมายเลขเครื่อง ระบบจะไม่สามารถเชื่อมโยงกับการเข้ารับบริการครั้งถัดไปได้'
        }
      >
        <input
          value={entry.serialNumber}
          onChange={(e) => {
            setEntry((current) => ({ ...current, serialNumber: e.target.value }));
            setConflictMessage(null);
          }}
          className={inputClass()}
        />
      </Field>

      {conflictMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {conflictMessage}
        </div>
      )}

      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-neutral-700">
          สถานะการรับประกัน
        </legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="register-product-warranty"
              value="in_warranty"
              checked={warrantyStatus === 'in_warranty'}
              onChange={() => setWarrantyStatus('in_warranty')}
            />
            อยู่ในประกัน
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="register-product-warranty"
              value="out_of_warranty"
              checked={warrantyStatus === 'out_of_warranty'}
              onChange={() => setWarrantyStatus('out_of_warranty')}
            />
            หมดประกัน
          </label>
        </div>
        <p className="mt-1.5 text-xs text-neutral-400">
          กรุณาตรวจสอบสถานะการรับประกันจริงของเครื่องก่อนดำเนินการต่อ
        </p>
        {errors.warrantyStatus && (
          <p role="alert" className="mt-1.5 text-xs text-danger-600">
            {errors.warrantyStatus}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row">
        <PrimaryButton onClick={handleConfirm} className="w-full sm:w-auto">
          ยืนยันสินค้า
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} className="w-full sm:w-auto">
          ยกเลิก
        </SecondaryButton>
      </div>
    </FormSection>
  );
}
