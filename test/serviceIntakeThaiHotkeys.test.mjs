import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  ACCESSORY_CHIPS,
  OTHER_ACCESSORY_PREFIX,
  PROBLEM_CHIPS,
  RECOMMENDED_PHOTO_CHECKLIST,
  getOtherAccessoryText,
  isOtherAccessorySelection,
  normalizeServiceIntakeAccessories,
} from '../src/constants/serviceIntake.ts';

test('photo evidence recommendations are Thai', () => {
  assert.deepEqual(RECOMMENDED_PHOTO_CHECKLIST, [
    'ตัวสินค้า',
    'จุดที่เสียหาย',
    'หมายเลขเครื่อง',
  ]);
});

test('problem hotkeys show Thai labels while retaining canonical stored values', () => {
  assert.deepEqual(
    PROBLEM_CHIPS.map(({ value, label }) => [value, label]),
    [
      ["Won't power on", 'เปิดเครื่องไม่ติด'],
      ['No heating', 'ไม่ร้อน'],
      ['Fan not spinning', 'พัดลมไม่หมุน'],
      ['Error Code', 'ขึ้นรหัสผิดพลาด'],
      ['Broken', 'แตก / หัก'],
      ['Other', 'อื่น ๆ'],
    ]
  );
});

test('brought-accessory hotkeys show Thai labels while retaining canonical stored values', () => {
  assert.deepEqual(
    ACCESSORY_CHIPS.map(({ value, label }) => [value, label]),
    [
      ['Main Unit', 'ตัวเครื่อง'],
      ['Power Cord', 'สายไฟ'],
      ['Lid', 'ฝาปิด'],
      ['Tray', 'ถาด'],
      ['Manual', 'คู่มือ'],
      ['Box', 'กล่อง'],
      ['Measuring Cup', 'ถ้วยตวง'],
      ['Other', 'อื่น ๆ'],
    ]
  );
});

test('Other accessory helper distinguishes placeholder and free-text values', () => {
  assert.equal(isOtherAccessorySelection('Other'), true);
  assert.equal(isOtherAccessorySelection('Other: ตะแกรงย่าง'), true);
  assert.equal(isOtherAccessorySelection('Tray'), false);
  assert.equal(getOtherAccessoryText(['Main Unit', 'Other']), '');
  assert.equal(getOtherAccessoryText(['Main Unit', 'Other: ตะแกรงย่าง']), 'ตะแกรงย่าง');
});

test('custom Other accessory is trimmed to the persisted intake representation', () => {
  assert.deepEqual(
    normalizeServiceIntakeAccessories(['Main Unit', 'Other:   ตะแกรงย่าง   ']),
    ['Main Unit', `${OTHER_ACCESSORY_PREFIX}ตะแกรงย่าง`]
  );
});

test('save validation requires Other free text and payload builder normalizes it', async () => {
  const validationSource = await readFile(
    new URL('../src/validation/serviceIntakeValidation.ts', import.meta.url),
    'utf8'
  );
  const creationSource = await readFile(
    new URL('../src/services/serviceJobCreation.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    validationSource,
    /intake\.accessories\.some\(isOtherAccessorySelection\)/
  );
  assert.match(validationSource, /getOtherAccessoryText\(intake\.accessories\)/);
  assert.match(validationSource, /กรุณาระบุอุปกรณ์อื่น ๆ ที่ลูกค้านำมาด้วย/);
  assert.match(
    creationSource,
    /accessories: normalizeServiceIntakeAccessories\(input\.intake\.accessories\)/
  );
});

test('intake components separate stored values from Thai labels and expose conditional Other input', async () => {
  const chipSource = await readFile(
    new URL(
      '../src/features/service-jobs/components/ChipToggleGroup.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const accessorySource = await readFile(
    new URL(
      '../src/features/service-jobs/components/AccessoriesSection.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(chipSource, /option\.value/);
  assert.match(chipSource, /option\.label/);
  assert.match(accessorySource, /otherSelected &&/);
  assert.match(accessorySource, /ระบุอุปกรณ์อื่น ๆ/);
  assert.match(accessorySource, /service-job-other-accessory/);
  assert.match(accessorySource, /maxLength=\{140\}/);
});
