import { ArrowLeft, Printer } from 'lucide-react';
import type { ServiceJob } from '../../../types';
import { PrimaryButton } from '../../../shared/components';
import { APP_NAME } from '../../../constants';
import { formatThaiDate } from '../../../utils/formatDate';
import { statusLabel } from '../../../services/serviceJobPresentation';
import { normalizePublicTrackingCodeInput } from '../../../services/publicTrackingCode';
import { useEffect } from 'react';

function DeliveryNoteField({ label, value }: { label: string; value: string }) {
  return (
    <div className="delivery-note-print__field">
      <p className="delivery-note-print__field-label">{label}</p>
      <p className="delivery-note-print__field-value">{value || '—'}</p>
    </div>
  );
}

function HandwritingLines({ count = 2 }: { count?: number }) {
  return (
    <div className="delivery-note-print__handwriting-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="delivery-note-print__handwriting-line" />
      ))}
    </div>
  );
}

export function DeliveryNotePrintPreview({
  job,
  onClose,
  publicTrackingCode,
}: {
  job: ServiceJob;
  onClose: () => void;
  publicTrackingCode?: string;
}) {
  const accessories = job.accessories?.filter((accessory) => accessory.trim()) ?? [];
  const normalizedTrackingCode = publicTrackingCode
    ? normalizePublicTrackingCodeInput(publicTrackingCode)
    : null;

  useEffect(() => {
    document.body.classList.add('delivery-note-print-mode');
    return () => document.body.classList.remove('delivery-note-print-mode');
  }, []);

  return (
    <div className="delivery-note-preview-shell space-y-5">
      <div className="delivery-note-preview-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-2 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับรายละเอียดงานบริการ
          </button>
          <p className="text-sm text-neutral-500">
            ตัวอย่างใบนำส่ง · เลือก “พิมพ์” หรือ “บันทึกเป็น PDF” ในหน้าต่างพิมพ์
          </p>
        </div>
        <PrimaryButton onClick={() => window.print()} className="px-4 py-2.5 text-sm">
          <Printer className="h-4 w-4" />
          พิมพ์ / บันทึก PDF
        </PrimaryButton>
      </div>

      <article className="print-area delivery-note-print mx-auto max-w-[210mm] bg-white p-7 text-black shadow-sm ring-1 ring-black/10 sm:p-8">
        <header className="delivery-note-print__header">
          <div>
            <p className="delivery-note-print__eyebrow">SERVICE TECH</p>
            <h1 className="delivery-note-print__title">ใบนำส่งสินค้า</h1>
            <p className="delivery-note-print__subtitle">
              เอกสารสำหรับการส่งมอบสินค้าในงานบริการ
            </p>
          </div>
          <div className="delivery-note-print__identity">
            <DeliveryNoteField label="เลขที่งาน" value={job.id} />
            <DeliveryNoteField label="วันที่" value={formatThaiDate(job.createdAt)} />
            {normalizedTrackingCode ? (
              <DeliveryNoteField
                label="รหัสติดตามงานบริการ"
                value={normalizedTrackingCode}
              />
            ) : null}
          </div>
        </header>

        <section className="delivery-note-print__section">
          <h2 className="delivery-note-print__section-title">ข้อมูลลูกค้า</h2>
          <div className="delivery-note-print__grid">
            <DeliveryNoteField label="ชื่อลูกค้า" value={job.customerName} />
            <DeliveryNoteField label="โทรศัพท์" value={job.customerPhone} />
            {job.customerEmail ? (
              <DeliveryNoteField label="อีเมล" value={job.customerEmail} />
            ) : null}
          </div>
        </section>

        <section className="delivery-note-print__section">
          <h2 className="delivery-note-print__section-title">ข้อมูลสินค้า</h2>
          <div className="delivery-note-print__grid">
            <DeliveryNoteField label="สินค้า" value={job.product} />
            <DeliveryNoteField label="ประเภทสินค้า" value={job.productCategory} />
            <DeliveryNoteField label="หมายเลขเครื่อง" value={job.serialNumber} />
          </div>
        </section>

        <section className="delivery-note-print__section">
          <h2 className="delivery-note-print__section-title">รายละเอียดงานบริการ</h2>
          <div className="delivery-note-print__grid">
            <DeliveryNoteField label="อาการที่ลูกค้าแจ้ง" value={job.issue} />
            <DeliveryNoteField label="สถานะปัจจุบัน" value={statusLabel(job.status)} />
          </div>
        </section>

        <section className="delivery-note-print__section">
          <h2 className="delivery-note-print__section-title">
            สิ่งที่ส่งมาพร้อมสินค้า / อุปกรณ์ที่ได้รับ
          </h2>
          {accessories.length > 0 ? (
            <p className="delivery-note-print__value">{accessories.join(' · ')}</p>
          ) : (
            <HandwritingLines count={3} />
          )}
        </section>

        <section className="delivery-note-print__section">
          <h2 className="delivery-note-print__section-title">หมายเหตุ</h2>
          <HandwritingLines count={2} />
        </section>

        <section className="delivery-note-print__signatures">
          <div>
            <p className="delivery-note-print__signature-title">ผู้ส่งมอบสินค้า</p>
            <div className="delivery-note-print__signature-line" />
            <p className="delivery-note-print__signature-caption">
              ลายเซ็น __________________
            </p>
            <p className="delivery-note-print__signature-caption">
              วันที่ ____________________
            </p>
          </div>
          <div>
            <p className="delivery-note-print__signature-title">
              เจ้าหน้าที่ผู้รับสินค้า
            </p>
            <div className="delivery-note-print__signature-line" />
            <p className="delivery-note-print__signature-caption">
              ลายเซ็น __________________
            </p>
            <p className="delivery-note-print__signature-caption">
              วันที่ ____________________
            </p>
          </div>
        </section>

        <footer className="delivery-note-print__footer">
          <span>{APP_NAME}</span>
          <span>เอกสารสำหรับการส่งมอบสินค้า</span>
        </footer>
      </article>
    </div>
  );
}
