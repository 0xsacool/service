import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  parseAccessoryCreateRequest,
  parseCommonProblemWriteRequest,
  parseProductKnowledgeAssociationRequest,
} from '../src/services/productKnowledgeManagement.ts';

test('Product Knowledge contracts accept only bounded exact request shapes', () => {
  assert.deepEqual(parseAccessoryCreateRequest({ version: 1, label: '  ฝา  ' }), {
    version: 1,
    label: 'ฝา',
  });
  assert.equal(parseAccessoryCreateRequest({ version: 1, label: '' }), null);
  assert.equal(
    parseAccessoryCreateRequest({ version: 1, label: 'ฝา', extra: true }),
    null
  );

  assert.deepEqual(
    parseProductKnowledgeAssociationRequest({ version: 1, include: false }),
    { version: 1, include: false }
  );
  assert.equal(
    parseProductKnowledgeAssociationRequest({ version: 1, include: 'false' }),
    null
  );

  assert.deepEqual(
    parseCommonProblemWriteRequest({
      version: 1,
      label: ' เตาไม่ร้อน ',
      status: 'Active',
      description: ' ตรวจฮีตเตอร์ ',
    }),
    {
      version: 1,
      label: 'เตาไม่ร้อน',
      status: 'Active',
      description: 'ตรวจฮีตเตอร์',
    }
  );
  assert.equal(
    parseCommonProblemWriteRequest({
      version: 1,
      label: 'เตาไม่ร้อน',
      status: 'Unknown',
      description: null,
    }),
    null
  );
});

test('Product detail production knowledge writes use capability-gated Worker management and authoritative refresh', async () => {
  const source = await readFile(
    new URL('../src/hooks/useProductDetail.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /const canEditKnowledge = canEdit/);
  assert.match(source, /productKnowledgeManagement\.createAccessory/);
  assert.match(source, /productKnowledgeManagement\.setAccessoryAssociation/);
  assert.match(source, /productKnowledgeManagement\.createCommonProblem/);
  assert.match(source, /productKnowledgeManagement\.updateCommonProblem/);
  assert.match(source, /productKnowledgeManagement\.setCommonProblemAssociation/);
  assert.match(source, /productKnowledge\.refreshFromServer\(\)/);
  assert.match(source, /productMaster\.refreshFromServer\(\[productId\]\)/);
  assert.doesNotMatch(source, /productMaster\.updateProduct\(product\.id, \{ \[field\]/);
});

test('mobile Product Knowledge controls wait for async writes and surface errors', async () => {
  const accessories = await readFile(
    new URL(
      '../src/features/master-data/products/components/detail/AccessoriesTab.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const problems = await readFile(
    new URL(
      '../src/features/master-data/products/components/detail/CommonProblemsTab.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const modal = await readFile(
    new URL(
      '../src/features/master-data/products/components/detail/CommonProblemModal.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(accessories, /onAdd: \(label: string\) => Promise<void>/);
  assert.match(accessories, /await onAdd\(newLabel\.trim\(\)\)/);
  assert.match(accessories, /sm:flex-row/);
  assert.match(accessories, /role="alert"/);
  assert.match(problems, /onToggle: \(problemId: string\) => Promise<void>/);
  assert.match(problems, /await onToggle\(problemId\)/);
  assert.match(problems, /w-full px-4 py-2\.5 text-sm sm:w-auto/);
  assert.match(modal, /onSave: \(input: NewCommonProblemInput\) => Promise<void>/);
  assert.match(modal, /await onSave\(input\)/);
  assert.match(modal, /กำลังบันทึก/);
});
