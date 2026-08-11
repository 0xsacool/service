import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  FileText,
  LockKeyhole,
  Paperclip,
  Printer,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  ServiceAction,
  ServiceJob,
  ServiceReport,
  ServiceReportDraftPatch,
  ServiceReportPart,
  ResultStatus,
} from '../../../types';
import { RESULT_STATUSES, SERVICE_ACTIONS } from '../../../types';
import { backendKind } from '../../../config/backend';
import { useServiceReports } from '../../../hooks/useServiceReports';
import {
  useServiceJobAttachments,
  type ServiceJobAttachmentOption,
} from '../../../hooks/useServiceJobAttachments';
import {
  FormSection,
  GlassCard,
  Modal,
  PrimaryButton,
  SecondaryButton,
  EmptyState,
  ErrorState,
  inputClass,
} from '../../../shared/components';
import { formatDate, formatDateShort } from '../../../utils/formatDate';
import {
  getActiveDraft,
  getLatestServiceReport,
  getReportDisplayContext,
  getReportHistory,
  RESULT_STATUS_LABELS,
  SERVICE_ACTION_LABELS,
  toDraftPatch,
} from './serviceReportUi';
import { ServiceReportPrintPreview } from './ServiceReportPrintPreview';

interface DraftFormState {
  technician: string;
  customerReportedProblem: string;
  inspectionFindings: string;
  serviceActions: ServiceAction[];
  parts: ServiceReportPart[];
  technicianRemark: string;
  resultStatus: ResultStatus | null;
  resultDetail: string;
  evidenceAttachmentIds: string[];
  claimNo: string | null;
  factoryReference: string | null;
}

function formStateFromReport(report: ServiceReport): DraftFormState {
  const patch = toDraftPatch(report);
  return {
    technician: patch.technician ?? '',
    customerReportedProblem: patch.customerReportedProblem ?? '',
    inspectionFindings: patch.inspectionFindings ?? '',
    serviceActions: patch.serviceActions ?? [],
    parts: patch.parts ?? [],
    technicianRemark: patch.technicianRemark ?? '',
    resultStatus: patch.resultStatus ?? null,
    resultDetail: patch.resultDetail ?? '',
    evidenceAttachmentIds: patch.evidenceAttachmentIds ?? [],
    claimNo: patch.claimNo ?? null,
    factoryReference: patch.factoryReference ?? null,
  };
}

function toPatch(form: DraftFormState): ServiceReportDraftPatch {
  return {
    technician: form.technician,
    customerReportedProblem: form.customerReportedProblem,
    inspectionFindings: form.inspectionFindings,
    serviceActions: form.serviceActions,
    parts: form.parts,
    technicianRemark: form.technicianRemark,
    resultStatus: form.resultStatus,
    resultDetail: form.resultDetail,
    evidenceAttachmentIds: form.evidenceAttachmentIds,
    claimNo: form.claimNo,
    factoryReference: form.factoryReference,
  };
}

function hasInvalidPart(form: DraftFormState): boolean {
  return form.parts.some(
    (part) =>
      !part.description.trim() ||
      !Number.isInteger(part.quantity) ||
      part.quantity < 1 ||
      !part.remark.trim()
  );
}

function reportStatusClass(status: ServiceReport['status']): string {
  return status === 'final'
    ? 'bg-success-50 text-success-700 ring-success-200'
    : 'bg-warning-50 text-warning-700 ring-warning-200';
}

