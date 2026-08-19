import { ArrowLeft, Printer } from 'lucide-react';
import QRCode from 'react-qr-code';
import type { ServiceJob } from '../../../types';
import { PrimaryButton } from '../../../shared/components';
import { APP_NAME } from '../../../constants';
import { formatThaiDate } from '../../../utils/formatDate';
import { statusLabel } from '../../../services/serviceJobPresentation';
import { buildPublicTrackingUrl } from '../../../services/publicTrackingLink';
import { useEffect, useRef } from 'react';

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
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const accessories = job.accessories?.filter((accessory) => accessory.trim()) ?? [];
  // F5d-69G Phase 7A — same three-state contract as ServiceRequestPrintPreview
  // (Phase 2-FIX audit finding D2): "no code in hand" and "not activated" are
  // never the same state, so this must never print "not activated" for a job
  // whose tracking is genuinely live.
  const publicTrackingState: 'credentialed' | 'active-unavailable' | 'inactive' =
    publicTrackingCode != null
      ? 'credentialed'
      : job.publicTrackingCodeHash !== null
        ? 'active-unavailable'
        : 'inactive';
  const trackingUrl =
    publicTrackingCode != null
      ? buildPublicTrackingUrl(window.location.origin, job.id, publicTrackingCode)
      : null;

  useEffect(() => {
    document.body.classList.add('delivery-note-print-mode');
    backButtonRef.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove('delivery-note-print-mode');
  }, []);

  return (
    <div className="delivery-note-preview-shell space-y-5">
      <div className="delivery-note-preview-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            ref={backButtonRef}
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
            {publicTrackingState === 'credentialed' && trackingUrl && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex h-16 w-16 items-center justify-center bg-white p-1">
                  <QRCode
                    value={trackingUrl}
                    size={64}
                    level="L"
                    className="h-full w-full"
                  />
                </div>
                <p className="max-w-[160px] break-all text-right text-[7px] text-neutral-400">
                  {trackingUrl}
                </p>
              </div>
            )}
            {publicTrackingState === 'active-unavailable' && (
              <p className="max-w-[160px] text-right text-[7px] text-neutral-400">
                เปิดใช้งานการติดตามแล้ว — กรุณาออกรหัสติดตามใหม่ก่อนพิมพ์ QR
              </p>
            )}
            {publicTrackingState === 'inactive' && (
              <p className="max-w-[160px] text-right text-[7px] text-neutral-400">
                ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ
              </p>
            )}
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
