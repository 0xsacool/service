import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ListChecks,
  PlusCircle,
  Package,
  FileText,
  Search,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { RuntimeModeIndicator } from '../components/RuntimeModeIndicator';
import { APP_NAME, ROUTES } from '../../constants';
import { useAuthSession } from '../../auth/authSessionContext';
import { getBrandDisplayLabel } from '../../types';
import {
  drawerAccessibilityReducer,
  INITIAL_DRAWER_ACCESSIBILITY_STATE,
  STAFF_DESKTOP_MEDIA_QUERY,
} from './drawerAccessibility';

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const nav: NavItem[] = [
  { to: ROUTES.dashboard, label: 'ภาพรวม', icon: LayoutDashboard },
  { to: ROUTES.serviceJobs, label: 'งานบริการทั้งหมด', icon: ListChecks },
  { to: ROUTES.newServiceJob, label: 'สร้างงานบริการ', icon: PlusCircle },
];

// A second, labeled group rather than a flat list — Master Data is going to
// grow (Customers, Brands, Accessories, Common Problems, Warranty per the
// Sprint P3 Future Vision); adding the next tab is one more entry here, not
// a layout change.
const masterDataNav: NavItem[] = [
  { to: ROUTES.masterDataProducts, label: 'สินค้า', icon: Package },
];

