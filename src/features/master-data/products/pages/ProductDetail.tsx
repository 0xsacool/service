import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, SearchX, Trash2 } from 'lucide-react';
import { useProductDetail } from '../../../../hooks/useProductDetail';
import { PageContainer, PrimaryButton, EmptyState } from '../../../../shared/components';
import {
  GeneralTab,
  AccessoriesTab,
  CommonProblemsTab,
  ProductActionConfirmModal,
  ProductStatusBadge,
} from '../components';
import { ROUTES } from '../../../../constants';
import { PRODUCT_CATALOG_READ_ONLY_MESSAGE } from '../../../../services/productCatalogAccess';
import { ProductCatalogManagementError } from '../../../../repositories/types';

export type ProductDetailTabKey = 'general' | 'accessories' | 'commonProblems';

// Data-driven so a future tab (Service Manual, Repair Guide, Exploded
// View, Spare Parts) is one more entry here plus a render branch below —
// no structural change to the page.
const TABS: { key: ProductDetailTabKey; label: string }[] = [
  { key: 'general', label: 'ข้อมูลทั่วไป' },
  { key: 'accessories', label: 'อุปกรณ์เสริม' },
  { key: 'commonProblems', label: 'ปัญหาที่พบบ่อย' },
];

export function ProductDetailTabs({
  activeTab,
  onChange,
}: {
  activeTab: ProductDetailTabKey;
  onChange: (tab: ProductDetailTabKey) => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activateTab = (index: number) => {
    const tab = TABS[index];
    if (!tab) return;
    onChange(tab.key);
    tabRefs.current[index]?.focus();
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateTab(nextIndex);
  };

  return (
    <div
      role="tablist"
      aria-label="หมวดรายละเอียดสินค้า"
      className="flex flex-wrap gap-2 animate-[fade-in_0.5s_ease_both]"
    >
      {TABS.map((tab, index) => (
        <button
          key={tab.key}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`product-tab-${tab.key}`}
          aria-selected={activeTab === tab.key}
          aria-controls={`product-panel-${tab.key}`}
          tabIndex={activeTab === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)}
          onKeyDown={(event) => onTabKeyDown(event, index)}
          className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
            activeTab === tab.key
              ? 'bg-brand-500 text-white shadow-sm'
              : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 backdrop-blur hover:bg-white'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function ProductDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const {
    product,
    categories,
    brands,
    allAccessories,
    allCommonProblems,
    updateGeneral,
    setStatus,
    deleteProduct,
    toggleAccessory,
    addAccessory,
    toggleCommonProblem,
    addCommonProblem,
    updateCommonProblemDefinition,
    canEdit,
    canEditKnowledge,
  } = useProductDetail(id ?? '');
  const [activeTab, setActiveTab] = useState<ProductDetailTabKey>('general');
  const [action, setAction] = useState<{
    kind: 'status' | 'delete';
    pending: boolean;
    error: string | null;
  } | null>(null);

  const confirmAction = async () => {
    if (!product || !action || action.pending) return;
    const owner = action;
    setAction({ ...owner, pending: true, error: null });
    try {
      if (owner.kind === 'status') {
        await setStatus(product.status === 'Active' ? 'Legacy' : 'Active');
        setAction(null);
        return;
      }
      await deleteProduct();
      navigate(ROUTES.masterDataProducts);
    } catch (error) {
      let message = 'ไม่สามารถดำเนินการกับสินค้านี้ได้ กรุณาลองใหม่';
      if (error instanceof ProductCatalogManagementError) {
        if (error.code === 'product_in_use') {
          message = 'ไม่สามารถลบได้ เนื่องจากสินค้านี้มีประวัติงานบริการ';
        } else if (error.code === 'product_reference_unknown') {
          message =
            'สินค้านี้เป็นข้อมูลเดิม ระบบยังพิสูจน์ประวัติการใช้งานไม่ได้ จึงไม่อนุญาตให้ลบถาวร';
        } else if (error.code === 'product_not_legacy') {
          message = 'ต้องเปลี่ยนสินค้าเป็นเลิกใช้ก่อนจึงจะลบถาวรได้';
        }
      }
      setAction((current) =>
        current?.kind === owner.kind
          ? { ...current, pending: false, error: message }
          : current
      );
    }
  };

  if (!product) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <EmptyState
          icon={SearchX}
          title="ไม่พบสินค้า"
          description={
            <>
              ไม่พบสินค้าที่ตรงกับ <span className="font-semibold text-ink">{id}</span>.
            </>
          }
          action={
            <PrimaryButton
              className="mt-8"
              onClick={() => navigate(ROUTES.masterDataProducts)}
            >
              กลับข้อมูลสินค้า
            </PrimaryButton>
          }
        />
      </div>
    );
  }

  return (
    <PageContainer maxWidthClassName="max-w-5xl">
      <button
        onClick={() => navigate(ROUTES.masterDataProducts)}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 animate-[fade-in_0.4s_ease_both]"
      >
        <ArrowLeft className="h-4 w-4" />
        กลับข้อมูลสินค้า
      </button>

      <div className="flex flex-col gap-3 animate-[rise_0.4s_cubic-bezier(0.22,1,0.36,1)_both] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {product.brand}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-1 text-neutral-500">
            {product.model}
            {product.sku ? ` · SKU ${product.sku}` : ''}
          </p>
        </div>
        <ProductStatusBadge
          status={product.status}
          onClick={
            canEdit
              ? () => setAction({ kind: 'status', pending: false, error: null })
              : undefined
          }
          ariaLabel={`เปลี่ยนสถานะ ${product.name}`}
        />
      </div>

      {canEdit && product.status === 'Legacy' && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {product.referenceTrackingVersion === 1 ? (
            <button
              type="button"
              onClick={() => setAction({ kind: 'delete', pending: false, error: null })}
              className="inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
              ลบสินค้าถาวร
            </button>
          ) : (
            <p className="rounded-2xl bg-neutral-100 px-4 py-2 text-xs text-neutral-500">
              ข้อมูลสินค้าเดิม: เลิกใช้ได้ แต่ยังไม่อนุญาตให้ลบถาวรเพราะไม่มี reference
              ย้อนหลังที่พิสูจน์ได้
            </p>
          )}
        </div>
      )}

      <ProductDetailTabs activeTab={activeTab} onChange={setActiveTab} />

      {!canEdit && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {PRODUCT_CATALOG_READ_ONLY_MESSAGE}
        </p>
      )}

      {activeTab === 'general' && (
        <div
          role="tabpanel"
          id="product-panel-general"
          aria-labelledby="product-tab-general"
        >
          <GeneralTab
            product={product}
            categories={categories}
            brands={brands}
            onSave={updateGeneral}
            canEdit={canEdit}
          />
        </div>
      )}
      {activeTab === 'accessories' && (
        <div
          role="tabpanel"
          id="product-panel-accessories"
          aria-labelledby="product-tab-accessories"
        >
          <AccessoriesTab
            product={product}
            allAccessories={allAccessories}
            onToggle={toggleAccessory}
            onAdd={addAccessory}
            canEdit={canEditKnowledge}
          />
        </div>
      )}
      {activeTab === 'commonProblems' && (
        <div
          role="tabpanel"
          id="product-panel-commonProblems"
          aria-labelledby="product-tab-commonProblems"
        >
          <CommonProblemsTab
            product={product}
            allCommonProblems={allCommonProblems}
            onToggle={toggleCommonProblem}
            onAdd={addCommonProblem}
            onUpdateDefinition={updateCommonProblemDefinition}
            canEdit={canEditKnowledge}
          />
        </div>
      )}

      {action && (
        <ProductActionConfirmModal
          title={
            action.kind === 'delete'
              ? 'ลบสินค้าถาวร'
              : product.status === 'Active'
                ? 'เลิกใช้สินค้า'
                : 'เปิดใช้งานสินค้า'
          }
          message={
            action.kind === 'delete'
              ? `ระบบจะตรวจประวัติงานบริการอีกครั้งก่อนลบ ${product.name} หากพบการอ้างอิงแม้แต่หนึ่งรายการ ระบบจะไม่ลบสินค้า`
              : product.status === 'Active'
                ? `ต้องการเปลี่ยน ${product.name} เป็นเลิกใช้หรือไม่? สินค้าจะไม่แสดงในงานบริการใหม่`
                : `ต้องการเปิดใช้งาน ${product.name} อีกครั้งหรือไม่?`
          }
          confirmLabel={
            action.kind === 'delete'
              ? 'ลบถาวร'
              : product.status === 'Active'
                ? 'เลิกใช้สินค้า'
                : 'เปิดใช้งาน'
          }
          destructive={action.kind === 'delete'}
          pending={action.pending}
          error={action.error}
          onClose={() => setAction(null)}
          onConfirm={() => void confirmAction()}
        />
      )}
    </PageContainer>
  );
}
