import type {
  ProductCategory,
  AccessoryDefinition,
  CommonProblemDefinition,
  ProductMasterEntry,
} from '../../types';

// Illustrative, hand-authored representative catalog — built from BRUNO's
// known public product line-up (compact hot plates, blenders, toasters,
// kettles, circulator fans, rice cookers), not the client's verified SKU
// list. Structured so the real catalog can replace/extend this file with no
// change to productMasterRepository.ts or any component that reads through
// it — that substitutability is the actual point of this sprint.
//
// The 8 "Legacy" Apple entries preserve every product the original
// Bolt.new-generated mock data (serviceJobs.mock.ts) already references, so
// the 7 existing seed customers' Product Selection cards render identically
// to before this sprint — only the mechanism producing them changed.

export const productCategories: ProductCategory[] = [
  { id: 'hot-plate', name: 'Hot Plate' },
  { id: 'blender', name: 'Blender' },
  { id: 'toaster', name: 'Toaster' },
  { id: 'kettle', name: 'Kettle' },
  { id: 'fan', name: 'Fan' },
  { id: 'rice-cooker', name: 'Rice Cooker' },
  // Legacy categories — only referenced by the 8 Legacy Apple products below.
  { id: 'smartphone', name: 'Smartphone' },
  { id: 'laptop', name: 'Laptop' },
  { id: 'tablet', name: 'Tablet' },
  { id: 'smartwatch', name: 'Smartwatch' },
  { id: 'headphones', name: 'Headphones' },
];

export const accessoriesMaster: AccessoryDefinition[] = [
  // Common across most products
  { id: 'main-unit', label: 'Main Unit' },
  { id: 'power-cord', label: 'Power Cord' },
  { id: 'manual', label: 'Manual' },
  { id: 'box', label: 'Box' },
  { id: 'other-accessory', label: 'Other' },
  // Hot plate
  { id: 'grill-plate', label: 'Grill Plate' },
  { id: 'takoyaki-plate', label: 'Takoyaki Plate' },
  { id: 'steamer-tray', label: 'Steamer Tray' },
  // Blender
  { id: 'blending-jar', label: 'Blending Jar' },
  { id: 'lid', label: 'Lid' },
  { id: 'measuring-cup', label: 'Measuring Cup' },
  { id: 'blade-unit', label: 'Blade Unit' },
  // Toaster
  { id: 'crumb-tray', label: 'Crumb Tray' },
  // Kettle
  { id: 'kettle-base', label: 'Kettle Base' },
  // Fan
  { id: 'remote-control', label: 'Remote Control' },
  // Rice cooker
  { id: 'inner-pot', label: 'Inner Pot' },
  { id: 'rice-paddle', label: 'Rice Paddle' },
];

export const commonProblemsMaster: CommonProblemDefinition[] = [
  // Universal
  { id: 'wont-power-on', label: "Won't power on", status: 'Active' },
  { id: 'broken', label: 'Broken', status: 'Active' },
  { id: 'error-code', label: 'Error Code', status: 'Active' },
  { id: 'other-problem', label: 'Other', status: 'Active' },
  // Heating appliances (hot plate, toaster, kettle, rice cooker)
  { id: 'no-heating', label: 'No heating', status: 'Active' },
  { id: 'burning-smell', label: 'Burning smell', status: 'Active' },
  // Motorized appliances (blender, fan)
  { id: 'fan-not-spinning', label: 'Fan not spinning', status: 'Active' },
  { id: 'blade-not-turning', label: 'Blade not turning', status: 'Active' },
  { id: 'unusual-noise', label: 'Unusual noise', status: 'Active' },
  // Liquid-handling appliances (kettle, rice cooker)
  { id: 'leaking', label: 'Leaking', status: 'Active' },
  // Appliances with a control panel (rice cooker, some fans)
  { id: 'display-not-working', label: 'Display not working', status: 'Active' },
];

const universalAccessories = [
  'main-unit',
  'power-cord',
  'manual',
  'box',
  'other-accessory',
];
const universalProblems = ['wont-power-on', 'broken', 'error-code', 'other-problem'];

