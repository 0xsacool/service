import { ROUTES } from '../constants';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export function scheduleCancellableAnimationFrame(
  callback: FrameRequestCallback,
  requestFrame: RequestFrame = (nextCallback) =>
    window.requestAnimationFrame(nextCallback),
  cancelFrame: CancelFrame = (handle) => window.cancelAnimationFrame(handle)
): () => void {
  const animationFrame = requestFrame(callback);
  return () => cancelFrame(animationFrame);
}

export function shouldFocusMainAfterRouteChange(
  previousPathname: string | null,
  nextPathname: string
): boolean {
  return (
    previousPathname !== null &&
    previousPathname !== nextPathname &&
    nextPathname !== ROUTES.newServiceJob
  );
}
