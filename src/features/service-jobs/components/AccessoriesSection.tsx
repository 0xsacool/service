import { PackageCheck } from 'lucide-react';
import { FormSection } from '../../../shared/components';
import { ACCESSORY_CHIPS } from '../../../constants';
import { ChipToggleGroup } from './ChipToggleGroup';

export function AccessoriesSection({
  accessories,
  onChange,
}: {
  accessories: string[];
  onChange: (accessories: string[]) => void;
}) {
  return (
    <FormSection
      icon={PackageCheck}
      title="อุปกรณ์ที่นำมาด้วย"
      subtitle="ลูกค้านำอุปกรณ์ใดมาพร้อมสินค้า"
      headingId="service-job-accessories-heading"
    >
      <ChipToggleGroup
        options={ACCESSORY_CHIPS}
        selected={accessories}
        onChange={onChange}
        ariaLabelledBy="service-job-accessories-heading"
      />
    </FormSection>
  );
}
