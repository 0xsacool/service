import { useEffect } from 'react';
import { ArrowLeft, Printer, ShieldCheck } from 'lucide-react';
import QRCode from 'react-qr-code';
import type { ServiceJob } from '../../../types';
import { APP_NAME } from '../../../constants';
import { PrimaryButton, SecondaryButton, Logo } from '../../../shared/components';
import { buildPublicTrackingUrl } from '../../../services/publicTrackingLink';
import { warrantyOutcomeLabel } from '../../../services/serviceJobPresentation';
import { formatDate, formatThaiDate } from '../../../utils/formatDate';
import { RESULT_STATUS_LABELS, SERVICE_ACTION_LABELS } from './serviceReportUi';
import type { ReturnFormTrustedPrint } from './productReturnFormUi';

function ReturnFormField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="text-[11px] font-medium text-black">{value}</p>
    </div>
  );
}

export function ProductReturnFormPrintPreview({
  serviceJob,
  trustedPrint,
  publicTrackingCode,
  onClose,
}: {
  serviceJob: ServiceJob;
  trustedPrint: ReturnFormTrustedPrint;
  publicTrackingCode: string | null;
  onClose: () => void;
}) {
  const report = trustedPrint.report;
  const trackingUrl =
    publicTrackingCode !== null
      ? buildPublicTrackingUrl(window.location.origin, serviceJob.id, publicTrackingCode)
      : null;
  const publicTrackingState: 'credentialed' | 'active-unavailable' | 'inactive' =
    publicTrackingCode !== null
      ? 'credentialed'
      : serviceJob.publicTrackingCodeHash !== null
        ? 'active-unavailable'
        : 'inactive';

  useEffect(() => {
    document.body.classList.add('product-return-form-print-mode');
    return () => document.body.classList.remove('product-return-form-print-mode');
  }, []);

  return (
    <div className="product-return-form-preview-shell space-y-6">
      <div className="product-return-form-preview-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับงานบริการ
        </button>
        <PrimaryButton onClick={() => window.print()} className="px-4 py-2.5 text-sm">
          <Printer className="h-4 w-4" />
          พิมพ์ / บันทึก PDF
        </PrimaryButton>
      </div>

      <article className="print-area product-return-form-print mx-auto max-w-[210mm] bg-white p-8 text-black shadow-sm ring-1 ring-black/10 sm:p-10">
        <header className="flex items-start justify-between border-b-2 border-black pb-4">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <div>
              <p className="text-sm font-semibold">{APP_NAME}</p>
              <h1 className="mt-1 text-xl font-bold">ใบรับคืนสินค้า</h1>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-neutral-400">
              เลขที่ใบรับคืน
            </p>
            <p className="text-lg font-bold">{serviceJob.returnFormNumber}</p>
            <p className="text-[10px] text-neutral-500">เลขติดตาม {serviceJob.id}</p>
            <div className="mt-2 flex flex-col items-end gap-1">
              {publicTrackingState === 'credentialed' && trackingUrl ? (
                <>
                  <div className="flex h-16 w-16 items-center justify-center bg-white p-1">
                    <QRCode value={trackingUrl} size={64} level="L" />
                  </div>
                  <p className="max-w-[160px] break-all text-right text-[7px] text-neutral-400">
                    {trackingUrl}
                  </p>
                </>
              ) : null}
              {publicTrackingState === 'active-unavailable' ? (
                <p className="max-w-[180px] text-right text-[7px] text-neutral-400">
                  ระบบติดตามเคยเปิดใช้งาน แต่ไม่มีรหัสฉบับจริงใน browser นี้
                </p>
              ) : null}
              {publicTrackingState === 'inactive' ? (
                <p className="max-w-[180px] text-right text-[7px] text-neutral-400">
                  ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2">
          <ReturnFormField label="ชื่อลูกค้า" value={serviceJob.customerName} />
          <ReturnFormField label="โทรศัพท์" value={serviceJob.customerPhone} />
          <ReturnFormField label="สินค้า" value={serviceJob.product} />
          <ReturnFormField
            label="หมายเลขเครื่อง"
            value={serviceJob.serialNumber || 'ยังไม่ได้บันทึก'}
          />
          <ReturnFormField
            label="วันที่รับคืนสินค้า"
            value={formatThaiDate(serviceJob.closedAt ?? '—')}
          />
          <ReturnFormField label="ใบรายงานอ้างอิง" value={report.reportNo} />
        </section>

        <section className="mt-6">
          <h2 className="border-b border-neutral-300 pb-1 text-xs font-bold">
            สรุปผลการตรวจสอบและบริการ
          </h2>
          <p className="mt-2 text-[11px]">{report.inspectionFindings || '—'}</p>
          {report.serviceActions.length > 0 ? (
            <p className="mt-2 text-[10px] text-neutral-700">
              การดำเนินการ:{' '}
              {report.serviceActions
                .map((action) => SERVICE_ACTION_LABELS[action])
                .join(' · ')}
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-neutral-700">
            ผลลัพธ์:{' '}
            {report.resultStatus
              ? RESULT_STATUS_LABELS[report.resultStatus]
              : 'ยังไม่ได้บันทึก'}
            {report.resultDetail ? ` · ${report.resultDetail}` : ''}
          </p>
        </section>

        <section className="mt-6">
          <h2 className="border-b border-neutral-300 pb-1 text-xs font-bold">
            อะไหล่ / ส่วนประกอบ
          </h2>
          {report.parts.length > 0 ? (
            <table className="mt-2 w-full border-collapse text-[9px]">
              <thead>
                <tr>
                  <th className="border border-neutral-300 p-1.5 text-left">รายการ</th>
                  <th className="border border-neutral-300 p-1.5 text-left">
                    เลขที่อะไหล่
                  </th>
                  <th className="border border-neutral-300 p-1.5 text-right">จำนวน</th>
                  <th className="border border-neutral-300 p-1.5 text-left">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {report.parts.map((part, index) => (
                  <tr key={`${index}-${part.partNo ?? 'part'}`}>
                    <td className="border border-neutral-300 p-1.5">
                      {part.description}
                    </td>
                    <td className="border border-neutral-300 p-1.5">
                      {part.partNo ?? '—'}
                    </td>
                    <td className="border border-neutral-300 p-1.5 text-right">
                      {part.quantity}
                    </td>
                    <td className="border border-neutral-300 p-1.5">{part.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-[10px] text-neutral-500">ไม่มีรายการอะไหล่</p>
          )}
        </section>

        <section className="mt-6 rounded-lg border border-neutral-300 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2">
              <ReturnFormField
                label="ผลการรับประกัน"
                value={warrantyOutcomeLabel(report.warrantyOutcome)}
              />
              <ReturnFormField label="ผลการอนุมัติ" value="อนุมัติแล้ว" />
              <ReturnFormField
                label="ผู้พิจารณาในระบบ"
                value={trustedPrint.event.approverDisplayNameSnapshot ?? 'ไม่ระบุชื่อ'}
              />
              <ReturnFormField
                label="วันที่พิจารณา"
                value={formatDate(trustedPrint.event.decidedAt)}
              />
            </div>
          </div>
        </section>

        <section className="mt-6 text-[10px] leading-5">
          <p>
            ลูกค้าได้รับสินค้าคืนตามรายละเอียดข้างต้นและตรวจรับสินค้า ณ
            วันที่ระบุในเอกสารนี้
          </p>
        </section>

        <section className="product-return-form-print__signatures mt-10 grid grid-cols-2 gap-8">
          <div>
            <div className="h-14 border-b border-black" />
            <p className="mt-1 text-[10px] font-medium">ลายเซ็นลูกค้า</p>
            <p className="text-[8px] text-neutral-400">ชื่อ / ลายเซ็น / วันที่</p>
          </div>
          <div>
            <div className="h-14 border-b border-black" />
            <p className="mt-1 text-[10px] font-medium">ลายเซ็นเจ้าหน้าที่ผู้ส่งมอบ</p>
            <p className="text-[8px] text-neutral-400">ชื่อ / ลายเซ็น / วันที่</p>
          </div>
        </section>

        <footer className="mt-10 flex justify-between border-t border-neutral-300 pt-2 text-[7px] uppercase tracking-wide text-neutral-400">
          <span>หน้า 1 จาก 1</span>
          <span>เอกสารที่สร้างโดยระบบ</span>
          <span>{APP_NAME} ศูนย์บริการ</span>
        </footer>
      </article>

      <div className="product-return-form-preview-toolbar flex justify-center">
        <SecondaryButton onClick={onClose}>กลับ</SecondaryButton>
      </div>
    </div>
  );
}
