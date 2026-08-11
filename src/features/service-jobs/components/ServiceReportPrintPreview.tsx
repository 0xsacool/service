import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ImageOff, Printer } from 'lucide-react';
import type { ServiceJob, ServiceReport } from '../../../types';
import { formatDate, formatTime } from '../../../utils/formatDate';
import { PrimaryButton, SecondaryButton } from '../../../shared/components';
import { useServiceReportEvidence } from '../../../hooks/useServiceReportEvidence';
import type { ServiceJobAttachmentOption } from '../../../hooks/useServiceJobAttachments';
import {
  getReportDisplayContext,
  RESULT_STATUS_LABELS,
  SERVICE_ACTION_LABELS,
} from './serviceReportUi';

export function ServiceReportPrintPreview({
  report,
  serviceJob,
  attachments,
  onClose,
}: {
  report: ServiceReport;
  serviceJob: ServiceJob;
  attachments: ServiceJobAttachmentOption[];
  onClose: () => void;
}) {
  const context = getReportDisplayContext(report, serviceJob);
  const { evidence, isLoading } = useServiceReportEvidence(
    report.evidenceAttachmentIds,
    attachments
  );
  const [generatedAt] = useState(() => new Date().toISOString());
  const isDraft = report.status === 'draft';

  useEffect(() => {
    document.body.classList.add('service-report-print-mode');
    return () => document.body.classList.remove('service-report-print-mode');
  }, []);

  return (
    <div className="service-report-preview-shell space-y-6">
      <div className="service-report-preview-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-2 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับใบรายงาน
          </button>
          <p className="text-sm text-neutral-500">
            ตัวอย่างก่อนพิมพ์ · เลือก “บันทึกเป็น PDF” ในหน้าต่างพิมพ์เพื่อบันทึกไฟล์
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={onClose} className="px-4 py-2.5 text-sm">
            กลับ
          </SecondaryButton>
          <PrimaryButton onClick={() => window.print()} className="px-4 py-2.5 text-sm">
            <Printer className="h-4 w-4" />
            พิมพ์ / บันทึก PDF
          </PrimaryButton>
        </div>
      </div>

      <article className="print-area service-report-print mx-auto max-w-[210mm] bg-white p-8 text-black shadow-sm ring-1 ring-black/10 sm:p-10">
        <header className="service-report-print__header">
          <div>
            <p className="service-report-print__eyebrow">SERVICE TECH</p>
            <h1 className="service-report-print__title">ใบรายงานการตรวจสอบและซ่อม</h1>
            <p className="service-report-print__subtitle">
              บันทึกการตรวจสอบและงานบริการภายใน
            </p>
          </div>
          <div className="service-report-print__meta">
            <p className="service-report-print__report-no">{report.reportNo}</p>
            <p>เลขติดตาม: {context.trackingReference}</p>
            <p>
              สถานะ: <strong>{isDraft ? 'ฉบับร่าง' : 'สรุปผลแล้ว'}</strong>
            </p>
            <p>สร้างเมื่อ: {formatDate(report.createdAt)}</p>
            {report.finalizedAt ? (
              <p>สรุปผลเมื่อ: {formatDate(report.finalizedAt)}</p>
            ) : null}
          </div>
        </header>

        {isDraft ? (
          <div className="service-report-print__draft-banner" role="status">
            ฉบับร่าง · ตัวอย่างเท่านั้น · ยังไม่ใช่หลักฐานที่สรุปผลแล้ว
          </div>
        ) : null}

        <PrintSection title="ลูกค้า">
          <PrintGrid>
            <PrintField label="ชื่อ" value={context.customerName} />
            <PrintField label="โทรศัพท์" value={context.customerPhone} />
            <PrintField label="อีเมล" value={context.customerEmail} />
          </PrintGrid>
        </PrintSection>

        <PrintSection title="สินค้า">
          <PrintGrid>
            <PrintField
              label="แบรนด์"
              value={`${context.brandName} (${context.brandCode})`}
            />
            <PrintField label="สินค้า" value={context.productName} />
            <PrintField label="รุ่น / SKU" value={context.modelOrSku ?? 'ไม่มีข้อมูล'} />
            <PrintField
              label="หมายเลขเครื่อง"
              value={context.serialNumber || 'ยังไม่ได้บันทึก'}
            />
          </PrintGrid>
        </PrintSection>

        <PrintSection title="อาการที่ลูกค้าแจ้ง">
          <PrintParagraph value={context.customerReportedProblem} />
        </PrintSection>

        <PrintSection title="ผลการตรวจสอบทางเทคนิค">
          <PrintParagraph value={report.inspectionFindings} />
        </PrintSection>

        <PrintSection title="การดำเนินการบริการ">
          <div className="service-report-print__action-list">
            {report.serviceActions.length > 0 ? (
              report.serviceActions.map((action) => (
                <span key={action} className="service-report-print__action">
                  ✓ {SERVICE_ACTION_LABELS[action]}
                </span>
              ))
            ) : (
              <span className="service-report-print__muted">
                ยังไม่มีการบันทึกการดำเนินการ
              </span>
            )}
          </div>
        </PrintSection>

        <PrintSection title="อะไหล่ / ส่วนประกอบ">
          {report.parts.length > 0 ? (
            <table className="service-report-print__table">
              <thead>
                <tr>
                  <th>รายละเอียด</th>
                  <th>เลขที่อะไหล่</th>
                  <th>จำนวน</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {report.parts.map((part, index) => (
                  <tr key={`${index}-${part.partNo ?? 'part'}`}>
                    <td>{part.description}</td>
                    <td>{part.partNo ?? '—'}</td>
                    <td>{part.quantity}</td>
                    <td>{part.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="service-report-print__muted">ยังไม่มีการบันทึกอะไหล่</p>
          )}
        </PrintSection>

        <PrintSection title="หมายเหตุจากช่าง">
          <PrintParagraph value={report.technicianRemark} />
        </PrintSection>

        <PrintSection title="ผลลัพธ์">
          <PrintGrid>
            <PrintField
              label="สถานะผลลัพธ์"
              value={
                report.resultStatus
                  ? RESULT_STATUS_LABELS[report.resultStatus]
                  : 'ยังไม่ได้บันทึก'
              }
            />
          </PrintGrid>
          <PrintParagraph value={report.resultDetail} />
        </PrintSection>

        {report.claimNo || report.factoryReference ? (
          <PrintSection title="เลขเคลม / โรงงาน">
            <PrintGrid>
              {report.claimNo ? (
                <PrintField label="เลขที่เคลม" value={report.claimNo} />
              ) : null}
              {report.factoryReference ? (
                <PrintField label="เลขอ้างอิงโรงงาน" value={report.factoryReference} />
              ) : null}
            </PrintGrid>
          </PrintSection>
        ) : null}

        <PrintSection title="หลักฐาน">
          {report.evidenceAttachmentIds.length === 0 ? (
            <p className="service-report-print__muted">ยังไม่ได้เลือกหลักฐาน</p>
          ) : isLoading ? (
            <p className="service-report-print__muted">กำลังโหลดหลักฐานที่เลือก…</p>
          ) : (
            <div className="service-report-print__evidence-grid">
              {evidence.map((item) => (
                <div key={item.id} className="service-report-print__evidence">
                  {item.url ? (
                    <img src={item.url} alt={item.name} />
                  ) : (
                    <div className="service-report-print__evidence-placeholder">
                      <ImageOff className="h-5 w-5" />
                      <span>หลักฐานไม่พร้อมใช้งาน</span>
                    </div>
                  )}
                  <div className="service-report-print__evidence-caption">
                    <span>{item.name}</span>
                    {item.status === 'unavailable' ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PrintSection>

        <section className="service-report-print__signatures">
          <div>
            <div className="service-report-print__signature-line" />
            <p>ช่างผู้รับผิดชอบ</p>
            <span>{report.technician || 'ชื่อ / ลายเซ็น / วันที่'}</span>
          </div>
          <div>
            <div className="service-report-print__signature-line" />
            <p>โรงงาน / ผู้อนุมัติ</p>
            <span>ชื่อ / ลายเซ็น / วันที่</span>
          </div>
        </section>

        <footer className="service-report-print__footer">
          <span>{report.reportNo}</span>
          <span>{context.trackingReference}</span>
          <span>
            สร้างเอกสารเมื่อ {formatDate(generatedAt)} {formatTime(new Date(generatedAt))}
          </span>
        </footer>
      </article>
    </div>
  );
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="service-report-print__section">
      <h2 className="service-report-print__section-title">{title}</h2>
      {children}
    </section>
  );
}

function PrintGrid({ children }: { children: ReactNode }) {
  return <div className="service-report-print__grid">{children}</div>;
}

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="service-report-print__field-label">{label}</p>
      <p className="service-report-print__field-value">{value || '—'}</p>
    </div>
  );
}

function PrintParagraph({ value }: { value: string }) {
  return (
    <p className="service-report-print__paragraph">
      {value || 'ยังไม่มีการบันทึกข้อมูล'}
    </p>
  );
}