export function StaffShell({
  search,
  setSearch,
  children,
}: {
  search: string;
  setSearch: (s: string) => void;
  children: ReactNode;
}) {
  const [drawerState, dispatchDrawer] = useReducer(
    drawerAccessibilityReducer,
    INITIAL_DRAWER_ACCESSIBILITY_STATE
  );
  const mobileOpen = drawerState.mobileOpen;
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const previousDrawerPathname = useRef(location.pathname);
  const { signOut, staffProfile, user } = useAuthSession();
  const isDetail =
    location.pathname.startsWith(`${ROUTES.serviceJobs}/`) &&
    location.pathname !== ROUTES.newServiceJob;
  const isProductDetail =
    location.pathname.startsWith(`${ROUTES.masterDataProducts}/`) &&
    location.pathname !== ROUTES.masterDataProducts;
  const searchConfig =
    location.pathname === ROUTES.serviceJobs
      ? {
          label: 'ค้นหางานบริการ',
          placeholder: 'ค้นหางานบริการ ลูกค้า สินค้า หรืออาการ…',
        }
      : location.pathname === ROUTES.masterDataProducts
        ? {
            label: 'ค้นหาข้อมูลสินค้า',
            placeholder: 'ค้นหาสินค้า แบรนด์ รุ่น หรือ SKU…',
          }
        : null;
  const routeLabel = isDetail
    ? 'รายละเอียดงานบริการ'
    : isProductDetail
      ? 'รายละเอียดสินค้า'
      : location.pathname === ROUTES.newServiceJob
        ? 'สร้างงานบริการ'
        : location.pathname === ROUTES.dashboard
          ? 'ภาพรวม'
          : 'ระบบเจ้าหน้าที่';
  const brandLabel = staffProfile ? getBrandDisplayLabel(staffProfile.brandId) : null;

  const dismissMobileDrawer = useCallback(() => {
    dispatchDrawer({ type: 'dismiss' });
  }, []);

  const handleDrawerNavigation = (targetPathname: string) => {
    dispatchDrawer({
      type: 'navigate',
      currentPathname: location.pathname,
      targetPathname,
    });
  };

  useEffect(() => {
    if (mobileOpen) return;
    const destination = drawerState.pendingFocus;
    if (!destination) return;

    if (destination === 'opener') {
      menuButtonRef.current?.focus();
    } else if (destination === 'main') {
      mainRef.current?.focus({ preventScroll: true });
    }
    dispatchDrawer({ type: 'focus-applied' });
  }, [drawerState.pendingFocus, mobileOpen]);

  useEffect(() => {
    const desktopMedia = window.matchMedia(STAFF_DESKTOP_MEDIA_QUERY);
    const onDesktopChange = (event: MediaQueryListEvent) => {
      dispatchDrawer({
        type: 'desktop-media-change',
        desktopMatches: event.matches,
      });
    };

    desktopMedia.addEventListener('change', onDesktopChange);
    return () => desktopMedia.removeEventListener('change', onDesktopChange);
  }, []);

  useEffect(() => {
    const routeChanged = previousDrawerPathname.current !== location.pathname;
    previousDrawerPathname.current = location.pathname;
    if (routeChanged) dispatchDrawer({ type: 'route-change' });
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const drawer = drawerRef.current;
    if (!drawer) return;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0
      );

    const animationFrame = window.requestAnimationFrame(() => {
      drawer.querySelector<HTMLElement>('[data-drawer-initial-focus]')?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissMobileDrawer();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dismissMobileDrawer, mobileOpen]);

  const signOutAndReturnHome = async (): Promise<void> => {
    if (mobileOpen) dispatchDrawer({ type: 'route-change' });
    await signOut();
    navigate(ROUTES.home);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <Logo size="md" />
        <div>
          <p className="font-semibold leading-tight tracking-tight text-ink">
            {APP_NAME}
          </p>
          <p className="text-xs text-neutral-400">ระบบเจ้าหน้าที่</p>
          {brandLabel ? (
            <p className="mt-1 text-xs font-medium text-brand-700">{brandLabel}</p>
          ) : null}
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3" aria-label="เมนูหลักสำหรับเจ้าหน้าที่">
        {nav.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            data-drawer-initial-focus={index === 0 ? true : undefined}
            onClick={() => {
              if (mobileOpen) handleDrawerNavigation(item.to);
            }}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-base font-medium transition-all ${
                isActive
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                  : 'text-neutral-600 hover:bg-neutral-100/70'
              }`
            }
          >
            <item.icon className="h-5 w-5" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}

        <p className="px-3.5 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-neutral-400">
          ข้อมูลหลัก
        </p>
        {masterDataNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            onClick={() => {
              if (mobileOpen) handleDrawerNavigation(item.to);
            }}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-base font-medium transition-all ${
                isActive
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                  : 'text-neutral-600 hover:bg-neutral-100/70'
              }`
            }
          >
            <item.icon className="h-5 w-5" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-4">
        <div className="rounded-2xl bg-white/60 p-3 ring-1 ring-black/5 backdrop-blur">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {user?.email ?? 'เซสชันเจ้าหน้าที่'}
              </p>
              <p className="truncate text-xs text-neutral-400">สิทธิ์เจ้าหน้าที่</p>
            </div>
            <button
              onClick={() => void signOutAndReturnHome()}
              className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="staff-shell min-h-screen bg-canvas">
      <div data-drawer-background inert={mobileOpen ? true : undefined}>
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-[60] rounded-full bg-white px-4 py-2 font-medium text-brand-700 shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          ข้ามไปยังเนื้อหาหลัก
        </a>
        {/* Desktop sidebar */}
        <aside className="staff-shell__sidebar fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-black/5 bg-white/60 backdrop-blur-xl lg:block">
          {sidebar}
        </aside>

        {/* Main */}
        <div className="staff-shell__main lg:pl-64">
          {/* Top bar */}
          <header className="staff-shell__topbar sticky top-0 z-20 border-b border-black/5 bg-canvas/80 backdrop-blur-xl">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button
                ref={menuButtonRef}
                onClick={() => dispatchDrawer({ type: 'open' })}
                className="rounded-full p-2 text-neutral-600 hover:bg-neutral-100 lg:hidden"
                aria-label="เปิดเมนู"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="flex flex-1 items-center gap-2">
                {searchConfig ? (
                  <div className="relative w-full max-w-md">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={searchConfig.placeholder}
                      aria-label={searchConfig.label}
                      className="w-full rounded-full bg-white/80 py-2.5 pl-10 pr-4 text-sm text-ink ring-1 ring-black/5 backdrop-blur placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-neutral-400">
                    <FileText className="h-4 w-4" />
                    <span>{routeLabel}</span>
                  </div>
                )}
              </div>

              <RuntimeModeIndicator />
            </div>
          </header>

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            className="staff-shell__content px-4 py-6 sm:px-6 sm:py-8 focus:outline-none"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={dismissMobileDrawer}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"
            className="absolute inset-y-0 left-0 w-72 bg-white/90 shadow-xl backdrop-blur-xl animate-[rise_0.3s_ease_both]"
          >
            {sidebar}
            <button
              className="fixed right-4 top-4 z-50 rounded-full bg-white p-2 shadow-lg lg:hidden"
              onClick={dismissMobileDrawer}
              aria-label="ปิดเมนู"
            >
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
