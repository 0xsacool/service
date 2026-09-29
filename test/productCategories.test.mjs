import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isKnownProductCategoryId,
  productCategories,
  resolveProductCategoryId,
} from '../src/services/productCategories.ts';

const expected = [
  ['hot-plate', 'เตาไฟฟ้า (Hot Plate)'],
  ['toaster', 'เตาอบและเครื่องปิ้ง (Toaster & Oven)'],
  ['rice-cooker', 'หม้อหุงข้าว (Rice Cooker)'],
  ['kettle', 'กาต้มน้ำและกระติก (Kettle & Thermos)'],
  ['blender', 'เครื่องปั่นและเครื่องผสม (Blender & Mixer)'],
  ['coffee', 'อุปกรณ์กาแฟ (Coffee)'],
  ['food-maker', 'เครื่องทำอาหาร (Food Maker)'],
  ['fan', 'พัดลมและเครื่องใช้เกี่ยวกับอากาศ (Fan & Air)'],
  ['kitchen-appliance', 'เครื่องใช้ไฟฟ้าในครัวอื่น ๆ (Kitchen Appliance)'],
  ['other', 'อื่น ๆ (Other)'],
];

test('canonical Product Master category choices are BRUNO-focused and ordered', () => {
  assert.deepEqual(
    productCategories.map(({ id, name }) => [id, name]),
    expected
  );
});

test('legacy Apple category ids are not valid new Product Master categories', () => {
  for (const id of ['smartphone', 'laptop', 'tablet', 'smartwatch', 'headphones']) {
    assert.equal(isKnownProductCategoryId(id), false, id);
    assert.equal(resolveProductCategoryId(id), null, id);
  }
});

test('existing stable BRUNO ids remain valid', () => {
  for (const id of ['hot-plate', 'toaster', 'rice-cooker', 'kettle', 'blender', 'fan']) {
    assert.equal(isKnownProductCategoryId(id), true, id);
    assert.equal(resolveProductCategoryId(id), id, id);
  }
});

test('older English spreadsheet labels remain backward-compatible aliases', () => {
  assert.equal(resolveProductCategoryId('Hot Plate'), 'hot-plate');
  assert.equal(resolveProductCategoryId('TOASTER'), 'toaster');
  assert.equal(resolveProductCategoryId('Rice Cooker'), 'rice-cooker');
  assert.equal(resolveProductCategoryId('Kettle'), 'kettle');
  assert.equal(resolveProductCategoryId('Blender'), 'blender');
  assert.equal(resolveProductCategoryId('Fan'), 'fan');
});

test('new concise Thai and English aliases resolve to canonical ids', () => {
  assert.equal(resolveProductCategoryId('เตาอบและเครื่องปิ้ง'), 'toaster');
  assert.equal(resolveProductCategoryId('Kettle & Thermos'), 'kettle');
  assert.equal(resolveProductCategoryId('เครื่องปั่นและเครื่องผสม'), 'blender');
  assert.equal(resolveProductCategoryId('Coffee'), 'coffee');
  assert.equal(resolveProductCategoryId('เครื่องทำอาหาร'), 'food-maker');
  assert.equal(resolveProductCategoryId('Fan & Air'), 'fan');
  assert.equal(resolveProductCategoryId('Kitchen Appliance'), 'kitchen-appliance');
  assert.equal(resolveProductCategoryId('อื่น ๆ'), 'other');
});

test('aliases never escape a caller-supplied category allowlist', () => {
  const restricted = [{ id: 'hot-plate', name: 'Hot Plate only' }];
  assert.equal(resolveProductCategoryId('Hot Plate', restricted), 'hot-plate');
  assert.equal(resolveProductCategoryId('Coffee', restricted), null);
});
