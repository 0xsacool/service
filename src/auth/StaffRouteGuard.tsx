import { Navigate, Outlet } from 'react-router-dom';
import { useAuthSession } from './authSessionContext';

export function StaffRouteGuard() {
  const session = useAuthSession();
  if (session.status === 'mock' || session.status === 'authorized') {
    return <Outlet />;
  }
  if (session.status === 'loading' || session.status === 'profile-loading') {
    return <p className="p-6 text-sm text-neutral-500">กำลังตรวจสอบสิทธิ์เจ้าหน้าที่…</p>;
  }
  if (session.status === 'signed-out') {
    return <Navigate to="/login" replace />;
  }
  if (session.status === 'denied') {
    return <p className="p-6 text-sm text-red-600">{session.error}</p>;
  }
  return <p className="p-6 text-sm text-red-600">{session.error}</p>;
}
