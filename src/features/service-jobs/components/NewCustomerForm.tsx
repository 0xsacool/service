import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { NewCustomerDraft } from '../../../types';
import { createEmptyNewCustomerDraft } from '../../../types';
import { validateNewCustomerInput } from '../../../validation';
import {
  AsyncErrorAlert,
  Field,
  FormSection,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from '../../../shared/components';

// A query that reads as mostly digits (with common phone punctuation) is
// treated as a phone number for the initial-value guess below; anything else
// is treated as a name. This is only a starting value the staff member can
// freely edit — never a hidden decision that changes what gets submitted.
function looksLikePhone(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 0 && /^[\d\s+()-]+$/.test(trimmed);
}

// F5d-65 — the inline "no result → create new customer" step
// (BUSINESS_RULES.md "Intake Workflow"). Deliberately just three fields
// (name/phone required, email optional) — see NewCustomerDraft — and never
// persists anything on its own: confirming here only moves the draft into
// NewServiceJob's pending local state (NewCustomerSummaryCard). The only
// durable write happens later, at Save & Print, via the Worker's atomic
// Service-Job-plus-Customer transaction.
export function NewCustomerForm({
  initialQuery = '',
  onConfirm,
  onCancel,
}: {
  initialQuery?: string;
  onConfirm: (draft: NewCustomerDraft) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<NewCustomerDraft>(() => ({
    ...createEmptyNewCustomerDraft(),
    ...(looksLikePhone(initialQuery)
      ? { phone: initialQuery.trim() }
      : { name: initialQuery.trim() }),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (patch: Partial<NewCustomerDraft>) =>
    setValue((current) => ({ ...current, ...patch }));

  const handleConfirm = () => {
    const trimmed: NewCustomerDraft = {
      name: value.name.trim(),
      phone: value.phone.trim(),
      email: value.email.trim(),
    };
    const result = validateNewCustomerInput(trimmed);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onConfirm(trimmed);
  };

  return (
    <FormSection
      icon={UserPlus}
      title="สร้างลูกค้าใหม่"
      subtitle="กรอกข้อมูลลูกค้าเพื่อดำเนินการต่อ ยังไม่บันทึกจนกว่าจะกดบันทึกและพิมพ์"
      headingId="new-customer-heading"
    >
      <Field label="ชื่อลูกค้า">
        <input
          value={value.name}
          onChange={(e) => handleChange({ name: e.target.value })}
          placeholder="ชื่อ-นามสกุล"
          autoFocus
          aria-invalid={Boolean(errors.name)}
          className={inputClass()}
        />
        <AsyncErrorAlert message={errors.name ?? null} className="mt-1.5" />
      </Field>

      <Field label="เบอร์โทรศัพท์">
        <input
          value={value.phone}
          onChange={(e) => handleChange({ phone: e.target.value })}
          placeholder="0812345678"
          inputMode="tel"
          aria-invalid={Boolean(errors.phone)}
          className={inputClass()}
        />
        <AsyncErrorAlert message={errors.phone ?? null} className="mt-1.5" />
      </Field>

      <Field label="อีเมล (ไม่บังคับ)">
        <input
          value={value.email}
          onChange={(e) => handleChange({ email: e.target.value })}
          placeholder="name@example.com"
          type="email"
          aria-invalid={Boolean(errors.email)}
          className={inputClass()}
        />
        <AsyncErrorAlert message={errors.email ?? null} className="mt-1.5" />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row">
        <PrimaryButton onClick={handleConfirm} className="w-full sm:w-auto">
          ยืนยันข้อมูลลูกค้า
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} className="w-full sm:w-auto">
          ยกเลิก
        </SecondaryButton>
      </div>
    </FormSection>
  );
}
