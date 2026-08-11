export function inputClass(extra = ''): string {
  return `w-full rounded-2xl bg-white/80 px-4 py-3.5 text-base text-ink ring-1 ring-black/10 transition-all duration-200 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400 ${extra}`;
}
