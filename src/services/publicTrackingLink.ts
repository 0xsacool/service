import { ROUTES } from '../constants';

// F5d-69G — the single construction point for a credentialed public tracking
// URL, shared by the staff issuance control and the Service Request print
// document so the two can never drift into different link shapes.
//
// The credential is carried in the URL FRAGMENT, deliberately: a fragment is
// never sent to any server, so the bearer secret stays out of ordinary
// request logs, proxy logs, and Referer headers. This matches exactly what
// capturePublicTrackingCredential() already parses on the receiving end
// (src/features/tracking/publicTrackingFragment.ts) — do not move the
// credential into a query parameter.
export function buildPublicTrackingUrl(
  origin: string,
  serviceJobId: string,
  code: string
): string {
  return `${origin}${ROUTES.track(serviceJobId)}#${code}`;
}
