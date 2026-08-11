import type { Priority } from '../../types';
import { priorityColor, priorityLabel } from '../../services/serviceJobPresentation';

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${priorityColor(
        priority
      )}`}
    >
      {priorityLabel(priority)}
    </span>
  );
}
