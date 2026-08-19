import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Package,
  Tag,
  Wrench,
  CalendarClock,
  ShieldCheck,
  Check,
  MessageSquarePlus,
  Printer,
  Send,
  AlertTriangle,
  SearchX,
} from 'lucide-react';
import {
  getBrandDisplayLabel,
  type ServiceJob,
  type ServiceJobStatus,
} from '../../../types';
import { useServiceJobs } from '../../../hooks/useServiceJobs';
import { useUpdateServiceJob } from '../../../hooks/useUpdateServiceJob';
import { useIssuePublicTrackingCode } from '../../../hooks/useIssuePublicTrackingCode';
import { technicians } from '../../../repositories/mockData/serviceJobs.mock';
import {
  StatusBadge,
  PriorityPill,
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  Row,
  Timeline,
  PhotoGallery,
  ProgressBar,
  EmptyState,
  PageContainer,
  AsyncErrorAlert,
} from '../../../shared/components';
import {
  DeliveryNotePrintPreview,
  ServiceReportsSection,
  ServiceEventMetadataEditSection,
  type ServiceEventMetadataEditValue,
  PublicTrackingSection,
} from '../components';
import { serviceEventMetadataDraftError } from '../../../validation';
import {
  formatCurrencyTHB,
  formatDate,
  formatDateShort,
  toIsoDate,
} from '../../../utils/formatDate';
import { ROUTES, SERVICE_JOB_STATUSES } from '../../../constants';
import { backendKind } from '../../../config/backend';
import { useAuthSession } from '../../../auth/authSessionContext';
import { statusLabel } from '../../../services/serviceJobPresentation';
import {
  buildCustomerNotificationMessage,
  shareCustomerNotification,
} from '../../../services/customerNotificationShare';
import { serviceJobUpdateErrorMessage } from '../serviceJobErrorMessages';

export function ServiceJobDetails() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { serviceJobs } = useServiceJobs();
  const claim = serviceJobs.find((job) => job.id === id);

  if (!claim) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <EmptyState
          icon={SearchX}
          title="ไม่พบงานบริการ"
          description={
            <>
              ไม่พบงานบริการที่ตรงกับ <span className="font-semibold text-ink">{id}</span>
              .
            </>
          }
          action={
            <PrimaryButton className="mt-8" onClick={() => navigate(ROUTES.serviceJobs)}>
              กลับไปงานบริการทั้งหมด
            </PrimaryButton>
          }
        />
      </div>
    );
  }

  return (
    <ServiceJobDetailsView
      claim={claim}
      onBack={() => navigate(ROUTES.serviceJobs)}
      onDone={() => navigate(ROUTES.dashboard)}
    />
  );
}

