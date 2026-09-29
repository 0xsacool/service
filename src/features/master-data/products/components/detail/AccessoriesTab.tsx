import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { AccessoryDefinition, ProductMasterEntry } from '../../../../../types';
import { validateNewAccessoryInput } from '../../../../../validation';
import { GlassCard, PrimaryButton, inputClass } from '../../../../../shared/components';

export function AccessoriesTab({
  product,
  allAccessories,
  onToggle,
  onAdd,
  canEdit,
}: {
  product: ProductMasterEntry;
  allAccessories: AccessoryDefinition[];
  onToggle: (accessoryId: string) => Promise<void>;
  onAdd: (label: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (pending) return;
    const result = validateNewAccessoryInput(newLabel);
    if (!result.valid) {
      setError(result.errors.label);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onAdd(newLabel.trim());
      setNewLabel('');
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : 'ไม่สามารถเพิ่มอุปกรณ์เสริมได้ กรุณาลองใหม่'
      );
    } finally {
      setPending(false);
    }
  };

  const handleToggle = async (accessoryId: string) => {
    if (pendingToggleId) return;
    setPendingToggleId(accessoryId);
    setError(null);
    try {
      await onToggle(accessoryId);
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : 'ไม่สามารถเปลี่ยนอุปกรณ์เสริมของสินค้านี้ได้'
      );
    } finally {
      setPendingToggleId(null);
    }
  };

  return (
    <GlassCard className="p-6">
      <h2 className="font-semibold tracking-tight text-ink">อุปกรณ์เสริมเริ่มต้น</h2>
      <p className="mb-5 mt-1 text-sm text-neutral-500">
        อุปกรณ์ที่คาดว่าลูกค้าจะนำมาพร้อมสินค้าเมื่อรับงาน ไม่มีการจัดการคลัง
        เป็นเพียงรายการตรวจสอบเริ่มต้น
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {allAccessories.map((accessory) => {
          const checked = product.accessoryIds.includes(accessory.id);
          return (
            <label
              key={accessory.id}
              className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-black/5 transition-colors hover:bg-white"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => void handleToggle(accessory.id)}
                disabled={!canEdit || pendingToggleId !== null}
                className="h-4 w-4 rounded border-neutral-300 text-brand-500 focus:ring-brand-400"
              />
              <span className="text-sm text-ink">{accessory.label}</span>
            </label>
          );
        })}
        {allAccessories.length === 0 && (
          <p className="col-span-full text-sm text-neutral-400">
            ยังไม่มีอุปกรณ์ในรายการ — เพิ่มรายการแรกด้านล่าง
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {error}
        </p>
      )}

      {canEdit && (
        <div className="mt-5 flex flex-col gap-2 border-t border-black/5 pt-5 sm:flex-row">
          <div className="min-w-0 flex-1">
            <input
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              placeholder="เพิ่มอุปกรณ์เสริมใหม่…"
              disabled={pending}
              className={inputClass()}
            />
          </div>
          <PrimaryButton
            onClick={() => void handleAdd()}
            disabled={pending}
            className="w-full shrink-0 px-5 py-2.5 text-sm sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            {pending ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
          </PrimaryButton>
        </div>
      )}
    </GlassCard>
  );
}
