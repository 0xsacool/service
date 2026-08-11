import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { PrimaryButton } from './Button';
import { ROUTES } from '../../constants';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <SearchX className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">ไม่พบหน้าเว็บ</h1>
      <p className="max-w-sm text-neutral-500">
        ไม่พบหน้าที่คุณต้องการ หรือหน้านี้อาจถูกย้ายแล้ว
      </p>
      <Link to={ROUTES.home}>
        <PrimaryButton>กลับหน้าหลัก</PrimaryButton>
      </Link>
    </div>
  );
}
