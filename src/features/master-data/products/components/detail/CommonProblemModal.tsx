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

// Serves both "Add Problem" (no `existing`) and "Edit" (pre-filled from
// `existing`) — one modal, one validation path, instead of two near-
// identical forms.
export function CommonProblemModal({
  existing,
  onClose,
  onSave,
}: {
  existing?: CommonProblemDefinition;
  onClose: () => void;
  onSave: (input: NewCommonProblemInput) => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [status, setStatus] = useState<CommonProblemStatus>(existing?.status ?? 'Active');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
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

    onSave(input);
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
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Rice Burns"
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
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="รายละเอียดเพิ่มเติมสำหรับเจ้าหน้าที่…"
            className={inputClass()}
          />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <SecondaryButton onClick={onClose}>ยกเลิก</SecondaryButton>
          <PrimaryButton onClick={handleSubmit}>
            {existing ? 'บันทึกการเปลี่ยนแปลง' : 'เพิ่มปัญหา'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