// F5d-33/F5d-34 B-6: Service Report Firestore persistence remains blocked
// (no `serviceReports`/`numberSequences` Rules yet — see DECISIONS.md and
// PROJECT_STATE.md's Service Report Workstream notes). Under a durable
// backend the unavailable repository provider makes createDraft/updateDraft/
// finalize reject, so the section wasn't silently corrupting data — but it
// still presented a "Create Report" action that was guaranteed to fail on
// click. This gate keeps the full Mock/development experience unchanged and
// replaces the interactive section with an explicit unavailable state
// whenever the durable backend is active, instead of offering an action
// that cannot succeed.
export function ServiceReportsSection({ serviceJob }: { serviceJob: ServiceJob }) {
  if (backendKind !== 'mock') {
    return (
      <section className="space-y-5" aria-labelledby="service-reports-heading">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-brand-600" />
          <h2
            id="service-reports-heading"
            className="text-xl font-semibold tracking-tight text-ink"
          >
            ใบรายงานการตรวจสอบและซ่อม
          </h2>
        </div>
        <GlassCard className="p-8">
          <EmptyState
            icon={ClipboardList}
            title="ยังไม่เปิดใช้งานใบรายงานในระบบจริง"
            description="ฟีเจอร์ใบรายงานยังอยู่ระหว่างการตรวจสอบสิทธิ์การเข้าถึงข้อมูล (Firestore Rules) และยังไม่พร้อมใช้งานในระบบจริง"
          />
        </GlassCard>
      </section>
    );
  }
  return <ServiceReportsSectionActive serviceJob={serviceJob} />;
}

