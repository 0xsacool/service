import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../../constants';

export function LegalPageLayout({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-neutral-50 px-4 py-10 text-ink focus:outline-none sm:px-6"
    >
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-10">
        <div className="mb-8 border-b border-neutral-100 pb-6">
          <p className="text-sm font-medium text-brand-600">Service Tech</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-neutral-500">อัปเดตล่าสุด {updatedAt}</p>
        </div>

        <div className="space-y-8 text-[15px] leading-7 text-neutral-700">{children}</div>

        <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-100 pt-6 text-sm">
          <Link className="font-medium text-brand-600 hover:underline" to={ROUTES.login}>
            เข้าสู่ระบบ Service Tech
          </Link>
          <Link
            className="font-medium text-brand-600 hover:underline"
            to={ROUTES.privacy}
          >
            นโยบายความเป็นส่วนตัว
          </Link>
          <Link className="font-medium text-brand-600 hover:underline" to={ROUTES.terms}>
            ข้อกำหนดการใช้งาน
          </Link>
        </nav>
      </article>
    </main>
  );
}
