import {
  isValidPublicTrackingCode,
  normalizePublicTrackingCodeInput,
} from '../../services/publicTrackingCode';

const SAFE_PUBLIC_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type PublicTrackingCredential =
  { kind: 'legacy-token'; value: string } | { kind: 'manual-code'; value: string };

export interface BrowserLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface BrowserHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function capturePublicTrackingCredential(
  location: BrowserLocation,
  history: BrowserHistory
): PublicTrackingCredential | null {
  const rawFragment = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const sanitizedSearch = new URLSearchParams(location.search);
  const hadQueryCredential = sanitizedSearch.has('token') || sanitizedSearch.has('code');
  sanitizedSearch.delete('token');
  sanitizedSearch.delete('code');
  const sanitizedUrl = `${location.pathname}${
    sanitizedSearch.size > 0 ? `?${sanitizedSearch.toString()}` : ''
  }`;

  if (location.hash || hadQueryCredential) {
    history.replaceState(history.state, '', sanitizedUrl);
  }

  if (SAFE_PUBLIC_TOKEN.test(rawFragment)) {
    return { kind: 'legacy-token', value: rawFragment };
  }
  const code = normalizePublicTrackingCodeInput(rawFragment);
  return code && isValidPublicTrackingCode(code)
    ? { kind: 'manual-code', value: code }
    : null;
}

export function capturePublicTrackingToken(
  location: BrowserLocation,
  history: BrowserHistory
): string | null {
  const credential = capturePublicTrackingCredential(location, history);
  return credential?.kind === 'legacy-token' ? credential.value : null;
}
