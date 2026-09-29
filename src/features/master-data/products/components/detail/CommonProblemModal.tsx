import { useState } from 'react';
import type { CommonProblemDefinition, CommonProblemStatus } from '../../../../../types';
import type { NewCommonProblemInput } from '../../../../../services/productKnowledgeAdmin';
import { validateNewCommonProblemInput } from '../../../../../validation';
import {
  Modal,
  Field,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from '../../../../../shared/components';

const STATUS_OPTIONS: CommonProblemStatus[] = ['Active', 'Inactive'];

export function CommonProblemModal({
  existing,
  onClose,
  onSave,
}: {
  existing?: CommonProblemDefinition;
  onClose: () => void;
  onSave: (input: NewCommonProblemInput) => Promise<void>;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [status, setStatus] = useState<CommonProblemStatus>(existing?.status ?? 'Active');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (pending) return;
    const input: NewCommonProblemInput = {
      label: label.trim(),
      status,
      description: description.trim() || undefined,
    };

    const result = validateNewCommonProblemInput(input);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    setErrors({});
    setSaveError(null);
    setPending(true);
    try {
      await onSave(input);
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : 'ไม่สามารถบันทึกปัญหาที่พบบ่อยได้ กรุณาลองใหม่'
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={existing ? 'แก้ไขปัญหาที่พบบ่อย' : 'เพิ่มปัญหาที่พบบ่อย'}
      onClose={onClose}
      maxWidthClassName="max-w-lg"
    >
      <div className="space-y-4">
        <Field label="ชื่อปัญหา">
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setSaveError(null);
            }}
            placeholder="เช่น เตาไม่ร้อน"
            disabled={pending}
            className={inputClass()}
          />
          {errors.label && (
            <p className="mt-1.5 text-xs text-danger-600">{errors.label}</p>
          )}
        </Field>

        <Field label="สถานะ">
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                disabled={pending}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  status === option
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
                }`}
              >
                {option === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="รายละเอียด" hint="ไม่บังคับ">
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaveError(null);
            }}
            rows={3}
            placeholder="รายละเอียดเพิ่มเติมสำหรับเจ้าหน้าที่…"
            disabled={pending}
            className={inputClass()}
          />
        </Field>

        {saveError && (
          <p
            role="alert"
            className="rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700"
          >
            {saveError}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <SecondaryButton onClick={onClose} disabled={pending}>
            ยกเลิก
          </SecondaryButton>
          <PrimaryButton onClick={() => void handleSubmit()} disabled={pending}>
            {pending
              ? 'กำลังบันทึก...'
              : existing
                ? 'บันทึกการเปลี่ยนแปลง'
                : 'เพิ่มปัญหา'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