export const productMasterEntries: ProductMasterEntry[] = [
  // --- Legacy (Apple) — unchanged from the original mock catalog ---
  {
    id: 'apple-iphone-15-pro-max',
    brand: 'Apple',
    categoryId: 'smartphone',
    name: 'iPhone',
    model: '15 Pro Max',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-macbook-air-m3-13',
    brand: 'Apple',
    categoryId: 'laptop',
    name: 'MacBook Air',
    model: 'M3 13"',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-airpods-pro-2',
    brand: 'Apple',
    categoryId: 'headphones',
    name: 'AirPods',
    model: 'Pro 2',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-watch-series-10',
    brand: 'Apple',
    categoryId: 'smartwatch',
    name: 'Apple Watch',
    model: 'Series 10',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-ipad-air-11',
    brand: 'Apple',
    categoryId: 'tablet',
    name: 'iPad',
    model: 'Air 11"',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-iphone-14',
    brand: 'Apple',
    categoryId: 'smartphone',
    name: 'iPhone',
    model: '14',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-macbook-pro-14-m4',
    brand: 'Apple',
    categoryId: 'laptop',
    name: 'MacBook Pro',
    model: '14" M4',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },
  {
    id: 'apple-ipad-10th-gen',
    brand: 'Apple',
    categoryId: 'tablet',
    name: 'iPad',
    model: '10th Gen',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: universalAccessories,
    commonProblemIds: universalProblems,
  },

  // --- Active (BRUNO) — the real catalog going forward ---
  {
    id: 'bruno-compact-hotplate',
    brand: 'BRUNO',
    categoryId: 'hot-plate',
    name: 'BRUNO Compact Hot Plate',
    model: 'BOE021-PK',
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'grill-plate',
      'takoyaki-plate',
      'steamer-tray',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'no-heating',
      'burning-smell',
      'error-code',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-multi-stick-blender',
    brand: 'BRUNO',
    categoryId: 'blender',
    name: 'BRUNO Multi Stick Blender',
    model: 'BOE033',
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'blending-jar',
      'lid',
      'measuring-cup',
      'blade-unit',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'blade-not-turning',
      'unusual-noise',
      'error-code',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-round-toaster',
    brand: 'BRUNO',
    categoryId: 'toaster',
    name: 'BRUNO Round Toaster',
    model: 'BOE067',
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'crumb-tray',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'no-heating',
      'burning-smell',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-electric-kettle',
    brand: 'BRUNO',
    categoryId: 'kettle',
    name: 'BRUNO Electric Kettle',
    model: 'BOE044',
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'kettle-base',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'no-heating',
      'leaking',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-dc-circulator-fan',
    brand: 'BRUNO',
    categoryId: 'fan',
    name: 'BRUNO DC Circulator Fan',
    model: 'BOE102',
    status: 'Active',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'remote-control',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'fan-not-spinning',
      'unusual-noise',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-rice-slow-cooker',
    brand: 'BRUNO',
    categoryId: 'rice-cooker',
    name: 'BRUNO Rice & Slow Cooker',
    model: 'BOE029',
    status: 'Active',
    // Illustrates warranty months as a genuine per-product attribute, not a
    // single global default — this line is longer than the others.
    warrantyMonths: 15,
    accessoryIds: [
      'main-unit',
      'inner-pot',
      'rice-paddle',
      'measuring-cup',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'no-heating',
      'leaking',
      'display-not-working',
      'broken',
      'other-problem',
    ],
  },
  {
    id: 'bruno-compact-hotplate-1st-gen',
    brand: 'BRUNO',
    categoryId: 'hot-plate',
    name: 'BRUNO Compact Hot Plate (1st Gen)',
    model: 'BOE013',
    // Discontinued predecessor of bruno-compact-hotplate — demonstrates that
    // Active/Legacy is a real per-product lifecycle field, not just a stand-in
    // for "old brand vs. new brand."
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: [
      'main-unit',
      'grill-plate',
      'power-cord',
      'manual',
      'box',
      'other-accessory',
    ],
    commonProblemIds: [
      'wont-power-on',
      'no-heating',
      'burning-smell',
      'broken',
      'other-problem',
    ],
  },
];
