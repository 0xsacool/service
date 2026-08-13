import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ListChecks,
  PlusCircle,
  Package,
  FileText,
  Search,
  Bell,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { RuntimeModeIndicator } from '../components/RuntimeModeIndicator';
import { APP_NAME, ROUTES } from '../../constants';
import { useAuthSession } from '../../auth/authSessionContext';

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuthSession();
  const isDetail =
    location.pathname.startsWith(`${ROUTES.serviceJobs}/`) &&
    location.pathname !== ROUTES.newServiceJob;

  const signOutAndReturnHome = async (): Promise<void> => {
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
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            onClick={() => setMobileOpen(false)}
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
            onClick={() => setMobileOpen(false)}
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
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-500 text-sm font-semibold text-white">
              DO
            </div>
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
      {/* Desktop sidebar */}
      <aside className="staff-shell__sidebar fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-black/5 bg-white/60 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white/90 shadow-xl backdrop-blur-xl animate-[rise_0.3s_ease_both]">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="staff-shell__main lg:pl-64">
        {/* Top bar */}
        <header className="staff-shell__topbar sticky top-0 z-20 border-b border-black/5 bg-canvas/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-full p-2 text-neutral-600 hover:bg-neutral-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex flex-1 items-center gap-2">
              {isDetail ? (
                <div className="flex items-center gap-2 text-sm text-neutral-400">
                  <FileText className="h-4 w-4" />
                  <span>รายละเอียดงานบริการ</span>
                </div>
              ) : (
                <div className="relative w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหางานบริการ ลูกค้า หรือสินค้า…"
                    className="w-full rounded-full bg-white/80 py-2.5 pl-10 pr-4 text-sm text-ink ring-1 ring-black/5 backdrop-blur placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              )}
            </div>

            <RuntimeModeIndicator />

            <button className="relative rounded-full p-2.5 text-neutral-600 transition-colors hover:bg-neutral-100">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger-500 ring-2 ring-canvas" />
            </button>
          </div>
        </header>

        <main className="staff-shell__content px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>

      {/* Mobile close helper when drawer open */}
      {mobileOpen && (
        <button
          className="fixed right-4 top-4 z-50 rounded-full bg-white p-2 shadow-lg lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
