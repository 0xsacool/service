// Shared toggle-chip primitive for Problem and Accessories (identical
// visual/interaction contract in both). Feature-scoped rather than in
// shared/components/ since both current consumers are within the
// service-jobs intake flow — promote it if a screen outside this feature
// ever needs the same pattern.
export function ChipToggleGroup({
  options,
  selected,
  onChange,
  ariaLabelledBy,
}: {
  options: readonly string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  ariaLabelledBy: string;
}) {
  const toggle = (option: string) => {
    onChange(
      selected.includes(option)
        ? selected.filter((o) => o !== option)
        : [...selected, option]
    );
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={ariaLabelledBy}>
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={isSelected}
            className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              isSelected
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white/80 text-neutral-600 ring-1 ring-black/10 hover:bg-white'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
