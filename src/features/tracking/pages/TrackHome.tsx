import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link, Clock, MapPin, ShieldCheck } from 'lucide-react';
import { GlassCard, Logo } from '../../../shared/components';
import { APP_NAME, ROUTES } from '../../../constants';
import { PublicTrackingLanguageSelector } from '../components/PublicTrackingLanguageSelector';
import { usePublicTrackingLocale } from '../usePublicTrackingLocale';
import { normalizePublicTrackingCodeInput } from '../../../services/publicTrackingCode';

export function TrackHome() {
  const navigate = useNavigate();
  const { locale, messages, setLocale } = usePublicTrackingLocale();
  const [code, setCode] = useState('');
  const [hasInvalidCode, setHasInvalidCode] = useState(false);

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizePublicTrackingCodeInput(code);
    if (!normalized) {
      setHasInvalidCode(true);
      return;
    }
    setHasInvalidCode(false);
    navigate({ pathname: ROUTES.trackLookup, hash: `#${normalized}` });
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-200/50 to-cyan-100/40 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tl from-amber-100/40 to-brand-100/30 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Logo size="md" />
          <span className="text-lg font-semibold tracking-tight text-ink">
            {APP_NAME}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PublicTrackingLanguageSelector
            locale={locale}
            label={messages.languageSelectorLabel}
            options={messages.languageOptions}
            onChange={setLocale}
          />
          <button
            type="button"
            onClick={() => navigate(ROUTES.login)}
            className="rounded-full px-4 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
          >
            {messages.staffSignIn}
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-16 text-center sm:pt-24">
        <div className="animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-black/5 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {messages.landing.eyebrow}
          </span>
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-6xl">
            {messages.landing.title}
            <br />
            <span className="bg-gradient-to-r from-brand-600 to-cyan-600 bg-clip-text text-transparent">
              {messages.landing.titleAccent}
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-lg text-neutral-500 sm:text-xl">
            {messages.landing.description}
          </p>
        </div>

        <GlassCard className="mt-10 w-full max-w-xl animate-[rise_0.6s_cubic-bezier(0.22,1,0.36,1)_both] p-6 text-left">
          <div className="flex gap-3">
            <Link className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <h2 className="font-semibold text-ink">{messages.landing.manualTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-neutral-500">
                {messages.landing.manualHelp}
              </p>
              <form onSubmit={submitCode} className="mt-5 space-y-3">
                <label
                  htmlFor="public-tracking-code"
                  className="block text-sm font-medium text-ink"
                >
                  {messages.landing.manualLabel}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="public-tracking-code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      setHasInvalidCode(false);
                    }}
                    placeholder={messages.landing.manualPlaceholder}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    inputMode="text"
                    className="min-w-0 flex-1 rounded-2xl bg-white/80 px-4 py-3 text-sm font-medium tracking-wide text-ink ring-1 ring-black/10 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
                    aria-invalid={hasInvalidCode}
                    aria-describedby="public-tracking-code-help"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    {messages.landing.manualSubmit}
                  </button>
                </div>
                <p id="public-tracking-code-help" className="text-xs text-neutral-500">
                  {messages.landing.manualPrivate}
                </p>
                {hasInvalidCode ? (
                  <p role="alert" className="text-sm text-danger-600">
                    {messages.landing.manualInvalid}
                  </p>
                ) : null}
              </form>
              <p className="mt-4 text-xs text-neutral-400">
                {messages.landing.secureDescription}
              </p>
            </div>
          </div>
        </GlassCard>

        <div className="stagger mt-20 grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
          {[Clock, ShieldCheck, MapPin].map((Icon, index) => {
            const feature = messages.landing.features[index];
            return (
              <GlassCard key={feature.title} className="p-5 text-left">
                <Icon className="mb-3 h-6 w-6 text-brand-500" strokeWidth={2} />
                <p className="font-medium text-ink">{feature.title}</p>
                <p className="mt-0.5 text-sm text-neutral-500">{feature.text}</p>
              </GlassCard>
            );
          })}
        </div>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-8 text-center text-sm text-neutral-400">
        {messages.landing.footer}
      </footer>
    </div>
  );
}
