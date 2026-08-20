import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { notesEqual, reconcileField } from '../../../services/serviceJobDraftReconciliation';

// F5d-70 Phase 5B — the single place claim -> local-draft-shape mapping is
// defined, used to seed the initial local draft on mount.
function eventMetadataFromClaim(claim: ServiceJob): ServiceEventMetadataEditValue {
  return {
    contactChannel: claim.contactChannel,
    contactChannelIdentity: claim.contactChannelIdentity ?? '',
    orderNumber: claim.orderNumber ?? '',
    orderVerification: claim.orderVerification,
    purchaseDate: claim.purchaseDate ?? '',
    orderDeliveredDate: claim.orderDeliveredDate ?? '',
    externalEvidenceUrl: claim.externalEvidenceUrl ?? '',
    externalEvidenceNote: claim.externalEvidenceNote ?? '',
  };
}

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
    // F5d-70 Phase 5B.1 — keyed by business entity identity (claim.id)
    // only, never by anything that changes on an ordinary same-job update
    // (dataVersion, publicTrackingCodeHash, status, updatedAt, or claim's
    // own object identity, which F5d-70's reactivity churns on every
    // unrelated Service Job's change too). React unmounts/remounts this
    // whole subtree — destroying every local draft and the transient
    // plaintext SRV — only when the identity itself changes; an ordinary
    // refresh of the SAME job never does, because the key doesn't change.
    // This is the actual entity boundary: a passive reset effect can only
    // ever run AFTER a render has already committed with the wrong
    // job's local state attached to the new job's id, which is exactly
    // what independent review found exploitable. A key change instead
    // tears down and rebuilds the subtree atomically as part of one
    // commit — there is no render in between where old-entity state and
    // new-entity identity coexist.
    <ServiceJobDetailsView
      key={claim.id}
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
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // F5d-69 / DECISIONS.md #041 — one local draft object mirroring
  // ServiceEventMetadataEditValue exactly, initialized from the persisted
  // ServiceJob (null fields become '' for controlled inputs, matching
  // ServiceIntakeData's own string-not-null convention — see its comment).
  const [eventMetadata, setEventMetadata] = useState<ServiceEventMetadataEditValue>(() =>
    eventMetadataFromClaim(claim)
  );
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

  // F5d-70 Phase 5B.1 — draft reconciliation for the SAME entity only. The
  // entity boundary itself is no longer this effect's job: ServiceJobDetails()
  // now renders this component with `key={claim.id}` (see below), so a
  // genuinely different Service Job always arrives via a fresh mount — the
  // `previous.id !== claim.id` branch this effect used to special-case can
  // never actually fire anymore (a new mounted instance's very first
  // `previousClaimRef` value is, by construction, that same instance's
  // first `claim`), and keeping it around as apparently-live code was
  // exactly the kind of "passive effect provides credential isolation"
  // design independent review correctly rejected. Removed rather than left
  // as dead code, per "prefer the simplest lifecycle / don't maintain two
  // conflicting mechanisms for the same boundary".
  //
  // This runs as useLayoutEffect (not useEffect): react-hooks/refs still
  // permits reading/writing a ref from either effect timing (only render
  // itself is restricted), and running synchronously after the DOM commit
  // but BEFORE the browser paints closes the exact timing window
  // independent review flagged — a fresh `claim` can never be visible
  // on-screen alongside not-yet-rebased pristine local state, because
  // nothing paints between the commit and this effect running. Purely
  // client-side SPA (no SSR render of this component anywhere in this
  // codebase), so useLayoutEffect carries no hydration-mismatch risk here.
  //
  // `claim` gets a brand new object reference on every F5d-70 dataVersion
  // re-render — including ones triggered by a completely unrelated Service
  // Job changing — so every comparison below is by VALUE against the
  // previous claim (never by reference), and every branch is a no-op
  // unless something actually changed for a field/group that is currently
  // pristine. Every metadata comparison reads `current` from inside
  // setEventMetadata's functional updater (never the outer `eventMetadata`
  // closure), and status/notes/technician use the same functional-updater
  // form, so `claim`/`canReassignTechnician` are the only real dependencies
  // — no stale-closure risk, and this effect never re-fires from the
  // user's own edits, never writes the repository, and never bumps
  // dataVersion.
  const previousClaimRef = useRef(claim);
  useLayoutEffect(() => {
    const previous = previousClaimRef.current;
    if (previous === claim) return;
    previousClaimRef.current = claim;

    setStatus((current) => reconcileField(current, previous.status, claim.status));
    setNotes((current) => reconcileField(current, previous.notes, claim.notes, notesEqual));
    if (canReassignTechnician) {
      setTech((current) => reconcileField(current, previous.technician, claim.technician));
    }
    setEventMetadata((current) => {
      const contactPristine =
        current.contactChannel === previous.contactChannel &&
        current.contactChannelIdentity === (previous.contactChannelIdentity ?? '');
      const orderPristine =
        current.orderNumber === (previous.orderNumber ?? '') &&
        current.orderVerification === previous.orderVerification;
      const purchaseDatePristine = current.purchaseDate === (previous.purchaseDate ?? '');
      const orderDeliveredDatePristine =
        current.orderDeliveredDate === (previous.orderDeliveredDate ?? '');
      const evidenceUrlPristine =
        current.externalEvidenceUrl === (previous.externalEvidenceUrl ?? '');
      const evidenceNotePristine =
        current.externalEvidenceNote === (previous.externalEvidenceNote ?? '');
      if (
        !contactPristine &&
        !orderPristine &&
        !purchaseDatePristine &&
        !orderDeliveredDatePristine &&
        !evidenceUrlPristine &&
        !evidenceNotePristine
      ) {
        return current;
      }
      return {
        contactChannel: contactPristine ? claim.contactChannel : current.contactChannel,
        contactChannelIdentity: contactPristine
          ? (claim.contactChannelIdentity ?? '')
          : current.contactChannelIdentity,
        orderNumber: orderPristine ? (claim.orderNumber ?? '') : current.orderNumber,
        orderVerification: orderPristine ? claim.orderVerification : current.orderVerification,
        purchaseDate: purchaseDatePristine ? (claim.purchaseDate ?? '') : current.purchaseDate,
        orderDeliveredDate: orderDeliveredDatePristine
          ? (claim.orderDeliveredDate ?? '')
          : current.orderDeliveredDate,
        externalEvidenceUrl: evidenceUrlPristine
          ? (claim.externalEvidenceUrl ?? '')
          : current.externalEvidenceUrl,
        externalEvidenceNote: evidenceNotePristine
          ? (claim.externalEvidenceNote ?? '')
          : current.externalEvidenceNote,
      };
    });
  }, [claim, canReassignTechnician]);

  useEffect(() => {
    if (showDeliveryNotePreview || !shouldRestoreDeliveryNoteFocus.current) return;
    shouldRestoreDeliveryNoteFocus.current = false;
    deliveryNoteTriggerRef.current?.focus();
  }, [showDeliveryNotePreview]);

  const saveChanges = async () => {
    // F5d-70 Phase 6F.4 — mutual exclusion with Quick Add: without this,
    // a pending notes-only write and a page-level Save could both be
    // in flight together, letting Save navigate away while Quick Add's
    // continuation still runs against an unmounted component (its error,
    // if any, becomes invisible and the note is silently lost).
    if (isSaving || isAddingNote) return;
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
      // F5d-70 Phase 5B — dirty-only patch: a field/group is included only
      // when the local draft has actually diverged from the newest
      // persisted claim (mirrors the same comparisons the reconciliation
      // block above uses to decide what stays pristine). Sending only
      // dirty fields, combined with the repository's existing
      // {...current, ...patch} merge, is what makes "remote status
      // changes + local notes dirty -> save updates notes only" true.
      const statusDirty = status !== claim.status;
      const notesDirty = !notesEqual(notes, claim.notes);
      const techDirty = canReassignTechnician && tech !== claim.technician;
      const contactDirty =
        eventMetadata.contactChannel !== claim.contactChannel ||
        eventMetadata.contactChannelIdentity !== (claim.contactChannelIdentity ?? '');
      const orderDirty =
        eventMetadata.orderNumber !== (claim.orderNumber ?? '') ||
        eventMetadata.orderVerification !== claim.orderVerification;
      const purchaseDateDirty = eventMetadata.purchaseDate !== (claim.purchaseDate ?? '');
      const orderDeliveredDateDirty =
        eventMetadata.orderDeliveredDate !== (claim.orderDeliveredDate ?? '');
      const externalEvidenceUrlDirty =
        eventMetadata.externalEvidenceUrl !== (claim.externalEvidenceUrl ?? '');
      const externalEvidenceNoteDirty =
        eventMetadata.externalEvidenceNote !== (claim.externalEvidenceNote ?? '');
      const anyDirty =
        statusDirty ||
        notesDirty ||
        techDirty ||
        contactDirty ||
        orderDirty ||
        purchaseDateDirty ||
        orderDeliveredDateDirty ||
        externalEvidenceUrlDirty ||
        externalEvidenceNoteDirty;

      // F5d-70 Phase 5B.1 — nothing to save: skip the repository call
      // entirely (no Firestore transaction, no updatedAt bump, no
      // dataVersion bump merely from clicking Save). The existing
      // completion behavior (navigate to dashboard) still runs — clicking
      // Save with no changes is a no-op mutation, not an error.
      if (!anyDirty) {
        onDone();
        return;
      }

      await updateServiceJob(claim.id, {
        ...(statusDirty ? { status } : {}),
        ...(notesDirty ? { notes } : {}),
        ...(techDirty ? { technician: tech } : {}),
        ...(contactDirty
          ? {
              contactChannel: eventMetadata.contactChannel,
              contactChannelIdentity: eventMetadata.contactChannelIdentity.trim() || null,
            }
          : {}),
        ...(orderDirty
          ? {
              orderNumber: eventMetadata.orderNumber.trim() || null,
              orderVerification: eventMetadata.orderVerification,
            }
          : {}),
        ...(purchaseDateDirty ? { purchaseDate: eventMetadata.purchaseDate || null } : {}),
        ...(orderDeliveredDateDirty
          ? { orderDeliveredDate: eventMetadata.orderDeliveredDate || null }
          : {}),
        ...(externalEvidenceUrlDirty
          ? { externalEvidenceUrl: eventMetadata.externalEvidenceUrl.trim() || null }
          : {}),
        ...(externalEvidenceNoteDirty
          ? { externalEvidenceNote: eventMetadata.externalEvidenceNote.trim() || null }
          : {}),
      });
      onDone();
    } catch (error) {
      setSaveError(serviceJobUpdateErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  // F5d-70 Phase 6F.2 — "เพิ่ม" persists immediately: production acceptance
  // found the prior draft-only append (visually complete, no repository
  // call) silently lost notes on reload/navigation before the page-level
  // Save. This sends ONLY { notes: nextNotes } — never saveChanges()'s
  // full dirty patch — so unrelated in-progress edits (status, technician,
  // event metadata) stay local and dirty, untouched by this call and by
  // the same-job reconciliation effect above once claim.notes reflects it.
  const addNote = async () => {
    // F5d-70 Phase 6F.4 — mutual exclusion with global Save: without this,
    // Quick Add could begin while a page-level Save is mid-flight, so its
    // success continuation (setNotes/setNote) could run after Save has
    // already navigated away via onDone().
    if (isAddingNote || isSaving) return;
    const text = note.trim();
    if (!text) return;
    setIsAddingNote(true);
    setNoteError(null);
    const nextNotes = [
      ...notes,
      {
        author: user?.email ?? 'เจ้าหน้าที่',
        date: toIsoDate(new Date()),
        text,
      },
    ];
    try {
      await updateServiceJob(claim.id, { notes: nextNotes });
      setNotes(nextNotes);
      setNote('');
    } catch (error) {
      setNoteError(serviceJobUpdateErrorMessage(error));
    } finally {
      setIsAddingNote(false);
    }
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
                onKeyDown={(e) => e.key === 'Enter' && void addNote()}
                placeholder="เพิ่มหมายเหตุสำหรับทีม…"
                disabled={isAddingNote || isSaving}
                className="flex-1 rounded-2xl bg-white/80 px-4 py-3 text-sm ring-1 ring-black/10 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                onClick={() => void addNote()}
                disabled={isAddingNote || isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <MessageSquarePlus className="h-4 w-4" />
                {isAddingNote ? 'กำลังเพิ่ม…' : 'เพิ่ม'}
              </button>
            </div>
            <AsyncErrorAlert message={noteError} className="mt-2" />
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
        <PrimaryButton onClick={() => void saveChanges()} disabled={isSaving || isAddingNote}>
          <Check className="h-5 w-5" />
          {isSaving ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}
        </PrimaryButton>
      </div>
      <AsyncErrorAlert message={saveError} className="pb-4" />
    </PageContainer>
  );
}
