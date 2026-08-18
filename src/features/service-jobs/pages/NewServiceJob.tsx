import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import type {
  CustomerSearchResult,
  RegisteredProduct,
  ServiceIntakeData,
  ServiceJob,
} from '../../../types';
import type { IntakeCustomer } from '../../../services/serviceJobCreation';
import {
  buildCustomerIntakeSelector,
  buildServiceJobIntakePayload,
  estimateIntakeRequestBytes,
  MAX_INTAKE_REQUEST_SAFE_BYTES,
} from '../../../services/serviceJobCreation';
import {
  UniversalSearch,
  CustomerSummaryCard,
  ProductSelection,
  ProductSummaryCard,
  FormSection,
  PrimaryButton,
  PageContainer,
  AsyncErrorAlert,
} from '../../../shared/components';
import {
  ServiceIntakeSection,
  ServiceRequestPrintPreview,
  NewCustomerForm,
  NewCustomerSummaryCard,
} from '../components';
import { ROUTES, createEmptyServiceIntake } from '../../../constants';
import { isServiceIntakeComplete, serviceIntakeMetadataError } from '../../../validation';
import { useCreateServiceJob } from '../../../hooks/useCreateServiceJob';
import { useServiceJobs } from '../../../hooks/useServiceJobs';
import {
  serviceJobCreateErrorMessage,
  serviceJobIntakeTooLargeMessage,
} from '../serviceJobErrorMessages';
import { photoValidationErrorMessage } from '../photoEvidenceErrorMessages';
import { validatePhotosForSubmission } from '../../../services/imageEvidenceProcessing';
import { normalizeCanonicalPhone } from '../../../repositories/canonicalPhone';
import { mostRecentJobWithContactChannel } from '../../../services/serviceJobHistory';

// F5d-49D (Terra P2 UX honesty follow-up) — same rationale as
// SearchInput.tsx. F5d-69 closed the Firestore-mode gap this used to branch
// around (DECISIONS.md #041), so this prompt is the same in both modes now.
const START_SEARCH_PROMPT =
  'เริ่มจากค้นหาลูกค้า — ค้นหาด้วยชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง';

