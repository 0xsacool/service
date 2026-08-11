import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, SearchX } from 'lucide-react';
import { useProductDetail } from '../../../../hooks/useProductDetail';
import { PageContainer, PrimaryButton, EmptyState } from '../../../../shared/components';
import {
  GeneralTab,
  AccessoriesTab,
  CommonProblemsTab,
  ProductStatusBadge,
} from '../components';
import { ROUTES } from '../../../../constants';
import { PRODUCT_CATALOG_READ_ONLY_MESSAGE } from '../../../../services/productCatalogAccess';

type TabKey = 'general' | 'accessories' | 'commonProblems';

// Data-driven so a future tab (Service Manual, Repair Guide, Exploded
// View, Spare Parts) is one more entry here plus a render branch below —
// no structural change to the page.
const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'ข้อมูลทั่วไป' },
  { key: 'accessories', label: 'อุปกรณ์เสริม' },
  { key: 'commonProblems', label: 'ปัญหาที่พบบ่อย' },
];

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
    toggleAccessory,
    addAccessory,
    toggleCommonProblem,
    addCommonProblem,
    updateCommonProblemDefinition,
    canEdit,
  } = useProductDetail(id ?? '');
  const [activeTab, setActiveTab] = useState<TabKey>('general');

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
        <ProductStatusBadge status={product.status} />
      </div>

      <div className="flex flex-wrap gap-2 animate-[fade-in_0.5s_ease_both]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
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

      {!canEdit && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {PRODUCT_CATALOG_READ_ONLY_MESSAGE}
        </p>
      )}

      {activeTab === 'general' && (
        <GeneralTab
          product={product}
          categories={categories}
          brands={brands}
          onSave={updateGeneral}
          canEdit={canEdit}
        />
      )}
      {activeTab === 'accessories' && (
        <AccessoriesTab
          product={product}
          allAccessories={allAccessories}
          onToggle={toggleAccessory}
          onAdd={addAccessory}
          canEdit={canEdit}
        />
      )}
      {activeTab === 'commonProblems' && (
        <CommonProblemsTab
          product={product}
          allCommonProblems={allCommonProblems}
          onToggle={toggleCommonProblem}
          onAdd={addCommonProblem}
          onUpdateDefinition={updateCommonProblemDefinition}
          canEdit={canEdit}
        />
      )}
    </PageContainer>
  );
}
