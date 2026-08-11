import {
  PUBLIC_TRACKING_LOCALES,
  type PublicTrackingLocale,
} from '../publicTrackingLocale';

export function PublicTrackingLanguageSelector({
  locale,
  label,
  options,
  onChange,
}: {
  locale: PublicTrackingLocale;
  label: string;
  options: Record<PublicTrackingLocale, string>;
  onChange: (locale: PublicTrackingLocale) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => onChange(event.target.value as PublicTrackingLocale)}
        className="rounded-full bg-white/80 px-3 py-2 text-sm font-medium text-neutral-700 ring-1 ring-black/5 backdrop-blur focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        {PUBLIC_TRACKING_LOCALES.map((option) => (
          <option key={option} value={option}>
            {options[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
