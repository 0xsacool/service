import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  Package,
  SearchX,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  Logo,
  PrimaryButton,
  StatusBadge,
} from '../../../shared/components';
import { APP_NAME, ROUTES } from '../../../constants';
import { usePublicTracking } from '../usePublicTracking';
import type { PublicTrackingTimelineEvent } from '../publicTracking';
import {
  formatPublicDate,
  type PublicTrackingMessages,
  type PublicTrackingLocale,
} from '../publicTrackingLocale';
import { usePublicTrackingLocale } from '../usePublicTrackingLocale';
import { PublicTrackingLanguageSelector } from '../components/PublicTrackingLanguageSelector';

export function TrackResult() {
  const { trackingNumber } = useParams<{ trackingNumber: string }>();
  const navigate = useNavigate();
  const result = usePublicTracking(trackingNumber);
  const { locale, messages, setLocale } = usePublicTrackingLocale();

  if (!result) {
    return (
      <TrackShell locale={locale} messages={messages} onLocaleChange={setLocale}>
        <p className="p-6 text-sm text-neutral-500">{messages.result.loading}</p>
      </TrackShell>
    );
  }

  if (result.kind === 'unavailable') {
    return (
      <TrackShell locale={locale} messages={messages} onLocaleChange={setLocale}>
        <EmptyState
          icon={SearchX}
          title={messages.result.unavailableTitle}
          description={messages.result.unavailableDescription}
          action={
            <PrimaryButton onClick={() => navigate(ROUTES.home)}>
              {messages.result.backToSearch}
            </PrimaryButton>
          }
        />
      </TrackShell>
    );
  }

  return (
    <TrackShell locale={locale} messages={messages} onLocaleChange={setLocale}>
      <GlassCard className="mx-auto max-w-xl p-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {messages.result.trackingReference}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          {result.record.trackingReference}
        </h1>
        <div className="mt-5 flex justify-center">
          <StatusBadge
            status={result.record.status}
            label={messages.statusLabels[result.record.status]}
          />
        </div>
      </GlassCard>
      <div className="mx-auto mt-6 grid max-w-xl gap-6 text-left">
        <GlassCard className="p-6">
          <h2 className="font-semibold text-ink">{messages.result.product}</h2>
          <div className="mt-4 space-y-3 text-sm">
            <PublicRow
              icon={Package}
              label={messages.result.product}
              value={result.record.productName}
            />
            {result.record.productModelOrSku ? (
              <PublicRow
                icon={Tag}
                label={messages.result.modelOrSku}
                value={result.record.productModelOrSku}
              />
            ) : null}
            {result.record.maskedSerial ? (
              <PublicRow
                icon={Tag}
                label={messages.result.serial}
                value={result.record.maskedSerial}
              />
            ) : null}
            {result.record.lastUpdatedAt ? (
              <PublicRow
                icon={CalendarClock}
                label={messages.result.lastUpdated}
                value={formatPublicDate(result.record.lastUpdatedAt, locale)}
              />
            ) : null}
          </div>
        </GlassCard>
        <GlassCard className="p-6">
          <h2 className="font-semibold text-ink">{messages.result.statusUpdates}</h2>
          <PublicTimeline
            events={result.record.publicTimeline}
            locale={locale}
            statusLabels={messages.statusLabels}
            emptyLabel={messages.result.currentStatusShown}
          />
        </GlassCard>
      </div>
    </TrackShell>
  );
}

function PublicRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {label}
        </p>
        <p className="mt-0.5 text-neutral-700">{value}</p>
      </div>
    </div>
  );
}

function PublicTimeline({
  events,
  locale,
  statusLabels,
  emptyLabel,
}: {
  events: PublicTrackingTimelineEvent[];
  locale: PublicTrackingLocale;
  statusLabels: Record<PublicTrackingTimelineEvent['status'], string>;
  emptyLabel: string;
}) {
  if (events.length === 0) {
    return <p className="mt-3 text-sm text-neutral-500">{emptyLabel}</p>;
  }
  return (
    <ol className="mt-4 space-y-4">
      {events.map((event) => (
        <li
          key={`${event.status}-${event.occurredAt}`}
          className="flex items-start gap-3"
        >
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
          <div>
            <p className="font-medium text-ink">{statusLabels[event.status]}</p>
            <p className="mt-0.5 text-sm text-neutral-500">
              {formatPublicDate(event.occurredAt, locale)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TrackShell({
  children,
  locale,
  messages,
  onLocaleChange,
}: {
  children: React.ReactNode;
  locale: PublicTrackingLocale;
  messages: PublicTrackingMessages;
  onLocaleChange: (locale: PublicTrackingLocale) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-black/5 px-6 py-4">
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="flex items-center gap-2 text-sm font-medium text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" />
          {messages.result.backToTracking}
        </button>
        <div className="flex items-center gap-3">
          <PublicTrackingLanguageSelector
            locale={locale}
            label={messages.languageSelectorLabel}
            options={messages.languageOptions}
            onChange={onLocaleChange}
          />
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="text-sm font-semibold text-ink">{APP_NAME}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col px-6 py-20 text-center">
        {children}
      </main>
    </div>
  );
}