function ServiceJobDetailsView({
  claim,
  onBack,
  onDone,
}: {
  claim: ServiceJob;
  onBack: () => void;
  onDone: () => void;
}) {
  const { updateServiceJob } = useUpdateServiceJob();
  const { issuePublicTrackingCode, readServiceJob } = useIssuePublicTrackingCode();
  const { user } = useAuthSession();
  const canReassignTechnician = backendKind === 'mock';
  const [status, setStatus] = useState<ServiceJobStatus>(claim.status);
  const [tech, setTech] = useState(claim.technician);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState(claim.notes);
  // F5d-69 / DECISIONS.md #041 — one local draft object mirroring
  // ServiceEventMetadataEditValue exactly, initialized from the persisted
  // ServiceJob (null fields become '' for controlled inputs, matching
  // ServiceIntakeData's own string-not-null convention — see its comment).
  const [eventMetadata, setEventMetadata] = useState<ServiceEventMetadataEditValue>({
    contactChannel: claim.contactChannel,
    contactChannelIdentity: claim.contactChannelIdentity ?? '',
    orderNumber: claim.orderNumber ?? '',
    orderVerification: claim.orderVerification,
    purchaseDate: claim.purchaseDate ?? '',
    orderDeliveredDate: claim.orderDeliveredDate ?? '',
    externalEvidenceUrl: claim.externalEvidenceUrl ?? '',
    externalEvidenceNote: claim.externalEvidenceNote ?? '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeliveryNotePreview, setShowDeliveryNotePreview] = useState(false);
  // F5d-69G Phase 7A — the plaintext SRV only ever exists in
  // PublicTrackingSection's own local state (never persisted, never
  // re-derivable from `claim`). Lifting it here — the nearest common parent
  // of PublicTrackingSection and the delivery-note print branch below — is
  // the smallest in-memory handoff that survives the print toggle (a
  // conditional render within this same mounted component, not a route
  // change) while still disappearing on any real remount (refresh/reopen).
  const [issuedTrackingCode, setIssuedTrackingCode] = useState<string | null>(null);
  const [notificationFeedback, setNotificationFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const deliveryNoteTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreDeliveryNoteFocus = useRef(false);

  useEffect(() => {
    if (showDeliveryNotePreview || !shouldRestoreDeliveryNoteFocus.current) return;
    shouldRestoreDeliveryNoteFocus.current = false;
    deliveryNoteTriggerRef.current?.focus();
  }, [showDeliveryNotePreview]);

  const saveChanges = async () => {
    if (isSaving) return;
    setSaveError(null);
    // F5d-69 — blocks on a genuinely invalid entered date/URL before ever
    // reaching Firestore; a blank value is never an error here (every one
    // of these fields is optional).
    const metadataError = serviceEventMetadataDraftError(eventMetadata);
    if (metadataError) {
      setSaveError(metadataError);
      return;
    }
    setIsSaving(true);
    try {
      await updateServiceJob(claim.id, {
        status,
        notes,
        ...(canReassignTechnician ? { technician: tech } : {}),
        contactChannel: eventMetadata.contactChannel,
        contactChannelIdentity: eventMetadata.contactChannelIdentity.trim() || null,
        orderNumber: eventMetadata.orderNumber.trim() || null,
        orderVerification: eventMetadata.orderVerification,
        purchaseDate: eventMetadata.purchaseDate || null,
        orderDeliveredDate: eventMetadata.orderDeliveredDate || null,
        externalEvidenceUrl: eventMetadata.externalEvidenceUrl.trim() || null,
        externalEvidenceNote: eventMetadata.externalEvidenceNote.trim() || null,
      });
      onDone();
    } catch (error) {
      setSaveError(serviceJobUpdateErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const addNote = () => {
    if (!note.trim()) return;
    setNotes((n) => [
      ...n,
      {
        author: user?.email ?? 'เจ้าหน้าที่',
        date: toIsoDate(new Date()),
        text: note.trim(),
      },
    ]);
    setNote('');
  };

  const notifyCustomer = async () => {
    setNotificationFeedback(null);
    try {
      const result = await shareCustomerNotification(
        buildCustomerNotificationMessage(claim)
      );
      if (result === 'cancelled') return;
      setNotificationFeedback({
        tone: 'success',
        message: result === 'shared' ? 'แชร์ข้อความแล้ว' : 'คัดลอกข้อความแล้ว',
      });
    } catch {
      setNotificationFeedback({
        tone: 'error',
        message: 'ไม่สามารถแชร์หรือคัดลอกข้อความได้ กรุณาลองอีกครั้ง',
      });
    }
  };

  if (showDeliveryNotePreview) {
    return (
      <DeliveryNotePrintPreview
        job={claim}
        publicTrackingCode={issuedTrackingCode ?? undefined}
        onClose={() => {
          shouldRestoreDeliveryNoteFocus.current = true;
          setShowDeliveryNotePreview(false);
        }}
      />
    );
  }

  return (
    <PageContainer maxWidthClassName="max-w-5xl" className="service-job-details-page">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 animate-[fade-in_0.4s_ease_both]"
      >
        <ArrowLeft className="h-4 w-4" />
        กลับงานบริการทั้งหมด
      </button>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {claim.id}
            </h1>
            <PriorityPill priority={claim.priority} />
          </div>
          <p className="mt-1 text-lg text-neutral-500">{claim.product}</p>
          {claim.brandId ? (
            <p className="mt-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
              {getBrandDisplayLabel(claim.brandId)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            ref={deliveryNoteTriggerRef}
            onClick={() => setShowDeliveryNotePreview(true)}
            className="px-4 py-2.5 text-sm"
          >
            <Printer className="h-4 w-4" />
            พิมพ์ใบนำส่ง
          </SecondaryButton>
          <PrimaryButton
            onClick={() => void notifyCustomer()}
            className="px-4 py-2.5 text-sm"
          >
            <Send className="h-4 w-4" />
            แจ้งลูกค้า
          </PrimaryButton>
        </div>
      </div>
      {notificationFeedback ? (
        <p
          role="status"
          className={`text-sm ${
            notificationFeedback.tone === 'error' ? 'text-danger-600' : 'text-success-700'
          }`}
        >
          {notificationFeedback.message}
        </p>
      ) : null}

      {/* Progress */}
      <GlassCard className="p-5 animate-[rise_0.45s_cubic-bezier(0.22,1,0.36,1)_both]">
        <ProgressBar events={claim.timeline} />
      </GlassCard>

      <div className="service-report-section-host">
        <ServiceReportsSection serviceJob={claim} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: timeline + notes */}
        <div className="space-y-6 lg:col-span-2">
          {/* Status control */}
          <GlassCard className="p-6 animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                อัปเดตสถานะ
              </h2>
              <StatusBadge status={status} size="sm" />
            </div>
            <fieldset>
              <legend className="sr-only">เลือกสถานะงานบริการ</legend>
              <div className="flex flex-wrap gap-2">
                {SERVICE_JOB_STATUSES.map((s) => (
                  <label key={s} className="cursor-pointer">
                    <input
                      type="radio"
                      name="service-job-status"
                      value={s}
                      checked={status === s}
                      onChange={() => setStatus(s)}
                      className="peer sr-only"
                    />
                    <span
                      className={`block rounded-full px-4 py-2 text-sm font-medium transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 peer-focus-visible:ring-offset-2 ${
                        status === s
                          ? 'bg-brand-500 text-white shadow-sm'
                          : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
                      }`}
                    >
                      {statusLabel(s)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </GlassCard>

          {/* Timeline */}
          <GlassCard className="p-6 sm:p-8 animate-[rise_0.55s_cubic-bezier(0.22,1,0.36,1)_both]">
            <h2 className="mb-5 text-lg font-semibold tracking-tight text-ink">
              ประวัติการดำเนินงาน
            </h2>
            <Timeline events={claim.timeline} />
          </GlassCard>

          {/* Notes */}
          <GlassCard className="p-6 animate-[rise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]">
            <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink">
              หมายเหตุภายใน
            </h2>
            <div className="space-y-3">
              {notes.map((n, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-black/5"
                >
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                    <span className="font-medium text-neutral-600">{n.author}</span>
                    <span>{formatDateShort(n.date)}</span>
                  </div>
                  <p className="text-sm text-neutral-700">{n.text}</p>
                </div>
              ))}
              {notes.length === 0 && (
                <p className="text-sm text-neutral-400">ยังไม่มีหมายเหตุ</p>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="service-job-team-note" className="sr-only">
                เพิ่มหมายเหตุสำหรับทีม
              </label>
              <input
                id="service-job-team-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                placeholder="เพิ่มหมายเหตุสำหรับทีม…"
                className="flex-1 rounded-2xl bg-white/80 px-4 py-3 text-sm ring-1 ring-black/10 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                onClick={addNote}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                <MessageSquarePlus className="h-4 w-4" />
                เพิ่ม
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Right: info + photos */}
        <div className="space-y-6">
          {/* Photos */}
          <PhotoGallery
            photos={claim.photos}
            alt={claim.product}
            aspectRatio="aspect-[4/3]"
            animationClassName="animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]"
          />

          {/* Product info */}
          <GlassCard className="p-5 animate-[rise_0.55s_cubic-bezier(0.22,1,0.36,1)_both]">
            <h3 className="mb-3 font-semibold text-ink">สินค้า</h3>
            <div className="space-y-3 text-sm">
              <Row icon={Package} label="สินค้า">
                {claim.product}
              </Row>
              <Row icon={Tag} label="หมวดหมู่">
                {claim.productCategory}
              </Row>
              <Row icon={Tag} label="หมายเลขเครื่อง">
                {claim.serialNumber}
              </Row>
              <Row icon={AlertTriangle} label="อาการปัญหา">
                {claim.issue}
              </Row>
              <Row icon={ShieldCheck} label="การรับประกัน">
                {claim.warranty ? 'อยู่ในระยะรับประกัน' : 'อยู่นอกระยะรับประกัน'}
              </Row>
              {claim.quote !== undefined ? (
                <Row icon={Tag} label="ราคาประเมิน">
                  {formatCurrencyTHB(claim.quote)}
                </Row>
              ) : null}
            </div>
          </GlassCard>

          {/* Assignment */}
          <GlassCard className="p-5 animate-[rise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]">
            <h3 className="mb-3 font-semibold text-ink">การมอบหมายงาน</h3>
            <div className="space-y-3 text-sm">
              <Row icon={Wrench} label="ช่างผู้รับผิดชอบ">
                {canReassignTechnician ? (
                  <select
                    value={tech}
                    onChange={(e) => setTech(e.target.value)}
                    className="rounded-xl bg-white/80 px-3 py-2 text-sm text-ink ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    {technicians.map((technician) => (
                      <option key={technician}>{technician}</option>
                    ))}
                  </select>
                ) : (
                  claim.technician || 'ยังไม่มอบหมาย'
                )}
              </Row>
              <Row icon={CalendarClock} label="กำหนดเสร็จโดยประมาณ">
                {formatDate(claim.estimatedCompletion)}
              </Row>
              <Row icon={CalendarClock} label="สร้างเมื่อ">
                {formatDate(claim.createdAt)}
              </Row>
            </div>
            {!canReassignTechnician ? (
              <p className="mt-4 rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500 ring-1 ring-black/5">
                การเปลี่ยนช่างผู้รับผิดชอบยังไม่พร้อมใช้งานในระบบจริง
              </p>
            ) : null}
          </GlassCard>

          {/* Customer */}
          <GlassCard className="p-5 animate-[rise_0.65s_cubic-bezier(0.22,1,0.36,1)_both]">
            <h3 className="mb-3 font-semibold text-ink">ลูกค้า</h3>
            <div className="space-y-3 text-sm">
              <Row icon={User} label="ชื่อ">
                {claim.customerName}
              </Row>
              <Row icon={Phone} label="โทรศัพท์">
                {claim.customerPhone}
              </Row>
              <Row icon={Mail} label="อีเมล">
                {claim.customerEmail}
              </Row>
            </div>
          </GlassCard>
        </div>
      </div>

      <ServiceEventMetadataEditSection value={eventMetadata} onChange={setEventMetadata} />

      <PublicTrackingSection
        job={claim}
        onIssue={issuePublicTrackingCode}
        onRefreshJob={readServiceJob}
        onIssued={setIssuedTrackingCode}
      />

      {/* Bottom actions */}
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:justify-between animate-[fade-in_0.6s_ease_both]">
        <SecondaryButton onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          งานบริการทั้งหมด
        </SecondaryButton>
        <PrimaryButton onClick={() => void saveChanges()} disabled={isSaving}>
          <Check className="h-5 w-5" />
          {isSaving ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}
        </PrimaryButton>
      </div>
      <AsyncErrorAlert message={saveError} className="pb-4" />
    </PageContainer>
  );
}
