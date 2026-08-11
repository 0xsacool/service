import { Check, Circle } from 'lucide-react';
import type { TimelineEvent } from '../../types';
import { formatDate } from '../../utils/formatDate';
import {
  timelineDescription,
  timelineTitle,
} from '../../services/serviceJobPresentation';

export function Timeline({
  events,
  showCurrentBadge = false,
  currentLabel = 'ปัจจุบัน',
}: {
  events: TimelineEvent[];
  showCurrentBadge?: boolean;
  currentLabel?: string;
}) {
  return (
    <ol className="relative">
      {events.map((ev, i) => {
        const isLast = i === events.length - 1;
        return (
          <li key={i} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
                  ev.current
                    ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30 ring-4 ring-brand-100'
                    : ev.done
                      ? 'bg-success-500 text-white'
                      : 'bg-neutral-100 text-neutral-400 ring-1 ring-black/5'
                }`}
              >
                {ev.current ? (
                  <Circle className="h-3.5 w-3.5 fill-current" />
                ) : ev.done ? (
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
              </div>
              {!isLast && (
                <div
                  className={`my-1 w-0.5 flex-1 ${ev.done ? 'bg-success-300' : 'bg-neutral-200'}`}
                  style={{ minHeight: '2.5rem' }}
                />
              )}
            </div>
            <div className={`flex-1 ${isLast ? 'pb-0' : 'pb-8'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={`font-semibold ${ev.current ? 'text-brand-700' : 'text-ink'}`}
                >
                  {timelineTitle(ev.title)}
                </p>
                {showCurrentBadge && ev.current && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 ring-1 ring-brand-200">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                    {currentLabel}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-neutral-500">
                {timelineDescription(ev.title, ev.description)}
              </p>
              {ev.date !== '—' && (
                <p className="mt-1 text-xs font-medium text-neutral-400">
                  {formatDate(ev.date)} · {ev.time}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
