import { Link } from 'react-router-dom';
import { ROUTES } from '../../../constants';

export function EvidenceArchiveAbout() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-neutral-50 px-4 py-10 text-ink focus:outline-none sm:px-6"
    >
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-10">
        <p className="text-sm font-medium text-brand-600">Service Tech</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Service Tech Evidence Archive
        </h1>
        <p className="mt-5 text-[15px] leading-7 text-neutral-700">
          Service Tech Evidence Archive เป็นส่วนหนึ่งของระบบ Service Tech
          สำหรับจัดเก็บหลักฐานประกอบงานบริการ การซ่อม การรับประกัน และการเคลม
          เพื่อให้เจ้าหน้าที่ที่ได้รับอนุญาตสามารถเปิดดูหรือดาวน์โหลดหลักฐานย้อนหลังได้
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Google Drive ใช้ทำอะไร</h2>
          <p className="mt-2 text-[15px] leading-7 text-neutral-700">
            ระบบใช้ Google Drive
            เป็นคลังหลักฐานภายในสำหรับไฟล์ที่เจ้าหน้าที่เลือกแนบกับงานบริการ เช่น รูปภาพ
            วิดีโอ และ PDF โดยขอสิทธิ์เฉพาะไฟล์ที่แอปสร้างหรือใช้งานผ่านแอป
            ไม่ได้ขอสิทธิ์อ่านไฟล์ทั้งหมดใน Google Drive ของบัญชี
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">การเข้าถึงและการเก็บรักษา</h2>
          <p className="mt-2 text-[15px] leading-7 text-neutral-700">
            การเปิดดู ดาวน์โหลด หรือเพิ่มหลักฐานต้องผ่านบัญชีเจ้าหน้าที่ Service Tech
            และสิทธิ์ของงานบริการนั้น ไฟล์หลักฐานถูกออกแบบให้เก็บประมาณ 365 วัน
            เพื่อรองรับการตรวจสอบย้อนหลังตามกระบวนการบริการขององค์กร
          </p>
        </section>

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
