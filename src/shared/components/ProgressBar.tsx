import type { TimelineEvent } from '../../types';

export function ProgressBar({ events }: { events: TimelineEvent[] }) {
  const completed = events.filter((e) => e.done).length;
  const total = events.length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
  const progressText =
    total === 0 ? 'ยังไม่มีขั้นตอน' : `เสร็จสิ้น ${completed} จาก ${total} ขั้นตอน`;

  return (
    <>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-neutral-600">{progressText}</span>
        <span className="font-semibold text-brand-600">{progress}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-label="ความคืบหน้างานบริการ"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={progressText}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 transition-all duration-700 motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      </div>
    </>
  );
}
