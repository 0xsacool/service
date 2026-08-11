import { AlertTriangle } from 'lucide-react';
import { FormSection, inputClass } from '../../../shared/components';
import { PROBLEM_CHIPS } from '../../../constants';
import { ChipToggleGroup } from './ChipToggleGroup';

// Free text and chips are independent fields on ServiceIntakeData —
// selecting a chip never touches problemDescription, and typing never
// touches problemChips. Both feed into isServiceIntakeComplete separately.
export function ProblemSection({
  description,
  chips,
  onDescriptionChange,
  onChipsChange,
}: {
  description: string;
  chips: string[];
  onDescriptionChange: (description: string) => void;
  onChipsChange: (chips: string[]) => void;
}) {
  return (
    <FormSection icon={AlertTriangle} title="อาการปัญหา" subtitle="สินค้าเกิดปัญหาอะไร">
      <textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        rows={4}
        placeholder="บันทึกอาการที่ลูกค้าแจ้ง…"
        className={inputClass('resize-none')}
      />
      <ChipToggleGroup
        options={PROBLEM_CHIPS}
        selected={chips}
        onChange={onChipsChange}
      />
    </FormSection>
  );
}
