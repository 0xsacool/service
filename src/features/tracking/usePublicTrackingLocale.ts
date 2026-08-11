import { useState } from 'react';
import {
  getPublicTrackingMessages,
  persistPublicTrackingLocale,
  readPublicTrackingLocale,
  type PublicTrackingLocale,
} from './publicTrackingLocale';

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function usePublicTrackingLocale(): {
  locale: PublicTrackingLocale;
  messages: ReturnType<typeof getPublicTrackingMessages>;
  setLocale: (locale: PublicTrackingLocale) => void;
} {
  const [locale, setLocaleState] = useState<PublicTrackingLocale>(() =>
    readPublicTrackingLocale(getBrowserStorage())
  );

  const setLocale = (nextLocale: PublicTrackingLocale) => {
    setLocaleState(nextLocale);
    persistPublicTrackingLocale(nextLocale, getBrowserStorage());
  };

  return { locale, messages: getPublicTrackingMessages(locale), setLocale };
}
