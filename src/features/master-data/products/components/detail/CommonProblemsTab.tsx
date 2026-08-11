import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import type { CommonProblemDefinition, ProductMasterEntry } from '../../../../../types';
import type { NewCommonProblemInput } from '../../../../../services/productKnowledgeAdmin';
import { GlassCard, PrimaryButton } from '../../../../../shared/components';
import { CommonProblemModal } from './CommonProblemModal';

type StatusFilter = 'All' | 'Active' | 'Inactive';
const STATUS_FILTERS: StatusFilter[] = ['All', 'Active', 'Inactive'];

export function CommonProblemsTab({
  product,
  allCommonProblems,
  onToggle,
  onAdd,
  onUpdateDefinition,
  canEdit,
}: {
  product: ProductMasterEntry;
  allCommonProblems: CommonProblemDefinition[];
  onToggle: (problemId: string) => void;
  onAdd: (input: NewCommonProblemInput) => void;
  onUpdateDefinition: (id: string, patch: Partial<CommonProblemDefinition>) => void;
  canEdit: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProblem, setEditingProblem] = useState<CommonProblemDefinition | null>(
    null
  );

  const filtered = allCommonProblems.filter(
    (p) => statusFilter === 'All' || p.status === statusFilter
  );

  return (
    <GlassCard className="p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold tracking-tight text-ink">ปัญหาที่พบบ่อย</h2>
        {canEdit && (
          <PrimaryButton
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            เพิ่มปัญหา
          </PrimaryButton>
        )}
      </div>
      <p className="mb-5 text-sm text-neutral-500">
        ปัญหาที่พบบ่อยสำหรับสินค้านี้ หากไม่ใช้แล้วให้เปลี่ยนเป็นเลิกใช้แทนการลบ
      </p>

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
              statusFilter === f
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white/70 text-neutral-600 ring-1 ring-black/5 hover:bg-white'
            }`}
          >
            {f === 'All' ? 'ทั้งหมด' : f === 'Active' ? 'ใช้งาน' : 'เลิกใช้'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((problem) => {
          const checked = product.commonProblemIds.includes(problem.id);
          return (
            <div
              key={problem.id}
              className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-black/5"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(problem.id)}
                disabled={!canEdit}
                className="mt-1 h-4 w-4 rounded border-neutral-300 text-brand-500 focus:ring-brand-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{problem.label}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      problem.status === 'Active'
                        ? 'bg-success-50 text-success-700 ring-success-200'
                        : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
                    }`}
                  >
                    {problem.status}
                  </span>
                </div>
                {problem.description && (
                  <p className="mt-0.5 text-sm text-neutral-500">{problem.description}</p>
                )}
              </div>
              {canEdit && (
                <button
                  onClick={() => setEditingProblem(problem)}
                  className="shrink-0 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                  aria-label={`แก้ไข ${problem.label}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-neutral-400">ไม่พบปัญหาตามตัวกรอง</p>
        )}
      </div>

      {canEdit && showAddModal && (
        <CommonProblemModal
          onClose={() => setShowAddModal(false)}
          onSave={(input) => {
            onAdd(input);
            setShowAddModal(false);
          }}
        />
      )}

      {canEdit && editingProblem && (
        <CommonProblemModal
          existing={editingProblem}
          onClose={() => setEditingProblem(null)}
          onSave={(input) => {
            onUpdateDefinition(editingProblem.id, input);
            setEditingProblem(null);
          }}
        />
      )}
    </GlassCard>
  );
}
