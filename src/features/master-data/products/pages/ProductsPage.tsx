import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, Upload, Download, FileDown, ChevronRight } from 'lucide-react';
import type { ProductMasterEntry, ProductStatus } from '../../../../types';
import { useProductMaster } from '../../../../hooks/useProductMaster';
import {
  GlassCard,
  PrimaryButton,
  PageHeader,
  PageContainer,
} from '../../../../shared/components';
import type { StaffOutletContext } from '../../../../shared/layouts/StaffLayout';
import {
  buildProductsExportCsv,
  buildProductsExportExcel,
  buildTemplateCsv,
  buildTemplateExcel,
} from '../../../../services/productMasterExport';
import { downloadTextFile } from '../../../../utils/download';
import { ROUTES } from '../../../../constants';
import { PRODUCT_CATALOG_READ_ONLY_MESSAGE } from '../../../../services/productCatalogAccess';
import {
  AddProductModal,
  DownloadMenu,
  ImportProductsWizard,
  ProductStatusBadge,
} from '../components';

type StatusFilter = 'All' | ProductStatus;
type SortKey = 'name' | 'brand' | 'model' | 'warrantyMonths';

const STATUS_FILTERS: StatusFilter[] = ['All', 'Active', 'Legacy'];
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'ชื่อสินค้า' },
  { value: 'brand', label: 'แบรนด์' },
  { value: 'model', label: 'รุ่น' },
  { value: 'warrantyMonths', label: 'เดือนประกัน' },
];

