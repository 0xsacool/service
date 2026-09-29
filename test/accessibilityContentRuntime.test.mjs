import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { installDomTestEnvironment } from './support/domTestEnvironment.mjs';

const dom = installDomTestEnvironment();
const React = await import('react');
const { act, createElement, Fragment } = React;
const { createRoot } = await import('react-dom/client');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

const { Timeline } = await vite.ssrLoadModule('/src/shared/components/Timeline.tsx');
const { ProgressBar } = await vite.ssrLoadModule(
  '/src/shared/components/ProgressBar.tsx'
);
const { PhotoGallery } = await vite.ssrLoadModule(
  '/src/shared/components/PhotoGallery.tsx'
);
const { DownloadMenu } = await vite.ssrLoadModule(
  '/src/features/master-data/products/components/DownloadMenu.tsx'
);
const { ProductFieldsForm } = await vite.ssrLoadModule(
  '/src/features/master-data/products/components/ProductFieldsForm.tsx'
);
const { ImportChooseFile } = await vite.ssrLoadModule(
  '/src/features/master-data/products/components/import/ImportChooseFile.tsx'
);

after(async () => {
  await vite.close();
  dom.cleanup();
});

beforeEach(() => {
  dom.resetBody();
});

async function mount(element) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function dispatch(target, event) {
  await act(async () => {
    target.dispatchEvent(event);
  });
}

function click(target) {
  return dispatch(
    target,
    new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
  );
}

function keydown(target, key) {
  return dispatch(
    target,
    new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
  );
}

test('Timeline and ProgressBar expose current-step and numeric progress semantics', async () => {
  const events = [
    {
      status: 'Received',
      title: 'Received',
      description: 'รับสินค้าแล้ว',
      date: '2026-09-28T03:00:00.000Z',
      time: '10:00',
      done: true,
      current: false,
    },
    {
      status: 'Diagnosing',
      title: 'Diagnosing',
      description: 'กำลังตรวจสอบ',
      date: '—',
      time: '',
      done: false,
      current: true,
    },
  ];

  const mounted = await mount(
    createElement(
      Fragment,
      null,
      createElement(Timeline, {
        events,
        currentStatus: 'Diagnosing',
        showCurrentBadge: true,
      }),
      createElement(ProgressBar, { status: 'Diagnosing' })
    )
  );

  const timeline = document.querySelector('ol[aria-label="ไทม์ไลน์สถานะงานบริการ"]');
  const currentStep = document.querySelector('li[aria-current="step"]');
  const progress = document.querySelector('[role="progressbar"]');

  assert.ok(timeline);
  assert.ok(currentStep);
  assert.match(currentStep.textContent, /ขั้นตอนปัจจุบัน/);
  assert.ok(progress);
  assert.equal(progress.getAttribute('aria-valuemin'), '0');
  assert.equal(progress.getAttribute('aria-valuemax'), '100');
  assert.equal(progress.getAttribute('aria-valuenow'), '29');
  assert.equal(progress.getAttribute('aria-valuetext'), 'เสร็จสิ้น 2 จาก 7 ขั้นตอน');

  await mounted.unmount();
});

test('PhotoGallery names thumbnail controls and publishes selected state', async () => {
  const mounted = await mount(
    createElement(PhotoGallery, {
      photos: ['https://example.test/1.jpg', 'https://example.test/2.jpg'],
      alt: 'ภาพสินค้า',
    })
  );

  const group = document.querySelector(
    '[role="group"][aria-label="เลือกรูปภาพ ภาพสินค้า"]'
  );
  const buttons = Array.from(group?.querySelectorAll('button') ?? []);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
  assert.equal(buttons[1].getAttribute('aria-label'), 'ดูรูปที่ 2 จาก 2: ภาพสินค้า');

  await click(buttons[1]);

  assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(
    document.querySelector('img[alt^="ภาพสินค้า"]')?.getAttribute('alt'),
    'ภาพสินค้า รูปที่ 2 จาก 2'
  );

  await mounted.unmount();
});