export function NewServiceJob() {
  const navigate = useNavigate();
  const { createServiceJob } = useCreateServiceJob();
  const { serviceJobs } = useServiceJobs();

  const [selectedCustomer, setSelectedCustomer] = useState<IntakeCustomer | null>(null);
  // F5d-65 — a separate step, not a modal: search stays visible-then-replaced
  // by the inline form, matching how a picked search result already replaces
  // UniversalSearch with CustomerSummaryCard below.
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomerQuery, setNewCustomerQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<RegisteredProduct | null>(null);
  const [intake, setIntake] = useState<ServiceIntakeData>(createEmptyServiceIntake);
  const [savedJob, setSavedJob] = useState<ServiceJob | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const successPreviewRef = useRef<HTMLDivElement>(null);

  // Fires once right after a save, once the print preview has actually
  // committed to the DOM — matches "Save & Print" being one action, with
  // "Print Again" below for any reprint after this first automatic one.
  //
  // F5d-68 Phase 3A — the classList.add() call here is a deterministic
  // pre-print safety guarantee, not a duplicate of the lifecycle owner.
  // ServiceRequestPrintPreview's own mount/cleanup effect remains
  // responsible for service-request-print-mode's lifecycle for as long as
  // the preview exists (React's child-before-parent passive-effect commit
  // order already makes that effect run first, so this add() is normally a
  // harmless idempotent no-op) — but a production print path should not
  // have to rest on that ordering being load-bearing. Calling add() again
  // here, synchronously and unconditionally right before window.print(),
  // makes the very first automatic print correct regardless of effect
  // ordering, with zero risk: classList.add() of an already-present token
  // is a no-op.
  useEffect(() => {
    if (savedJob) {
      document.body.classList.add('service-request-print-mode');
      successPreviewRef.current?.focus({ preventScroll: true });
      window.print();
    }
  }, [savedJob]);

  // F5d-69 / DECISIONS.md #041 — canonical customer-level channel storage
  // does not exist; the most recent known channel is derived in memory from
  // this customer's own real Service Job history (never fabricated, never
  // written to the customer document) and only ever prefills this new
  // intake draft — staff may freely change it, and doing so affects only
  // this Service Job's own snapshot, never the historical jobs it was
  // derived from.
  const selectExistingCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer({ kind: 'existing', ...customer });
    const phone = normalizeCanonicalPhone(customer.phone);
    const priorJob = phone
      ? mostRecentJobWithContactChannel(
          serviceJobs.filter((job) => normalizeCanonicalPhone(job.customerPhone) === phone)
        )
      : null;
    if (priorJob?.contactChannel) {
      setIntake((current) => ({
        ...current,
        contactChannel: priorJob.contactChannel,
        contactChannelIdentity: priorJob.contactChannelIdentity ?? '',
      }));
    }
  };

  const startCreatingCustomer = (query: string) => {
    setNewCustomerQuery(query);
    setIsCreatingCustomer(true);
  };

  const confirmNewCustomer = (draft: { name: string; phone: string; email: string }) => {
    setSelectedCustomer({ kind: 'new', ...draft });
    setIsCreatingCustomer(false);
  };

  const changeCustomer = () => {
    setSelectedCustomer(null);
    setIsCreatingCustomer(false);
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
  };

  const changeProduct = () => {
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
  };

  const startNewServiceJob = () => {
    setSelectedCustomer(null);
    setIsCreatingCustomer(false);
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
    setSavedJob(null);
  };

  const handleSaveAndPrint = async () => {
    if (isSaving || !selectedCustomer || !selectedProduct) return;
    setSaveError(null);
    // Defense-in-depth only — every photo accepted by PhotoEvidenceSection
    // should already satisfy this; this is the one gate that runs
    // immediately before a Service Job payload is built, regardless of how
    // a photo entered `intake.photos`. Never reaches the network on failure.
    const photoValidation = validatePhotosForSubmission(intake.photos);
    if (!photoValidation.ok) {
      setSaveError(photoValidationErrorMessage(photoValidation.reason));
      return;
    }
    // F5d-69 — blocks on a genuinely invalid entered date/URL before ever
    // reaching the network; a blank value is never an error here (every
    // field this checks is optional).
    const metadataError = serviceIntakeMetadataError(intake);
    if (metadataError) {
      setSaveError(metadataError);
      return;
    }
    // F5d-67 Phase 2R — the whole-request defense-in-depth check. Per-photo
    // and aggregate photo checks above don't cover non-photo fields (Thai
    // text encodes to more than one UTF-8 byte per character), and the
    // Worker's MAX_INTAKE_BYTES bounds the complete serialized body, not
    // just photos. Builds the exact same wire-shape payload
    // useCreateServiceJob's Firestore path will build — cheap, pure,
    // duplicated intentionally rather than restructuring the hook.
    const intakePayload = buildServiceJobIntakePayload({
      customer: selectedCustomer,
      product: selectedProduct,
      intake,
    });
    const customerSelector = buildCustomerIntakeSelector(selectedCustomer);
    if (estimateIntakeRequestBytes(intakePayload, customerSelector) > MAX_INTAKE_REQUEST_SAFE_BYTES) {
      setSaveError(serviceJobIntakeTooLargeMessage());
      return;
    }
    setIsSaving(true);
    try {
      const job = await createServiceJob({
        customer: selectedCustomer,
        product: selectedProduct,
        intake,
      });
      setSavedJob(job);
    } catch (error) {
      setSaveError(serviceJobCreateErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const intakeComplete = isServiceIntakeComplete(intake);

  const subtitle = savedJob
    ? 'พร้อมรับลูกค้ารายถัดไปเมื่อคุณพร้อม'
    : isCreatingCustomer
      ? 'กรอกข้อมูลลูกค้าใหม่'
      : !selectedCustomer
        ? START_SEARCH_PROMPT
        : !selectedProduct
          ? 'เลือกสินค้าที่ต้องการซ่อม'
          : !intakeComplete
            ? 'บันทึกอาการ อุปกรณ์ที่นำมาด้วย และหมายเหตุ'
            : 'พร้อมบันทึก';

  return (
    <PageContainer maxWidthClassName="max-w-3xl" className="new-service-job-page">
      <button
        onClick={() => navigate(ROUTES.serviceJobs)}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 animate-[fade-in_0.4s_ease_both]"
      >
        <ArrowLeft className="h-4 w-4" />
        กลับงานบริการทั้งหมด
      </button>

      <div className="animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          สร้างงานบริการใหม่
        </h1>
        <p className="mt-1 text-neutral-500">{subtitle}</p>
      </div>

      {savedJob ? (
        <div
          ref={successPreviewRef}
          tabIndex={-1}
          aria-label={`สร้างงานบริการ ${savedJob.id} แล้ว`}
          className="service-request-print-host focus:outline-none"
        >
          <ServiceRequestPrintPreview
            job={savedJob}
            onPrintAgain={() => window.print()}
            onNewServiceJob={startNewServiceJob}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {selectedCustomer ? (
            selectedCustomer.kind === 'existing' ? (
              <CustomerSummaryCard
                customer={selectedCustomer}
                onChangeCustomer={changeCustomer}
              />
            ) : (
              <NewCustomerSummaryCard
                customer={selectedCustomer}
                onChangeCustomer={changeCustomer}
              />
            )
          ) : isCreatingCustomer ? (
            <NewCustomerForm
              initialQuery={newCustomerQuery}
              onConfirm={confirmNewCustomer}
              onCancel={() => setIsCreatingCustomer(false)}
            />
          ) : (
            <UniversalSearch
              onSelectCustomer={selectExistingCustomer}
              onCreateNewCustomer={startCreatingCustomer}
            />
          )}

          {selectedCustomer &&
            (selectedProduct ? (
              <ProductSummaryCard
                product={selectedProduct}
                onChangeProduct={changeProduct}
              />
            ) : (
              <ProductSelection
                customerId={
                  selectedCustomer.kind === 'existing' ? selectedCustomer.id : null
                }
                onSelectProduct={setSelectedProduct}
              />
            ))}

          {selectedCustomer && selectedProduct && (
            <ServiceIntakeSection value={intake} onChange={setIntake} />
          )}

          {selectedCustomer && selectedProduct && intakeComplete && (
            <FormSection
              icon={Printer}
              title="บันทึกและพิมพ์"
              subtitle="เสร็จสิ้นและส่งมอบใบนำส่ง"
            >
              <PrimaryButton
                onClick={() => void handleSaveAndPrint()}
                className="w-full"
                disabled={isSaving}
              >
                <Printer className="h-5 w-5" />
                {isSaving ? 'กำลังบันทึก…' : 'บันทึกและพิมพ์'}
              </PrimaryButton>
              <AsyncErrorAlert message={saveError} className="mt-3" />
            </FormSection>
          )}
        </div>
      )}
    </PageContainer>
  );
}
