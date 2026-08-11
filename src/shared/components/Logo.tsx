import { ShieldCheck } from 'lucide-react';

const sizes = {
  sm: { box: 'h-8 w-8', icon: 'h-4 w-4', radius: 'rounded-2xl', shadow: 'shadow-sm' },
  md: { box: 'h-9 w-9', icon: 'h-5 w-5', radius: 'rounded-2xl', shadow: 'shadow-sm' },
  lg: {
    box: 'h-14 w-14',
    icon: 'h-7 w-7',
    radius: 'rounded-3xl',
    shadow: 'shadow-lg shadow-brand-500/30',
  },
} as const;

export function Logo({
  size = 'md',
  className = '',
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  const s = sizes[size];
  return (
    <div
      className={`flex ${s.box} items-center justify-center ${s.radius} bg-brand-500 text-white ${s.shadow} ${className}`}
    >
      <ShieldCheck className={s.icon} strokeWidth={2.2} />
    </div>
  );
}