export function ProductMasterDetailLink({ id, model }: { id: string; model: string }) {
  return (
    <Link
      to={ROUTES.masterDataProductDetail(id)}
      onClick={(event) => event.stopPropagation()}
      className="rounded text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      aria-label={`เปิดรายละเอียดสินค้ารุ่น ${model}`}
    >
      {model}
    </Link>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { search } = useOutletContext<StaffOutletContext>();
  const {
    products,
    categories,
    brands,
    addProduct,
    buildImportContext,
    refreshAndRebuildImportContext,
    commitImportRows,
    canEdit,
    canImportProductCatalog,
  } = useProductMaster();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);

  const categoryName = (categoryId: string): string =>
    categories.find((c) => c.id === categoryId)?.name ?? 'ไม่ระบุหมวดหมู่';

  const q = search.trim().toLowerCase();
  const filtered = products
    .filter((p) => statusFilter === 'All' || p.status === statusFilter)
    .filter((p) => categoryFilter === 'All' || p.categoryId === categoryFilter)
    .filter((p) => {
      if (!q) return true;
      return (
        p.brand.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        categoryName(p.categoryId).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortKey === 'warrantyMonths') return a.warrantyMonths - b.warrantyMonths;
      return a[sortKey].localeCompare(b[sortKey]);
    });

  const handleExport = (format: 'excel' | 'csv') => {
    if (format === 'csv') {
      downloadTextFile(
        'products-export.csv',
        buildProductsExportCsv(products, categories),
        'text/csv'
      );
    } else {
      downloadTextFile(
        'products-export.xls',
        buildProductsExportExcel(products, categories),
        'application/vnd.ms-excel'
      );
    }
  };

  const handleTemplate = (format: 'excel' | 'csv') => {
    if (format === 'csv') {
      downloadTextFile('product-import-template.csv', buildTemplateCsv(), 'text/csv');
    } else {
      downloadTextFile(
        'product-import-template.xls',
        buildTemplateExcel(brands, categories),
        'application/vnd.ms-excel'
      );
    }
  };

  return (
    <PageContainer maxWidthClassName="max-w-7xl">
      <PageHeader
        title="ข้อมูลหลักสินค้า"
        subtitle={`แสดง ${filtered.length} จาก ${products.length} รายการ`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu
              label="แม่แบบ"
              icon={FileDown}
              onSelectExcel={() => handleTemplate('excel')}
              onSelectCsv={() => handleTemplate('csv')}
            />
            <DownloadMenu
              label="ส่งออก"
              icon={Download}
              onSelectExcel={() => handleExport('excel')}
              onSelectCsv={() => handleExport('csv')}
            />
            {canImportProductCatalog && (
              <button
                onClick={() => setShowImportWizard(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white/80 px-4 py-2.5 text-sm font-medium text-brand-600 ring-1 ring-black/5 shadow-sm backdrop-blur transition-all hover:bg-white active:scale-[0.98]"
              >
                <Upload className="h-4 w-4" />
                นำเข้าสินค้า
              </button>
            )}
            {canEdit && (
              <PrimaryButton
                onClick={() => setShowAddModal(true)}
                className="px-5 py-2.5 text-sm"
              >
                <Plus className="h-4 w-4" />
                เพิ่มสินค้า
              </PrimaryButton>
            )}
          </div>
        }
      />

      {!canEdit && (
        <p className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {PRODUCT_CATALOG_READ_ONLY_MESSAGE}
        </p>
      )}

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-2 animate-[fade-in_0.5s_ease_both]">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            aria-pressed={statusFilter === f}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
              statusFilter === f
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 backdrop-blur hover:bg-white'
            }`}
          >
            {f === 'All' ? 'ทั้งหมด' : f === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
          </button>
        ))}

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="กรองตามหมวดหมู่สินค้า"
          className="rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-neutral-600 ring-1 ring-black/5 backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="All">ทุกหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <div className="relative ml-auto flex items-center gap-2">
          <label htmlFor="product-sort-order" className="text-sm text-neutral-400">
            เรียงลำดับ
          </label>
          <select
            id="product-sort-order"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-neutral-600 ring-1 ring-black/5 backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table on desktop */}
      <GlassCard className="hidden overflow-hidden animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both] lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-black/5 text-left text-xs font-medium uppercase tracking-wider text-neutral-400">
              <th className="px-5 py-3.5">แบรนด์</th>
              <th className="px-5 py-3.5">รุ่น</th>
              <th className="px-5 py-3.5">SKU</th>
              <th className="px-5 py-3.5">ชื่อสินค้า</th>
              <th className="px-5 py-3.5">หมวดหมู่</th>
              <th className="px-5 py-3.5">ประกัน</th>
              <th className="px-5 py-3.5">สถานะ</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(ROUTES.masterDataProductDetail(p.id))}
                className="cursor-pointer transition-colors hover:bg-neutral-50/70"
              >
                <td className="px-5 py-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
                  {p.brand}
                </td>
                <td className="px-5 py-4 font-medium">
                  <ProductMasterDetailLink id={p.id} model={p.model} />
                </td>
                <td className="px-5 py-4 text-neutral-600">{p.sku ?? '—'}</td>
                <td className="px-5 py-4 text-neutral-600">{p.name}</td>
                <td className="px-5 py-4 text-neutral-600">
                  {categoryName(p.categoryId)}
                </td>
                <td className="px-5 py-4 text-neutral-600">{p.warrantyMonths} เดือน</td>
                <td className="px-5 py-4">
                  <ProductStatusBadge status={p.status} />
                </td>
                <td className="px-5 py-4 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-neutral-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-neutral-400">ไม่พบสินค้าตามตัวกรอง</div>
        )}
      </GlassCard>

      {/* Cards on mobile */}
      <div className="space-y-3 lg:hidden">
        {filtered.map((p: ProductMasterEntry) => (
          <button
            key={p.id}
            onClick={() => navigate(ROUTES.masterDataProductDetail(p.id))}
            className="block w-full text-left animate-[rise_0.4s_ease_both]"
          >
            <GlassCard className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    {p.brand}
                  </p>
                  <p className="truncate font-medium text-ink">
                    {p.name} · {p.model}
                  </p>
                  {p.sku && (
                    <p className="truncate text-xs text-neutral-400">SKU {p.sku}</p>
                  )}
                  <p className="mt-1 text-sm text-neutral-500">
                    {categoryName(p.categoryId)}
                  </p>
                </div>
                <ProductStatusBadge status={p.status} />
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                ประกัน {p.warrantyMonths} เดือน
              </p>
            </GlassCard>
          </button>
        ))}
        {filtered.length === 0 && (
          <GlassCard className="p-8 text-center text-neutral-400">
            ไม่พบสินค้าตามตัวกรอง
          </GlassCard>
        )}
      </div>

      {canEdit && showAddModal && (
        <AddProductModal
          categories={categories}
          brands={brands}
          onClose={() => setShowAddModal(false)}
          onCreate={(input) => {
            addProduct(input);
            setShowAddModal(false);
          }}
        />
      )}

      {canImportProductCatalog && showImportWizard && (
        <ImportProductsWizard
          onClose={() => setShowImportWizard(false)}
          buildImportContext={buildImportContext}
          refreshAndRebuildImportContext={refreshAndRebuildImportContext}
          commitImportRows={commitImportRows}
        />
      )}
    </PageContainer>
  );
}
