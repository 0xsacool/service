import { useEffect, useState } from 'react';
import { getPublicTrackingGateway, type PublicTrackingLookup } from './publicTracking';
import { capturePublicTrackingCredential } from './publicTrackingFragment';

export function usePublicTracking(
  trackingReference: string | undefined
): PublicTrackingLookup | null {
  const [credential] = useState(() =>
    typeof window === 'undefined'
      ? null
      : capturePublicTrackingCredential(window.location, window.history)
  );
  const [result, setResult] = useState<PublicTrackingLookup | null>(null);

  useEffect(() => {
    let active = true;
    if (!credential || (credential.kind === 'legacy-token' && !trackingReference)) {
      return;
    }
    const gateway = getPublicTrackingGateway();
    const lookup =
      credential.kind === 'manual-code'
        ? gateway.lookupByCode(credential.value)
        : gateway.lookup(trackingReference ?? '', credential.value);
    void lookup.then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [trackingReference, credential]);

  return credential && (credential.kind === 'manual-code' || trackingReference)
    ? result
    : { kind: 'unavailable' };
}
