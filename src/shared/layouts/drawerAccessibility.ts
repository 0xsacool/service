export const STAFF_DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

export type DrawerFocusDestination = 'opener' | 'main' | 'route';

export type DrawerAccessibilityState = Readonly<{
  mobileOpen: boolean;
  pendingFocus: DrawerFocusDestination | null;
}>;

export type DrawerAccessibilityEvent =
  | { type: 'open' }
  | { type: 'dismiss' }
  | {
      type: 'navigate';
      currentPathname: string;
      targetPathname: string;
    }
  | { type: 'desktop-media-change'; desktopMatches: boolean }
  | { type: 'route-change' }
  | { type: 'focus-applied' };

export const INITIAL_DRAWER_ACCESSIBILITY_STATE: DrawerAccessibilityState = {
  mobileOpen: false,
  pendingFocus: null,
};

export function drawerNavigationFocusDestination(
  currentPathname: string,
  targetPathname: string
): DrawerFocusDestination {
  return currentPathname === targetPathname ? 'main' : 'route';
}

export function shouldCloseDrawerAtDesktop(
  drawerOpen: boolean,
  desktopMatches: boolean
): boolean {
  return drawerOpen && desktopMatches;
}

export function drawerAccessibilityReducer(
  state: DrawerAccessibilityState,
  event: DrawerAccessibilityEvent
): DrawerAccessibilityState {
  switch (event.type) {
    case 'open':
      return { mobileOpen: true, pendingFocus: null };
    case 'dismiss':
      return { mobileOpen: false, pendingFocus: 'opener' };
    case 'navigate':
      return {
        mobileOpen: false,
        pendingFocus: drawerNavigationFocusDestination(
          event.currentPathname,
          event.targetPathname
        ),
      };
    case 'desktop-media-change':
      return shouldCloseDrawerAtDesktop(state.mobileOpen, event.desktopMatches)
        ? { mobileOpen: false, pendingFocus: 'main' }
        : state;
    case 'route-change':
      return state.mobileOpen ? { mobileOpen: false, pendingFocus: 'route' } : state;
    case 'focus-applied':
      return state.pendingFocus === null ? state : { ...state, pendingFocus: null };
  }
}
