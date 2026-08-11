import type { TimelineEvent } from '../../types';

export function ProgressBar({ events }: { events: TimelineEvent[] }) {
  const completed = events.filter((e) => e.done).length;
  const total = events.length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-neutral-600">
          เสร็จสิ้น {completed} จาก {total} ขั้นตอน
        </span>
        <span className="font-semibold text-brand-600">{progress}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}
