import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  scheduleCancellableAnimationFrame,
  shouldFocusMainAfterRouteChange,
} from './routeFocus';
import { routeDocumentTitle } from './routeTitles';

export function RouteAccessibility() {
  const location = useLocation();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    document.title = routeDocumentTitle(location.pathname);

    const shouldFocusMain = shouldFocusMainAfterRouteChange(
      previousPathname.current,
      location.pathname
    );
    previousPathname.current = location.pathname;

    if (!shouldFocusMain) return;

    return scheduleCancellableAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>('main');
      if (!main) return;
      if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
      main.focus({ preventScroll: true });
    });
  }, [location.pathname]);

  return null;
}