test('DownloadMenu exposes expanded state, moves focus into options, and restores it on Escape', async () => {
  let excelCalls = 0;
  let csvCalls = 0;
  function DummyIcon(props) {
    return createElement('span', { ...props, 'aria-hidden': 'true' });
  }

  const mounted = await mount(
    createElement(DownloadMenu, {
      label: 'ดาวน์โหลด',
      icon: DummyIcon,
      onSelectExcel() {
        excelCalls += 1;
      },
      onSelectCsv() {
        csvCalls += 1;
      },
    })
  );

  const trigger = document.querySelector('button[aria-expanded]');
  assert.ok(trigger);
  assert.equal(trigger.hasAttribute('aria-haspopup'), false);
  assert.match(trigger.className, /focus-visible:ring-brand-600/);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.focus();
  await click(trigger);

  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const groupId = trigger.getAttribute('aria-controls');
  const group = groupId ? document.getElementById(groupId) : null;
  assert.ok(group);
  const options = Array.from(group.querySelectorAll('button'));
  assert.equal(options.length, 2);
  assert.match(options[0].className, /focus-visible:ring-brand-600/);
  assert.equal(document.activeElement, options[0]);

  await keydown(options[0], 'Escape');

  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);

  await click(trigger);
  const reopenedGroup = document.getElementById(groupId);
  const reopenedOptions = Array.from(reopenedGroup?.querySelectorAll('button') ?? []);
  await click(reopenedOptions[1]);

  assert.equal(csvCalls, 1);
  assert.equal(excelCalls, 0);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);

  await mounted.unmount();
});

test('ProductFieldsForm associates validation errors and exposes status selection state', async () => {
  const value = {
    brand: '',
    categoryId: '',
    model: 'BOE021',
    sku: '',
    productName: 'Compact Hot Plate',
    warrantyMonths: 12,
    status: 'Active',
  };

  const mounted = await mount(
    createElement(ProductFieldsForm, {
      categories: [{ id: 'cookware', name: 'เครื่องครัว' }],
      brands: ['BRUNO'],
      value,
      errors: { brand: 'กรุณาระบุแบรนด์' },
      onChange() {},
    })
  );

  const brand = document.querySelector('input[list]');
  assert.ok(brand);
  assert.equal(brand.getAttribute('aria-invalid'), 'true');
  const describedBy = brand.getAttribute('aria-describedby');
  assert.ok(describedBy);
  const error = document.getElementById(describedBy);
  assert.ok(error);
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.textContent, 'กรุณาระบุแบรนด์');

  const statusButtons = Array.from(
    document.querySelectorAll('fieldset button[aria-pressed]')
  );
  assert.equal(statusButtons.length, 2);
  assert.match(statusButtons[0].className, /focus-visible:ring-brand-600/);
  assert.equal(statusButtons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(statusButtons[1].getAttribute('aria-pressed'), 'false');

  await mounted.unmount();
});

test('ImportChooseFile keeps the file input keyboard-focusable and associates validation feedback', async () => {
  const mounted = await mount(createElement(ImportChooseFile, { onFileParsed() {} }));
  const input = document.querySelector('input[type="file"]');
  assert.ok(input);
  assert.match(input.className, /\bsr-only\b/);
  assert.doesNotMatch(input.className, /\bhidden\b/);
  assert.match(input.closest('label')?.className ?? '', /focus-within:ring-brand-600/);

  input.focus();
  assert.equal(document.activeElement, input);

  const unsupported = new dom.window.File(['not csv'], 'products.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [unsupported],
  });
  await dispatch(input, new window.Event('change', { bubbles: true }));

  assert.equal(input.getAttribute('aria-invalid'), 'true');
  const describedBy = input.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  const alert = document.querySelector('[role="alert"]');
  assert.ok(alert);
  assert.ok(alert.id);
  assert.ok(describedBy.includes(alert.id));
  assert.match(alert.textContent, /รองรับเฉพาะไฟล์ CSV/);

  await mounted.unmount();
});

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

test('N7.7 scoped text tokens meet measured 4.5:1 contrast and reduced-motion CSS is present', async () => {
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const token = (name) => {
    const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `missing color token ${name}`);
    return match[1];
  };

  const pairs = [
    ['neutral-600', token('neutral-600'), token('canvas')],
    ['brand-600', token('brand-600'), token('brand-50')],
    ['success-700', token('success-700'), token('success-50')],
    ['warning-700', token('warning-700'), token('warning-50')],
    ['danger-700', token('danger-700'), token('danger-50')],
  ];

  for (const [name, foreground, background] of pairs) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }

  const focusIndicatorRatio = contrastRatio(token('brand-600'), '#ffffff');
  assert.ok(
    focusIndicatorRatio >= 3,
    `brand-600 focus indicator contrast ${focusIndicatorRatio.toFixed(2)}:1 is below 3:1`
  );

  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(css, /transition-duration:\s*0\.01ms\s*!important/);
});

test('bounded import result copy is Thai-first with no stale English fallback sentence', async () => {
  const source = await readFile(
    new URL(
      '../src/features/master-data/products/components/import/ImportResultStep.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /รายการไม่ถูกเปลี่ยนแปลง/);
  assert.doesNotMatch(source, /left untouched|already up to date or had errors/);
});
