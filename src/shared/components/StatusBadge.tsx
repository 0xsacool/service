import type { ServiceJobStatus } from '../../types';
import { statusColor, statusLabel } from '../../services/serviceJobPresentation';

export function StatusBadge({
  status,
  size = 'md',
  label,
}: {
  status: ServiceJobStatus;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const c = statusColor(status);
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${c.text} ${c.bg} ring-1 ${c.ring} ${pad}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label ?? statusLabel(status)}
    </span>
  );
}
