import { useEffect } from 'react';
import { Check, Printer, Plus } from 'lucide-react';
import type { ServiceJob } from '../../../types';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  Logo,
} from '../../../shared/components';
import { APP_NAME, ROUTES } from '../../../constants';
import { formatThaiDate } from '../../../utils/formatDate';

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="text-[11px] font-medium text-black">{value}</p>
    </div>
  );
}

// Renders the Service Request document (PRINT_SPECIFICATIONS.md) — the
// receipt handed to the customer at drop-off. F5d-68: activates
// service-request-print-mode on mount (mirroring
// ServiceReportPrintPreview/DeliveryNotePrintPreview's proven pattern) so
// the staff shell, page heading, and this on-screen success card/action
// row are all hidden under @media print — only .print-area remains
// printable. See the @media print rules in index.css.
export function ServiceRequestPrintPreview({
  job,
  onPrintAgain,
  onNewServiceJob,
}: {
  job: ServiceJob;
  onPrintAgain: () => void;
  onNewServiceJob: () => void;
}) {
  const trackingUrl = `${window.location.origin}${ROUTES.track(job.id)}`;

  useEffect(() => {
    document.body.classList.add('service-request-print-mode');
    return () => document.body.classList.remove('service-request-print-mode');
  }, []);

  return (
    <div className="service-request-preview-shell space-y-6">
      <div className="service-request-preview-toolbar space-y-6">
        <GlassCard className="flex items-center gap-3 p-5 animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-600">
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-semibold text-ink">สร้างงานบริการ {job.id} แล้ว</p>
            <p className="text-sm text-neutral-500">
              บันทึกเรียบร้อยและพร้อมพิมพ์ให้ลูกค้า
            </p>
          </div>
        </GlassCard>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center animate-[fade-in_0.5s_ease_both]">
          <PrimaryButton onClick={onPrintAgain}>
            <Printer className="h-5 w-5" />
            พิมพ์อีกครั้ง
          </PrimaryButton>
          <SecondaryButton onClick={onNewServiceJob}>
            <Plus className="h-5 w-5" />
            สร้างงานบริการใหม่
          </SecondaryButton>
        </div>
      </div>

      <div className="print-area mx-auto max-w-[210mm] rounded-2xl bg-white p-10 text-black shadow-sm ring-1 ring-black/10 animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both] print:m-0 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="text-sm font-semibold">{APP_NAME}</span>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-neutral-400">เลขติดตาม</p>
            <p className="text-lg font-bold">{job.id}</p>
            {job.serviceRequestNumber && (
              <p className="text-[10px] text-neutral-500">
                เลขที่ใบรับบริการ {job.serviceRequestNumber}
              </p>
            )}
            <div className="mt-2 flex flex-col items-end gap-1">
              <div className="flex h-16 w-16 items-center justify-center border border-neutral-400 text-[8px] font-medium text-neutral-400">
                คิวอาร์โค้ด
              </div>
              <p className="max-w-[160px] break-all text-right text-[7px] text-neutral-400">
                {trackingUrl}
              </p>
            </div>
          </div>
        </div>

        <h1 className="mt-4 print:mt-3 text-center text-xl font-bold uppercase tracking-wide">
          ใบนำส่งเข้ารับบริการ
        </h1>

        {/* Customer */}
        <section className="mt-6 print:mt-4">
          <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide">
            ลูกค้า
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <PrintField label="ชื่อ" value={job.customerName} />
            <PrintField label="โทรศัพท์" value={job.customerPhone} />
            <PrintField label="อีเมล" value={job.customerEmail} />
          </div>
        </section>

        {/* Product */}
        <section className="mt-6 print:mt-4">
          <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide">
            สินค้า
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <PrintField label="สินค้า" value={job.product} />
            <PrintField label="หมวดหมู่" value={job.productCategory} />
            <PrintField
              label="หมายเลขเครื่อง"
              value={job.serialNumber || 'ยังไม่ได้บันทึก'}
            />
            <PrintField
              label="การรับประกัน"
              value={job.warranty ? 'อยู่ในประกัน' : 'หมดประกัน'}
            />
          </div>
        </section>

        {/* Problem */}
        <section className="mt-6 print:mt-4">
          <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide">
            รายละเอียดอาการ
          </h2>
          <p className="text-[11px] font-medium text-black">{job.issue}</p>
          {job.description !== job.issue && (
            <p className="mt-1 text-[11px] text-neutral-600">{job.description}</p>
          )}
        </section>

        {/* Accessories */}
        {job.accessories && job.accessories.length > 0 && (
          <section className="mt-6 print:mt-4">
            <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide">
              อุปกรณ์ที่นำมาด้วย
            </h2>
            <p className="text-[11px] text-black">{job.accessories.join(', ')}</p>
          </section>
        )}

        {/* Photos — compact print-only thumbnail size (64px, ~F5d-67's
            normal 3-photo workflow) keeps three photos on one row without
            stretching or losing aspect ratio; break-inside-avoid keeps the
            whole photo block from splitting across a page boundary. */}
        {job.photos.length > 0 && (
          <section className="mt-6 print:mt-4 print:break-inside-avoid">
            <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide">
              รูปถ่ายที่บันทึกไว้
            </h2>
            <div className="flex flex-wrap gap-2">
              {job.photos.map((src, index) => (
                <img
                  key={index}
                  src={src}
                  alt=""
                  className="h-20 w-20 print:h-16 print:w-16 rounded border border-neutral-300 object-cover"
                />
              ))}
            </div>
          </section>
        )}

        {/* Dates & technician */}
        <section className="mt-6 print:mt-4 print:break-inside-avoid grid grid-cols-2 gap-x-6 gap-y-2">
          <PrintField label="วันที่รับสินค้า" value={formatThaiDate(job.createdAt)} />
          <PrintField
            label="Expected Return"
            value={job.estimatedCompletion === '—' ? 'รอกำหนด' : job.estimatedCompletion}
          />
          <PrintField label="ช่างผู้รับผิดชอบ" value={job.technician} />
        </section>

        {/* Signatures */}
        <section className="mt-10 print:mt-6 print:break-inside-avoid grid grid-cols-2 gap-8">
          <div>
            <div className="h-14 border-b border-black" />
            <p className="mt-1 text-[10px] font-medium">ลายเซ็นลูกค้า</p>
            <p className="text-[8px] text-neutral-400">ชื่อ / วันที่</p>
          </div>
          <div>
            <div className="h-14 border-b border-black" />
            <p className="mt-1 text-[10px] font-medium">ลายเซ็นเจ้าหน้าที่</p>
            <p className="text-[8px] text-neutral-400">ชื่อ / วันที่</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 print:mt-6 print:break-inside-avoid flex justify-between border-t border-neutral-300 pt-2 text-[7px] uppercase tracking-wide text-neutral-400">
          <span>หน้า 1 จาก 1</span>
          <span>เอกสารที่สร้างโดยระบบ</span>
          <span>{APP_NAME} ศูนย์บริการ</span>
        </footer>
      </div>
    </div>
  );
}
