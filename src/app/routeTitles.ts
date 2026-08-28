import { APP_NAME, ROUTES } from '../constants';

const ROUTE_TITLES: Record<string, string> = {
  [ROUTES.home]: 'ติดตามงานบริการ',
  [ROUTES.login]: 'เข้าสู่ระบบสำหรับเจ้าหน้าที่',
  [ROUTES.dashboard]: 'ภาพรวมงานบริการ',
  [ROUTES.serviceJobs]: 'งานบริการทั้งหมด',
  [ROUTES.newServiceJob]: 'สร้างงานบริการใหม่',
  [ROUTES.masterDataProducts]: 'ข้อมูลหลักสินค้า',
  [ROUTES.approvalConsole]: 'ศูนย์อนุมัติใบรายงาน',
};

export function routeDocumentTitle(pathname: string): string {
  const exactTitle = ROUTE_TITLES[pathname];
  if (exactTitle) return `${exactTitle} — ${APP_NAME}`;
  if (pathname.startsWith(`${ROUTES.serviceJobs}/`)) {
    return `รายละเอียดงานบริการ — ${APP_NAME}`;
  }
  if (pathname.startsWith(`${ROUTES.masterDataProducts}/`)) {
    return `รายละเอียดสินค้า — ${APP_NAME}`;
  }
  if (pathname === ROUTES.trackLookup || pathname.startsWith(`${ROUTES.trackLookup}/`)) {
    return `ผลการติดตามงานบริการ — ${APP_NAME}`;
  }
  return `ไม่พบหน้า — ${APP_NAME}`;
}
