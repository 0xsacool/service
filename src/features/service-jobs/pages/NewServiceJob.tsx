import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import type {
  CustomerSearchResult,
  RegisteredProduct,
  ServiceIntakeData,
  ServiceJob,
} from '../../../types';
import {
  UniversalSearch,
  CustomerSummaryCard,
  ProductSelection,
  ProductSummaryCard,
  FormSection,
  PrimaryButton,
  PageContainer,
} from '../../../shared/components';
import { ServiceIntakeSection, ServiceRequestPrintPreview } from '../components';
import { ROUTES, createEmptyServiceIntake } from '../../../constants';
import { isServiceIntakeComplete } from '../../../validation';
import { useCreateServiceJob } from '../../../hooks/useCreateServiceJob';
import { backendKind } from '../../../config/backend';

// F5d-49D (Terra P2 UX honesty follow-up): same rationale as SearchInput.tsx
// — Firestore mode has no marketplace username/order number backing data
// (DECISIONS.md #038), so this prompt must not promise those dimensions.
const START_SEARCH_PROMPT =
  backendKind === 'mock'
    ? 'เริ่มจากค้นหาลูกค้า — ค้นหาด้วยชื่อ โทรศัพท์ ชื่อผู้ใช้ ออเดอร์ เลขติดตาม หรือหมายเลขเครื่อง'
    : 'เริ่มจากค้นหาลูกค้า — ค้นหาด้วยชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง';

export function NewServiceJob() {
  const navigate = useNavigate();
  const { createServiceJob } = useCreateServiceJob();

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(
    null
  );
  const [selectedProduct, setSelectedProduct] = useState<RegisteredProduct | null>(null);
  const [intake, setIntake] = useState<ServiceIntakeData>(createEmptyServiceIntake);
  const [savedJob, setSavedJob] = useState<ServiceJob | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fires once right after a save, once the print preview has actually
  // committed to the DOM — matches "Save & Print" being one action, with
  // "Print Again" below for any reprint after this first automatic one.
  useEffect(() => {
    if (savedJob) {
      window.print();
    }
  }, [savedJob]);

  const changeCustomer = () => {
    setSelectedCustomer(null);
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
  };

  const changeProduct = () => {
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
  };

  const startNewServiceJob = () => {
    setSelectedCustomer(null);
    setSelectedProduct(null);
    setIntake(createEmptyServiceIntake());
    setSavedJob(null);
  };

  const handleSaveAndPrint = async () => {
    if (isSaving || !selectedCustomer || !selectedProduct) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const job = await createServiceJob({
        customer: selectedCustomer,
        product: selectedProduct,
        intake,
      });
      setSavedJob(job);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'ไม่สามารถบันทึกงานบริการได้'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const intakeComplete = isServiceIntakeComplete(intake);

  const subtitle = savedJob
    ? 'พร้อมรับลูกค้ารายถัดไปเมื่อคุณพร้อม'
    : !selectedCustomer
      ? START_SEARCH_PROMPT
      : !selectedProduct
        ? 'เลือกสินค้าที่ต้องการซ่อม'
        : !intakeComplete
          ? 'บันทึกอาการ อุปกรณ์ที่นำมาด้วย และหมายเหตุ'
          : 'พร้อมบันทึก';

  return (
    <PageContainer maxWidthClassName="max-w-3xl">
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
        <ServiceRequestPrintPreview
          job={savedJob}
          onPrintAgain={() => window.print()}
          onNewServiceJob={startNewServiceJob}
        />
      ) : (
        <div className="space-y-6">
          {selectedCustomer ? (
            <CustomerSummaryCard
              customer={selectedCustomer}
              onChangeCustomer={changeCustomer}
            />
          ) : (
            <UniversalSearch onSelectCustomer={setSelectedCustomer} />
          )}

          {selectedCustomer &&
            (selectedProduct ? (
              <ProductSummaryCard
                product={selectedProduct}
                onChangeProduct={changeProduct}
              />
            ) : (
              <ProductSelection
                customerId={selectedCustomer.id}
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
              {saveError ? (
                <p className="mt-3 text-sm text-red-600">{saveError}</p>
              ) : null}
            </FormSection>
          )}
        </div>
      )}
    </PageContainer>
  );
}
