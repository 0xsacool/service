import { PackageCheck } from 'lucide-react';
import { FormSection, inputClass } from '../../../shared/components';
import {
  ACCESSORY_CHIPS,
  getOtherAccessoryText,
  isOtherAccessorySelection,
  OTHER_ACCESSORY_PREFIX,
  OTHER_ACCESSORY_VALUE,
} from '../../../constants/serviceIntake';
import { ChipToggleGroup } from './ChipToggleGroup';

const STANDARD_ACCESSORY_CHIPS = ACCESSORY_CHIPS.filter(
  (option) => option.value !== OTHER_ACCESSORY_VALUE
);
const OTHER_ACCESSORY_OPTION = ACCESSORY_CHIPS.find(
  (option) => option.value === OTHER_ACCESSORY_VALUE
)!;

export function AccessoriesSection({
  accessories,
  onChange,
}: {
  accessories: string[];
  onChange: (accessories: string[]) => void;
}) {
  const otherSelected = accessories.some(isOtherAccessorySelection);
  const otherText = getOtherAccessoryText(accessories);

  const toggleOther = () => {
    if (otherSelected) {
      onChange(accessories.filter((value) => !isOtherAccessorySelection(value)));
      return;
    }
    onChange([...accessories, OTHER_ACCESSORY_VALUE]);
  };

  const updateOtherText = (value: string) => {
    const withoutOther = accessories.filter((item) => !isOtherAccessorySelection(item));
    onChange([
      ...withoutOther,
      value.length > 0 ? `${OTHER_ACCESSORY_PREFIX}${value}` : OTHER_ACCESSORY_VALUE,
    ]);
  };

  return (
    <FormSection
      icon={PackageCheck}
      title="อุปกรณ์ที่นำมาด้วย"
      subtitle="ลูกค้านำอุปกรณ์ใดมาพร้อมสินค้า"
      headingId="service-job-accessories-heading"
    >
      <ChipToggleGroup
        options={STANDARD_ACCESSORY_CHIPS}
        selected={accessories}
        onChange={onChange}
        ariaLabelledBy="service-job-accessories-heading"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleOther}
          aria-pressed={otherSelected}
          className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
            otherSelected
              ? 'bg-brand-500 text-white shadow-sm'
              : 'bg-white/80 text-neutral-600 ring-1 ring-black/10 hover:bg-white'
          }`}
        >
          {OTHER_ACCESSORY_OPTION.label}
        </button>
      </div>

      {otherSelected && (
        <div className="mt-3">
          <label
            htmlFor="service-job-other-accessory"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            ระบุอุปกรณ์อื่น ๆ
          </label>
          <input
            id="service-job-other-accessory"
            value={otherText}
            onChange={(event) => updateOtherText(event.target.value)}
            maxLength={140}
            placeholder="เช่น ตะแกรงย่าง, ถุงผ้า, อะแดปเตอร์"
            className={inputClass()}
          />
          <p className="mt-1.5 text-xs text-neutral-400">
            พิมพ์รายการอุปกรณ์ที่ไม่อยู่ในตัวเลือกด้านบน
          </p>
        </div>
      )}
    </FormSection>
  );
}
