import { FileText } from 'lucide-react';
import { FormSection, inputClass } from '../../../shared/components';

export function InternalNotesSection({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (notes: string) => void;
}) {
  return (
    <FormSection icon={FileText} title="หมายเหตุภายใน" subtitle="เห็นเฉพาะเจ้าหน้าที่">
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="ข้อมูลที่ช่างควรทราบ…"
        className={inputClass('resize-none')}
      />
    </FormSection>
  );
}