function ServiceReportsSectionActive({ serviceJob }: { serviceJob: ServiceJob }) {
  const { reports, createDraft, updateDraft, finalize } = useServiceReports(
    serviceJob.id
  );
  const { attachments } = useServiceJobAttachments(serviceJob.id);
  const latestReport = getLatestServiceReport(reports);
  const activeDraft = getActiveDraft(reports);
  const history = getReportHistory(reports);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'view' | null>(null);
  const [finalizePromptToken, setFinalizePromptToken] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedReport = reports.find((report) => report.id === selectedReportId);

  const openReport = (
    reportId: string,
    nextMode: 'edit' | 'view',
    shouldPromptFinalize = false
  ) => {
    setActionError(null);
    setSelectedReportId(reportId);
    setMode(nextMode);
    setFinalizePromptToken((value) => (shouldPromptFinalize ? value + 1 : 0));
  };

  const handleCreate = async () => {
    if (activeDraft) {
      openReport(activeDraft.id, 'edit');
      return;
    }
    setIsCreating(true);
    setActionError(null);
    try {
      const report = await createDraft();
      openReport(report.id, 'edit');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'ไม่สามารถสร้างร่างได้');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async (reportId: string, patch: ServiceReportDraftPatch) => {
    await updateDraft(reportId, patch);
  };

  const handleFinalize = async (reportId: string, patch: ServiceReportDraftPatch) => {
    await updateDraft(reportId, patch);
    await finalize(reportId);
    setMode('view');
  };

  if (selectedReport && mode === 'edit' && selectedReport.status === 'draft') {
    return (
      <ServiceReportEditor
        key={selectedReport.id}
        report={selectedReport}
        serviceJob={serviceJob}
        attachments={attachments}
        finalizePromptToken={finalizePromptToken}
        onClose={() => {
          setSelectedReportId(null);
          setMode(null);
        }}
        onSave={(patch) => handleSave(selectedReport.id, patch)}
        onFinalize={(patch) => handleFinalize(selectedReport.id, patch)}
      />
    );
  }

  if (selectedReport && mode === 'view') {
    return (
      <ServiceReportReadOnly
        report={selectedReport}
        serviceJob={serviceJob}
        attachments={attachments}
        onBack={() => {
          setSelectedReportId(null);
          setMode(null);
        }}
        onEdit={
          selectedReport.status === 'draft'
            ? () => openReport(selectedReport.id, 'edit')
            : undefined
        }
      />
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="service-reports-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand-600" />
            <h2
              id="service-reports-heading"
              className="text-xl font-semibold tracking-tight text-ink"
            >
              ใบรายงานการตรวจสอบและซ่อม
            </h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            ใบรายงานแต่ละฉบับเป็นบันทึกงานบริการแยกกัน รายงานฉบับใหม่คือการทำงานครั้งใหม่
            ไม่ใช่การแก้ไขฉบับเดิม
          </p>
        </div>
        <PrimaryButton
          onClick={() => void handleCreate()}
          disabled={isCreating}
          className="px-4 py-2.5 text-sm"
        >
          <FilePlus2 className="h-4 w-4" />
          {isCreating
            ? 'กำลังสร้าง…'
            : activeDraft
              ? 'ดำเนินการร่างต่อ'
              : 'สร้างใบรายงาน'}
        </PrimaryButton>
      </div>

      {actionError ? (
        <ErrorState
          title="ดำเนินการใบรายงานไม่สำเร็จ"
          description={actionError}
          action={
            activeDraft ? (
              <SecondaryButton onClick={() => openReport(activeDraft.id, 'edit')}>
                ดำเนินการแก้ไขต่อ
              </SecondaryButton>
            ) : undefined
          }
        />
      ) : null}

      {reports.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            icon={ClipboardList}
            title="ยังไม่มีใบรายงาน"
            description="สร้างใบรายงานฉบับแรกเพื่อบันทึกการตรวจสอบ งานที่ทำ หลักฐาน และผลลัพธ์"
            action={
              <PrimaryButton
                onClick={() => void handleCreate()}
                disabled={isCreating}
                className="mt-4"
              >
                <FilePlus2 className="h-4 w-4" />
                สร้างใบรายงาน
              </PrimaryButton>
            }
          />
        </GlassCard>
      ) : (
        <>
          {activeDraft ? (
            <GlassCard className="border border-warning-200 bg-warning-50/60 p-5 ring-warning-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-warning-600 ring-1 ring-warning-200">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-ink">
                        ร่างที่กำลังดำเนินการ · {activeDraft.reportNo}
                      </h3>
                      <ReportStatusBadge status="draft" />
                    </div>
                    <p className="mt-1 text-sm text-neutral-600">
                      อนุญาตให้มีร่างที่กำลังดำเนินการได้เพียงฉบับเดียว
                      ดำเนินการฉบับนี้ต่อหรือสรุปผลก่อนสร้างฉบับใหม่
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton
                    onClick={() => openReport(activeDraft.id, 'view')}
                    className="px-4 py-2.5 text-sm"
                  >
                    ดู
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() => openReport(activeDraft.id, 'edit')}
                    className="px-4 py-2.5 text-sm"
                  >
                    ดำเนินการแก้ไขต่อ
                  </SecondaryButton>
                  <PrimaryButton
                    onClick={() => openReport(activeDraft.id, 'edit', true)}
                    className="px-4 py-2.5 text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    สรุปผล
                  </PrimaryButton>
                </div>
              </div>
            </GlassCard>
          ) : null}

          {latestReport ? (
            <ReportSummaryCard
              report={latestReport}
              serviceJob={serviceJob}
              prominent
              onView={() => openReport(latestReport.id, 'view')}
              onEdit={
                latestReport.status === 'draft'
                  ? () => openReport(latestReport.id, 'edit')
                  : undefined
              }
            />
          ) : null}

          {history.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Archive className="h-4 w-4 text-neutral-400" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  ประวัติใบรายงาน
                </h3>
              </div>
              <div className="space-y-3">
                {history.map((report) => (
                  <ReportSummaryCard
                    key={report.id}
                    report={report}
                    serviceJob={serviceJob}
                    onView={() => openReport(report.id, 'view')}
                    onEdit={
                      report.status === 'draft'
                        ? () => openReport(report.id, 'edit')
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ReportStatusBadge({ status }: { status: ServiceReport['status'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${reportStatusClass(status)}`}
    >
      {status === 'final' ? 'สรุปผลแล้ว' : 'ฉบับร่าง'}
    </span>
  );
}

function ReportSummaryCard({
  report,
  serviceJob,
  prominent = false,
  onView,
  onEdit,
}: {
  report: ServiceReport;
  serviceJob: ServiceJob;
  prominent?: boolean;
  onView: () => void;
  onEdit?: () => void;
}) {
  const context = getReportDisplayContext(report, serviceJob);
  return (
    <GlassCard className={`p-5 ${prominent ? 'ring-brand-200' : ''}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {prominent ? (
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">
                รายงานล่าสุด
              </span>
            ) : null}
            <h3 className="font-semibold text-ink">{report.reportNo}</h3>
            <ReportStatusBadge status={report.status} />
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            {context.productName} · {context.customerName}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span>สร้างเมื่อ {formatDateShort(report.createdAt)}</span>
            {report.finalizedAt ? (
              <span>สรุปผลเมื่อ {formatDateShort(report.finalizedAt)}</span>
            ) : null}
            {report.resultStatus ? (
              <span>{RESULT_STATUS_LABELS[report.resultStatus]}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onEdit ? (
            <SecondaryButton onClick={onEdit} className="px-4 py-2.5 text-sm">
              แก้ไข
            </SecondaryButton>
          ) : null}
          <SecondaryButton onClick={onView} className="px-4 py-2.5 text-sm">
            ดู
            <ChevronRight className="h-4 w-4" />
          </SecondaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

function ServiceReportEditor({
  report,
  serviceJob,
  attachments,
  finalizePromptToken,
  onClose,
  onSave,
  onFinalize,
}: {
  report: ServiceReport;
  serviceJob: ServiceJob;
  attachments: ServiceJobAttachmentOption[];
  finalizePromptToken: number;
  onClose: () => void;
  onSave: (patch: ServiceReportDraftPatch) => Promise<void>;
  onFinalize: (patch: ServiceReportDraftPatch) => Promise<void>;
}) {
  const [form, setForm] = useState<DraftFormState>(() => formStateFromReport(report));
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showFinalizeConfirmation, setShowFinalizeConfirmation] = useState(
    finalizePromptToken > 0
  );
  const context = getReportDisplayContext(report, serviceJob);
  const invalidParts = hasInvalidPart(form);
  const availableAttachmentIds = useMemo(
    () => new Set(attachments.map((attachment) => attachment.id)),
    [attachments]
  );

  const updateForm = <K extends keyof DraftFormState>(
    key: K,
    value: DraftFormState[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  };

  const toggleAction = (action: ServiceAction) => {
    updateForm(
      'serviceActions',
      form.serviceActions.includes(action)
        ? form.serviceActions.filter((value) => value !== action)
        : [...form.serviceActions, action]
    );
  };

  const updatePart = <K extends keyof ServiceReportPart>(
    index: number,
    key: K,
    value: ServiceReportPart[K]
  ) => {
    updateForm(
      'parts',
      form.parts.map((part, partIndex) =>
        partIndex === index ? { ...part, [key]: value } : part
      )
    );
  };

  const validateAndSave = async () => {
    if (invalidParts) {
      setError('กรุณากรอกรายละเอียด หมายเหตุ และจำนวนอย่างน้อย 1 ในทุกแถวอะไหล่');
      return;
    }
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(toPatch(form));
      setSuccess('บันทึกร่างเรียบร้อยแล้ว');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกร่างได้');
    } finally {
      setIsSaving(false);
    }
  };

  const validateAndFinalize = async () => {
    if (invalidParts) {
      setShowFinalizeConfirmation(false);
      setError('กรุณากรอกรายละเอียด หมายเหตุ และจำนวนอย่างน้อย 1 ในทุกแถวอะไหล่');
      return;
    }
    setIsFinalizing(true);
    setError(null);
    setSuccess(null);
    try {
      await onFinalize(toPatch(form));
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : 'ไม่สามารถสรุปผลใบรายงานได้'
      );
    } finally {
      setIsFinalizing(false);
      setShowFinalizeConfirmation(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-3 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            <X className="h-4 w-4" />
            กลับใบรายงาน
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              {report.reportNo}
            </h2>
            <ReportStatusBadge status="draft" />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            แก้ไขร่าง บันทึกงาน หรือสรุปผลเมื่อดำเนินการครบถ้วน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={onClose} className="px-4 py-2.5 text-sm">
            ยกเลิก
          </SecondaryButton>
          <PrimaryButton
            onClick={() => void validateAndSave()}
            disabled={isSaving || isFinalizing}
            className="px-4 py-2.5 text-sm"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
          </PrimaryButton>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-600 ring-1 ring-danger-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-2xl bg-success-50 px-4 py-3 text-sm text-success-700 ring-1 ring-success-200">
          {success}
        </div>
      ) : null}

      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold tracking-tight text-ink">
              สรุปงานบริการ / สินค้า
            </h2>
            <p className="text-sm text-neutral-500">
              ข้อมูลงานบริการสำหรับอ้างอิงเท่านั้น
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <SummaryValue label="เลขอ้างอิงงานบริการ" value={context.trackingReference} />
          <SummaryValue label="ลูกค้า" value={context.customerName} />
          <SummaryValue
            label="แบรนด์"
            value={`${context.brandName} (${context.brandCode})`}
          />
          <SummaryValue label="สินค้า" value={context.productName} />
          <SummaryValue label="รุ่น / SKU" value={context.modelOrSku ?? 'ไม่มีข้อมูล'} />
          <SummaryValue label="หมายเลขเครื่อง" value={context.serialNumber} />
        </div>
      </GlassCard>

      <FormSection
        icon={FileText}
        title="อาการที่ลูกค้าแจ้ง"
        subtitle="รายละเอียดจากลูกค้า"
      >
        <textarea
          value={form.customerReportedProblem}
          onChange={(event) => updateForm('customerReportedProblem', event.target.value)}
          rows={4}
          className={inputClass('resize-none')}
          placeholder="อธิบายอาการที่ลูกค้าแจ้ง…"
        />
      </FormSection>

      <FormSection
        icon={Wrench}
        title="ผลการตรวจสอบทางเทคนิค"
        subtitle="สิ่งที่พบจากการตรวจสอบและวินิจฉัย"
      >
        <textarea
          value={form.inspectionFindings}
          onChange={(event) => updateForm('inspectionFindings', event.target.value)}
          rows={5}
          className={inputClass('resize-none')}
          placeholder="บันทึกผลการตรวจสอบ…"
        />
      </FormSection>

      <FormSection
        icon={CheckCircle2}
        title="การดำเนินการบริการ"
        subtitle="เลือกการดำเนินการที่เกี่ยวข้องทั้งหมด"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SERVICE_ACTIONS.map((action) => {
            const selected = form.serviceActions.includes(action);
            return (
              <button
                key={action}
                type="button"
                onClick={() => toggleAction(action)}
                className={`flex min-h-12 items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors ${selected ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-300' : 'bg-neutral-50 text-neutral-600 ring-1 ring-black/5 hover:bg-neutral-100'}`}
              >
                {SERVICE_ACTION_LABELS[action]}
                {selected ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      </FormSection>

      <FormSection
        icon={Archive}
        title="อะไหล่"
        subtitle="บันทึกรายการเท่านั้น ไม่ใช่การจัดการคลัง"
      >
        <div className="space-y-3">
          {form.parts.map((part, index) => (
            <div
              key={`${index}-${part.partNo ?? 'part'}`}
              className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-black/5"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
                <input
                  value={part.description}
                  onChange={(event) =>
                    updatePart(index, 'description', event.target.value)
                  }
                  className={inputClass()}
                  placeholder="รายละเอียด"
                  aria-label={`รายละเอียดอะไหล่รายการที่ ${index + 1}`}
                />
                <input
                  value={part.partNo ?? ''}
                  onChange={(event) =>
                    updatePart(index, 'partNo', event.target.value || null)
                  }
                  className={inputClass()}
                  placeholder="เลขที่อะไหล่ (ถ้ามี)"
                  aria-label={`เลขที่อะไหล่รายการที่ ${index + 1}`}
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={part.quantity}
                  onChange={(event) =>
                    updatePart(index, 'quantity', Number(event.target.value))
                  }
                  className={inputClass()}
                  aria-label={`จำนวนอะไหล่รายการที่ ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() =>
                    updateForm(
                      'parts',
                      form.parts.filter((_, partIndex) => partIndex !== index)
                    )
                  }
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl px-3 text-danger-600 hover:bg-danger-50"
                  aria-label={`ลบอะไหล่รายการที่ ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                value={part.remark}
                onChange={(event) => updatePart(index, 'remark', event.target.value)}
                className={`${inputClass()} mt-3`}
                placeholder="หมายเหตุ"
                aria-label={`หมายเหตุอะไหล่รายการที่ ${index + 1}`}
              />
            </div>
          ))}
          {invalidParts ? (
            <p className="text-sm text-danger-600">
              ทุกแถวอะไหล่ต้องมีรายละเอียด หมายเหตุ และจำนวนเต็มที่มากกว่า 0
            </p>
          ) : null}
          <SecondaryButton
            onClick={() =>
              updateForm('parts', [
                ...form.parts,
                { description: '', partNo: null, quantity: 1, remark: '' },
              ])
            }
            className="px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" /> เพิ่มอะไหล่
          </SecondaryButton>
        </div>
      </FormSection>

      <FormSection
        icon={FileText}
        title="หมายเหตุจากช่าง"
        subtitle="ข้อมูลเพิ่มเติมสำหรับเจ้าหน้าที่"
      >
        <textarea
          value={form.technicianRemark}
          onChange={(event) => updateForm('technicianRemark', event.target.value)}
          rows={4}
          className={inputClass('resize-none')}
          placeholder="เพิ่มหมายเหตุจากช่าง…"
        />
      </FormSection>

      <FormSection icon={CheckCircle2} title="ผลลัพธ์" subtitle="บันทึกผลของใบรายงานนี้">
        <select
          value={form.resultStatus ?? ''}
          onChange={(event) =>
            updateForm(
              'resultStatus',
              event.target.value ? (event.target.value as ResultStatus) : null
            )
          }
          className={inputClass()}
        >
          <option value="">เลือกผลลัพธ์</option>
          {RESULT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {RESULT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <textarea
          value={form.resultDetail}
          onChange={(event) => updateForm('resultDetail', event.target.value)}
          rows={3}
          className={inputClass('resize-none')}
          placeholder="อธิบายผลลัพธ์…"
        />
      </FormSection>

      <FormSection
        icon={Paperclip}
        title="เลขเคลม / โรงงาน"
        subtitle="เลขอ้างอิง (ถ้ามี)"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input
            value={form.claimNo ?? ''}
            onChange={(event) => updateForm('claimNo', event.target.value || null)}
            className={inputClass()}
            placeholder="เลขที่เคลม"
          />
          <input
            value={form.factoryReference ?? ''}
            onChange={(event) =>
              updateForm('factoryReference', event.target.value || null)
            }
            className={inputClass()}
            placeholder="เลขอ้างอิงโรงงาน"
          />
        </div>
      </FormSection>

      <FormSection
        icon={Paperclip}
        title="หลักฐาน"
        subtitle="เลือกไฟล์แนบของงานบริการที่มีอยู่ ระบบจะบันทึกเฉพาะ ID"
      >
        <div className="space-y-2">
          {attachments.length === 0 ? (
            <p className="text-sm text-neutral-500">
              ไม่มีไฟล์แนบที่ใช้งานได้สำหรับงานบริการนี้
            </p>
          ) : null}
          {attachments.map((attachment) => {
            const selected = form.evidenceAttachmentIds.includes(attachment.id);
            return (
              <label
                key={attachment.id}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-sm ${selected ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-neutral-50 text-neutral-600 ring-1 ring-black/5'}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    updateForm(
                      'evidenceAttachmentIds',
                      selected
                        ? form.evidenceAttachmentIds.filter((id) => id !== attachment.id)
                        : [...form.evidenceAttachmentIds, attachment.id]
                    )
                  }
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">
                  {attachment.category}
                </span>
              </label>
            );
          })}
          {form.evidenceAttachmentIds
            .filter((id) => !availableAttachmentIds.has(id))
            .map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-2xl bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-warning-200"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  หลักฐานที่เลือกไว้ก่อนหน้าไม่พร้อมใช้งาน แต่จะยังคงอ้างอิงด้วย ID
                </span>
              </div>
            ))}
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 border-t border-black/5 pb-6 pt-2 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={onClose}>
          <X className="h-4 w-4" /> กลับใบรายงาน
        </SecondaryButton>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SecondaryButton
            onClick={() => void validateAndSave()}
            disabled={isSaving || isFinalizing}
          >
            <Save className="h-4 w-4" /> {isSaving ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => setShowFinalizeConfirmation(true)}
            disabled={isSaving || isFinalizing}
          >
            <LockKeyhole className="h-4 w-4" /> สรุปผลใบรายงาน
          </PrimaryButton>
        </div>
      </div>

      {showFinalizeConfirmation ? (
        <Modal title="สรุปผลใบรายงาน" onClose={() => setShowFinalizeConfirmation(false)}>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-neutral-600">
              ยืนยันว่าใบรายงานนี้ครบถ้วน การสรุปผลไม่สามารถย้อนกลับในหน้าจอเจ้าหน้าที่ได้
              ใบรายงานจะอ่านได้อย่างเดียวและเก็บ snapshot ทางประวัติไว้
              หากมีงานเพิ่มเติมภายหลัง ให้สร้างใบรายงานฉบับใหม่
            </p>
            <dl className="grid grid-cols-1 gap-3 rounded-2xl bg-neutral-50 p-4 text-sm ring-1 ring-black/5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  เลขที่ใบรายงาน
                </dt>
                <dd className="mt-1 font-semibold text-ink">{report.reportNo}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  งานบริการ / เลขติดตาม
                </dt>
                <dd className="mt-1 font-semibold text-ink">
                  {context.trackingReference}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  หลังยืนยัน
                </dt>
                <dd className="mt-1 text-neutral-600">
                  สรุปผลแล้ว · อ่านได้อย่างเดียว · เก็บ snapshot ประวัติแบบแก้ไขไม่ได้
                </dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setShowFinalizeConfirmation(false)}>
                ยกเลิก
              </SecondaryButton>
              <PrimaryButton
                onClick={() => void validateAndFinalize()}
                disabled={isFinalizing}
              >
                <LockKeyhole className="h-4 w-4" />{' '}
                {isFinalizing ? 'กำลังสรุปผล…' : 'ยืนยันการสรุปผล'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50 px-4 py-3 ring-1 ring-black/5">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-ink">{value || '—'}</p>
    </div>
  );
}

function ServiceReportReadOnly({
  report,
  serviceJob,
  attachments,
  onBack,
  onEdit,
}: {
  report: ServiceReport;
  serviceJob: ServiceJob;
  attachments: ServiceJobAttachmentOption[];
  onBack: () => void;
  onEdit?: () => void;
}) {
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const context = getReportDisplayContext(report, serviceJob);
  const attachmentNames = new Map(
    attachments.map((attachment) => [attachment.id, attachment.name])
  );
  if (showPrintPreview) {
    return (
      <ServiceReportPrintPreview
        report={report}
        serviceJob={serviceJob}
        attachments={attachments}
        onClose={() => setShowPrintPreview(false)}
      />
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-3 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            <X className="h-4 w-4" /> กลับใบรายงาน
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              {report.reportNo}
            </h2>
            <ReportStatusBadge status={report.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            สร้างเมื่อ {formatDate(report.createdAt)}
            {report.finalizedAt ? ` · สรุปผลเมื่อ ${formatDate(report.finalizedAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit ? (
            <SecondaryButton onClick={onEdit} className="px-4 py-2.5 text-sm">
              แก้ไขร่าง
            </SecondaryButton>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-500">
              <LockKeyhole className="h-3.5 w-3.5" /> สรุปผลแล้ว อ่านได้อย่างเดียว
            </div>
          )}
          <PrimaryButton
            onClick={() => setShowPrintPreview(true)}
            className="px-4 py-2.5 text-sm"
          >
            <Printer className="h-4 w-4" />
            ดูตัวอย่าง / พิมพ์
          </PrimaryButton>
        </div>
      </div>

      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-ink">สรุปงานบริการ / สินค้า</h2>
            <p className="text-sm text-neutral-500">
              {context.brandName} · {context.trackingReference}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <SummaryValue
            label="ลูกค้า"
            value={`${context.customerName} · ${context.customerPhone}`}
          />
          <SummaryValue label="สินค้า" value={context.productName} />
          <SummaryValue label="รุ่น / SKU" value={context.modelOrSku ?? 'ไม่มีข้อมูล'} />
          <SummaryValue label="หมายเลขเครื่อง" value={context.serialNumber} />
          <SummaryValue
            label="แบรนด์"
            value={`${context.brandName} (${context.brandCode})`}
          />
          <SummaryValue label="เลขอ้างอิงงานบริการ" value={context.trackingReference} />
        </div>
      </GlassCard>

      <ReadOnlyReportSection
        title="อาการที่ลูกค้าแจ้ง"
        value={report.customerReportedProblem}
      />
      <ReadOnlyReportSection
        title="ผลการตรวจสอบทางเทคนิค"
        value={report.inspectionFindings}
      />
      <GlassCard className="p-6">
        <h3 className="mb-4 font-semibold text-ink">การดำเนินการบริการ</h3>
        <div className="flex flex-wrap gap-2">
          {report.serviceActions.length > 0 ? (
            report.serviceActions.map((action) => (
              <span
                key={action}
                className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
              >
                {SERVICE_ACTION_LABELS[action]}
              </span>
            ))
          ) : (
            <span className="text-sm text-neutral-400">
              ยังไม่มีการบันทึกการดำเนินการ
            </span>
          )}
        </div>
      </GlassCard>
      <GlassCard className="p-6">
        <h3 className="mb-4 font-semibold text-ink">อะไหล่</h3>
        {report.parts.length > 0 ? (
          <div className="space-y-2">
            {report.parts.map((part, index) => (
              <div
                key={`${index}-${part.partNo ?? 'part'}`}
                className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm ring-1 ring-black/5"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-ink">{part.description}</span>
                  <span className="text-neutral-500">จำนวน {part.quantity}</span>
                </div>
                <p className="mt-1 text-neutral-500">
                  {part.partNo ? `${part.partNo} · ` : ''}
                  {part.remark}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">ยังไม่มีการบันทึกอะไหล่</p>
        )}
      </GlassCard>
      <ReadOnlyReportSection title="หมายเหตุจากช่าง" value={report.technicianRemark} />
      <GlassCard className="p-6">
        <h3 className="mb-4 font-semibold text-ink">Result</h3>
        <p className="font-medium text-ink">
          {report.resultStatus
            ? RESULT_STATUS_LABELS[report.resultStatus]
            : 'ยังไม่มีการบันทึกผลลัพธ์'}
        </p>
        {report.resultDetail ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
            {report.resultDetail}
          </p>
        ) : null}
      </GlassCard>
      <GlassCard className="p-6">
        <h3 className="mb-4 font-semibold text-ink">เลขเคลม / โรงงาน</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SummaryValue label="เลขที่เคลม" value={report.claimNo ?? '—'} />
          <SummaryValue label="เลขอ้างอิงโรงงาน" value={report.factoryReference ?? '—'} />
        </div>
      </GlassCard>
      <GlassCard className="p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-ink">
          <Paperclip className="h-4 w-4" /> หลักฐาน
        </h3>
        {report.evidenceAttachmentIds.length > 0 ? (
          <div className="space-y-2">
            {report.evidenceAttachmentIds.map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-2xl bg-neutral-50 px-4 py-3 text-sm ring-1 ring-black/5"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-neutral-400" />
                <span>{attachmentNames.get(id) ?? 'ไฟล์แนบไม่พร้อมใช้งาน'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">ยังไม่ได้เลือกหลักฐาน</p>
        )}
      </GlassCard>
    </div>
  );
}

function ReadOnlyReportSection({ title, value }: { title: string; value: string }) {
  return (
    <GlassCard className="p-6">
      <h3 className="mb-3 font-semibold text-ink">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-700">
        {value || 'ยังไม่มีการบันทึกข้อมูล'}
      </p>
    </GlassCard>
  );
}
