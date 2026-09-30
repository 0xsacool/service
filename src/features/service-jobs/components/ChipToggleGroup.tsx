import type { ServiceIntakeChipOption } from '../../../constants/serviceIntake';

// Shared toggle-chip primitive for Problem and Accessories. The persisted value
// is separate from the localized display label so we can improve staff-facing
// copy without rewriting existing Service Job data.
export function ChipToggleGroup({
  options,
  selected,
  onChange,
  ariaLabelledBy,
}: {
  options: readonly ServiceIntakeChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  ariaLabelledBy: string;
}) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    );
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={ariaLabelledBy}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            aria-pressed={isSelected}
            className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              isSelected
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white/80 text-neutral-600 ring-1 ring-black/10 hover:bg-white'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
