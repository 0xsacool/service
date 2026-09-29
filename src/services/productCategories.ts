import type { ProductCategory } from '../types/productMaster.ts';

// Product Master categories are static reference data shared by the browser
// and Cloudflare Worker. Keep this list intentionally small and aligned with
// BRUNO Thailand's real service/catalog workflow. Stable ids are preserved for
// the six categories that already existed so older imports and references do
// not need a migration.
export const productCategories: ProductCategory[] = [
  { id: 'hot-plate', name: 'เตาไฟฟ้า (Hot Plate)' },
  { id: 'toaster', name: 'เตาอบและเครื่องปิ้ง (Toaster & Oven)' },
  { id: 'rice-cooker', name: 'หม้อหุงข้าว (Rice Cooker)' },
  { id: 'kettle', name: 'กาต้มน้ำและกระติก (Kettle & Thermos)' },
  { id: 'blender', name: 'เครื่องปั่นและเครื่องผสม (Blender & Mixer)' },
  { id: 'coffee', name: 'อุปกรณ์กาแฟ (Coffee)' },
  { id: 'food-maker', name: 'เครื่องทำอาหาร (Food Maker)' },
  { id: 'fan', name: 'พัดลมและเครื่องใช้เกี่ยวกับอากาศ (Fan & Air)' },
  { id: 'kitchen-appliance', name: 'เครื่องใช้ไฟฟ้าในครัวอื่น ๆ (Kitchen Appliance)' },
  { id: 'other', name: 'อื่น ๆ (Other)' },
];

// Backward-compatible import aliases only. These aliases do not become
// selectable categories and do not make removed Apple-oriented ids valid.
// They preserve older BRUNO spreadsheets/templates that used the previous
// short English display names while allowing concise Thai/English labels too.
const categoryAliases: Readonly<Record<string, string>> = {
  'hot plate': 'hot-plate',
  เตาไฟฟ้า: 'hot-plate',
  toaster: 'toaster',
  'toaster & oven': 'toaster',
  เตาอบและเครื่องปิ้ง: 'toaster',
  'rice cooker': 'rice-cooker',
  หม้อหุงข้าว: 'rice-cooker',
  kettle: 'kettle',
  'kettle & thermos': 'kettle',
  กาต้มน้ำและกระติก: 'kettle',
  blender: 'blender',
  'blender & mixer': 'blender',
  เครื่องปั่นและเครื่องผสม: 'blender',
  coffee: 'coffee',
  อุปกรณ์กาแฟ: 'coffee',
  'food maker': 'food-maker',
  เครื่องทำอาหาร: 'food-maker',
  fan: 'fan',
  'fan & air': 'fan',
  พัดลมและเครื่องใช้เกี่ยวกับอากาศ: 'fan',
  'kitchen appliance': 'kitchen-appliance',
  'เครื่องใช้ไฟฟ้าในครัวอื่น ๆ': 'kitchen-appliance',
  other: 'other',
  'อื่น ๆ': 'other',
};

export function resolveProductCategoryId(
  raw: string | null | undefined,
  categories: readonly ProductCategory[] = productCategories
): string | null {
  if (raw === null || raw === undefined) return null;
  const target = raw.trim().toLowerCase();
  if (target.length === 0) return null;

  const direct = categories.find(
    (category) =>
      category.id.toLowerCase() === target || category.name.toLowerCase() === target
  );
  if (direct) return direct.id;

  const aliasId = categoryAliases[target];
  return aliasId && categories.some((category) => category.id === aliasId)
    ? aliasId
    : null;
}

export function isKnownProductCategoryId(
  value: string | null | undefined,
  categories: readonly ProductCategory[] = productCategories
): boolean {
  return (
    value !== null &&
    value !== undefined &&
    categories.some((category) => category.id === value)
  );
}
