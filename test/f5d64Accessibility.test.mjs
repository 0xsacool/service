import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { ServiceJobDetailLink } = await vite.ssrLoadModule(
  '/src/features/service-jobs/pages/ServiceJobsList.tsx'
);
const { ProductMasterDetailLink } = await vite.ssrLoadModule(
  '/src/features/master-data/products/pages/ProductsPage.tsx'
);
const { ProductDetailTabs } = await vite.ssrLoadModule(
  '/src/features/master-data/products/pages/ProductDetail.tsx'
);
const { ChipToggleGroup } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/ChipToggleGroup.tsx'
);
const { SearchInput } = await vite.ssrLoadModule(
  '/src/shared/components/search/SearchInput.tsx'
);
const { PhotoEvidenceSection } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/PhotoEvidenceSection.tsx'
);
const { AsyncErrorAlert } = await vite.ssrLoadModule(
  '/src/shared/components/AsyncErrorAlert.tsx'
);
const { Modal } = await vite.ssrLoadModule('/src/shared/components/Modal.tsx');
const { routeDocumentTitle } = await vite.ssrLoadModule('/src/app/routeTitles.ts');
const { scheduleCancellableAnimationFrame, shouldFocusMainAfterRouteChange } =
  await vite.ssrLoadModule('/src/app/routeFocus.ts');
const {
  drawerAccessibilityReducer,
  drawerNavigationFocusDestination,
  INITIAL_DRAWER_ACCESSIBILITY_STATE,
  shouldCloseDrawerAtDesktop,
  STAFF_DESKTOP_MEDIA_QUERY,
} = await vite.ssrLoadModule('/src/shared/layouts/drawerAccessibility.ts');
const { serviceJobCreateErrorMessage, serviceJobUpdateErrorMessage } =
  await vite.ssrLoadModule('/src/features/service-jobs/serviceJobErrorMessages.ts');
const { publicTrackingDocumentLanguage } = await vite.ssrLoadModule(
  '/src/features/tracking/publicTrackingLocale.ts'
);

function renderInRouter(element) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/'] }, element)
  );
}

test('desktop Service Job navigation exposes a native, meaningfully named link', () => {
  const markup = renderInRouter(
    createElement(ServiceJobDetailLink, { id: 'BRN-2026-000002' })
  );

  assert.match(markup, /<a /);
  assert.match(markup, /href="\/service-jobs\/BRN-2026-000002"/);
  assert.match(markup, /aria-label="เปิดรายละเอียดงานบริการ BRN-2026-000002"/);
});

test('desktop Product Master navigation exposes a native, meaningfully named link', () => {
  const markup = renderInRouter(
    createElement(ProductMasterDetailLink, {
      id: 'product-1',
      model: 'BOE021',
    })
  );

  assert.match(markup, /<a /);
  assert.match(markup, /href="\/master-data\/products\/product-1"/);
  assert.match(markup, /aria-label="เปิดรายละเอียดสินค้ารุ่น BOE021"/);
});

test('shared Modal renders a labelled modal dialog with a Thai close name', () => {
  const markup = renderToStaticMarkup(
    createElement(
      Modal,
      { title: 'ทดสอบกล่องโต้ตอบ', onClose() {} },
      createElement('button', null, 'ยืนยัน')
    )
  );

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="[^"]+"/);
  assert.match(markup, /aria-label="ปิดกล่องโต้ตอบ"/);
});

test('drawer structure keeps every modal control inside the dialog and isolates the complete background', async () => {
  const source = await readSource('src/shared/layouts/StaffShell.tsx');

  const backgroundStart = source.indexOf('data-drawer-background');
  const skipLink = source.indexOf('href="#main-content"');
  const drawerStart = source.indexOf('{/* Mobile drawer */}');
  const dialogStart = source.indexOf('<aside\n            ref={drawerRef}');
  const dialogEnd = source.indexOf('</aside>', dialogStart);
  const closeControl = source.indexOf('aria-label="ปิดเมนู"', dialogStart);

  assert.ok(backgroundStart >= 0 && backgroundStart < skipLink);
  assert.ok(skipLink < drawerStart);
  assert.match(
    source,
    /data-drawer-background\s+inert=\{mobileOpen \? true : undefined\}/
  );
  assert.ok(dialogStart >= 0 && closeControl > dialogStart && closeControl < dialogEnd);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
});

test('drawer close policies fail safe at desktop and distinguish current-route focus', () => {
  assert.equal(STAFF_DESKTOP_MEDIA_QUERY, '(min-width: 1024px)');
  assert.equal(shouldCloseDrawerAtDesktop(true, true), true);
  assert.equal(shouldCloseDrawerAtDesktop(true, false), false);
  assert.equal(shouldCloseDrawerAtDesktop(false, true), false);
  assert.equal(drawerNavigationFocusDestination('/dashboard', '/dashboard'), 'main');
  assert.equal(drawerNavigationFocusDestination('/dashboard', '/service-jobs'), 'route');
});

test('StaffShell drawer state closes and releases its modal boundary at desktop', () => {
  const openState = drawerAccessibilityReducer(INITIAL_DRAWER_ACCESSIBILITY_STATE, {
    type: 'open',
  });
  assert.deepEqual(openState, { mobileOpen: true, pendingFocus: null });

  const unchangedMobileState = drawerAccessibilityReducer(openState, {
    type: 'desktop-media-change',
    desktopMatches: false,
  });
  assert.equal(unchangedMobileState, openState);

  const desktopState = drawerAccessibilityReducer(openState, {
    type: 'desktop-media-change',
    desktopMatches: true,
  });
  assert.deepEqual(desktopState, { mobileOpen: false, pendingFocus: 'main' });
  assert.equal(desktopState.mobileOpen, false);
});

test('StaffShell current-route navigation closes to main without restoring the opener', () => {
  const openState = drawerAccessibilityReducer(INITIAL_DRAWER_ACCESSIBILITY_STATE, {
    type: 'open',
  });
  const navigatedState = drawerAccessibilityReducer(openState, {
    type: 'navigate',
    currentPathname: '/dashboard',
    targetPathname: '/dashboard',
  });

  assert.deepEqual(navigatedState, { mobileOpen: false, pendingFocus: 'main' });
  assert.notEqual(navigatedState.pendingFocus, 'opener');
});

test('StaffShell different-route navigation leaves destination focus to route accessibility', () => {
  const openState = drawerAccessibilityReducer(INITIAL_DRAWER_ACCESSIBILITY_STATE, {
    type: 'open',
  });
  const navigatedState = drawerAccessibilityReducer(openState, {
    type: 'navigate',
    currentPathname: '/dashboard',
    targetPathname: '/service-jobs/new',
  });

  assert.deepEqual(navigatedState, { mobileOpen: false, pendingFocus: 'route' });
  assert.notEqual(navigatedState.pendingFocus, 'opener');
  assert.notEqual(navigatedState.pendingFocus, 'main');
});

test('StaffShell dismissal transition closes the drawer and restores its opener', () => {
  const openState = drawerAccessibilityReducer(INITIAL_DRAWER_ACCESSIBILITY_STATE, {
    type: 'open',
  });
  const dismissedState = drawerAccessibilityReducer(openState, { type: 'dismiss' });

  assert.deepEqual(dismissedState, { mobileOpen: false, pendingFocus: 'opener' });
});

test('StaffShell consumes the behaviorally tested transition boundary for every UI path', async () => {
  const source = await readSource('src/shared/layouts/StaffShell.tsx');

  assert.match(
    source,
    /useReducer\(\s*drawerAccessibilityReducer,\s*INITIAL_DRAWER_ACCESSIBILITY_STATE\s*\)/
  );
  assert.match(source, /const mobileOpen = drawerState\.mobileOpen/);
  assert.match(source, /type: 'desktop-media-change',\s*desktopMatches: event\.matches/);
  assert.match(
    source,
    /type: 'navigate',\s*currentPathname: location\.pathname,\s*targetPathname/
  );
  assert.match(
    source,
    /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*dismissMobileDrawer\(\);\s*return;/
  );
  assert.equal(source.match(/onClick=\{dismissMobileDrawer\}/g)?.length, 2);
  assert.ok((source.match(/handleDrawerNavigation\(item\.to\)/g)?.length ?? 0) >= 2);
});

test('multi-select chips expose selected state without changing values', () => {
  const markup = renderToStaticMarkup(
    createElement(ChipToggleGroup, {
      options: ['เปิดไม่ติด', 'มีเสียงดัง'],
      selected: ['เปิดไม่ติด'],
      onChange() {},
      ariaLabelledBy: 'problem-heading',
    })
  );

  assert.match(markup, /role="group"/);
  assert.match(markup, /aria-labelledby="problem-heading"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-pressed="false"/);
});

test('Product Detail tabs expose a complete selected tab and panel relationship', () => {
  const markup = renderToStaticMarkup(
    createElement(ProductDetailTabs, {
      activeTab: 'accessories',
      onChange() {},
    })
  );

  assert.match(markup, /role="tablist"/);
  assert.match(markup, /role="tab"/);
  assert.match(markup, /id="product-tab-accessories"/);
  assert.match(markup, /aria-selected="true"/);
  assert.match(markup, /aria-controls="product-panel-accessories"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /tabindex="-1"/);
});

test('customer SearchInput has an explicit accessible name and described caption', () => {
  const markup = renderToStaticMarkup(
    createElement(SearchInput, {
      value: '',
      onChange() {},
      autoFocus: false,
    })
  );

  assert.match(markup, /<label[^>]+for="[^"]+"[^>]*>ค้นหาลูกค้า<\/label>/);
  assert.match(markup, /<input[^>]+id="[^"]+"/);
  assert.match(markup, /aria-describedby="[^"]+"/);
});

test('duplicate photo filenames still produce distinct Thai removal names', () => {
  const markup = renderToStaticMarkup(
    createElement(PhotoEvidenceSection, {
      photos: [
        { id: 'one', dataUrl: 'data:image/png;base64,AA==', fileName: 'front.png' },
        { id: 'two', dataUrl: 'data:image/png;base64,AA==', fileName: 'front.png' },
      ],
      onChange() {},
    })
  );

  assert.match(markup, /aria-label="ลบรูป front\.png รูปที่ 1"/);
  assert.match(markup, /aria-label="ลบรูป front\.png รูปที่ 2"/);
});

test('async failures use assertive alert semantics and all approved forms consume them', async () => {
  const markup = renderToStaticMarkup(
    createElement(AsyncErrorAlert, { message: 'บันทึกไม่สำเร็จ' })
  );
  assert.match(markup, /role="alert"/);

  const sources = await Promise.all(
    [
      'src/features/auth/pages/Login.tsx',
      'src/features/service-jobs/pages/NewServiceJob.tsx',
      'src/features/service-jobs/pages/ServiceJobDetails.tsx',
    ].map(readSource)
  );
  for (const source of sources) assert.match(source, /<AsyncErrorAlert/);

  const fakeInternalError = new Error(
    'FirebaseError: Worker Service Job creation failed (500) at projects/private'
  );
  const createMessage = serviceJobCreateErrorMessage(fakeInternalError);
  const updateMessage = serviceJobUpdateErrorMessage(fakeInternalError);
  assert.equal(createMessage, 'ไม่สามารถสร้างงานบริการได้ กรุณาลองอีกครั้ง');
  assert.equal(updateMessage, 'ไม่สามารถบันทึกการเปลี่ยนแปลงได้ กรุณาลองอีกครั้ง');
  assert.doesNotMatch(createMessage, /Firebase|Worker|500|private/);
  assert.doesNotMatch(updateMessage, /Firebase|Worker|500|private/);
  assert.doesNotMatch(sources[1], /error instanceof Error \? error\.message/);
  assert.doesNotMatch(sources[2], /error instanceof Error \? error\.message/);
});

test('route title mapping covers exact and detail staff routes', () => {
  assert.equal(routeDocumentTitle('/dashboard'), 'ภาพรวมงานบริการ — Service Tech');
  assert.equal(
    routeDocumentTitle('/service-jobs/BRN-2026-000002'),
    'รายละเอียดงานบริการ — Service Tech'
  );
  assert.equal(
    routeDocumentTitle('/master-data/products/product-1'),
    'รายละเอียดสินค้า — Service Tech'
  );
});

test('route focus policy protects New Service Job and its scheduled frame is cancellable', () => {
  assert.equal(shouldFocusMainAfterRouteChange(null, '/dashboard'), false);
  assert.equal(shouldFocusMainAfterRouteChange('/dashboard', '/service-jobs/new'), false);
  assert.equal(
    shouldFocusMainAfterRouteChange('/dashboard', '/service-jobs/BRN-2026-000002'),
    true
  );

  const scheduledFrames = new Map();
  const cleanup = scheduleCancellableAnimationFrame(
    () => assert.fail('cancelled route frame must not execute'),
    (callback) => {
      scheduledFrames.set(17, callback);
      return 17;
    },
    (handle) => scheduledFrames.delete(handle)
  );
  assert.equal(scheduledFrames.size, 1);
  cleanup();
  assert.equal(scheduledFrames.size, 0);
});

test('public locale maps directly to the root document language', () => {
  for (const locale of ['th', 'en', 'ja', 'zh-CN']) {
    assert.equal(publicTrackingDocumentLanguage(locale), locale);
  }
});

test('approved form, filter, status, skip-link, and main-landmark boundaries remain present', async () => {
  const [shell, products, details, problem, notes, app] = await Promise.all([
    readSource('src/shared/layouts/StaffShell.tsx'),
    readSource('src/features/master-data/products/pages/ProductsPage.tsx'),
    readSource('src/features/service-jobs/pages/ServiceJobDetails.tsx'),
    readSource('src/features/service-jobs/components/ProblemSection.tsx'),
    readSource('src/features/service-jobs/components/InternalNotesSection.tsx'),
    readSource('src/app/App.tsx'),
  ]);

  assert.match(shell, /href="#main-content"/);
  assert.match(shell, /<main/);
  assert.match(shell, /id="main-content"/);
  assert.match(app, /<RouteAccessibility \/>/);
  assert.match(products, /aria-pressed=\{statusFilter === f\}/);
  assert.match(products, /aria-label="กรองตามหมวดหมู่สินค้า"/);
  assert.match(products, /htmlFor="product-sort-order"/);
  assert.match(details, /type="radio"/);
  assert.match(details, /name="service-job-status"/);
  assert.match(details, /htmlFor="service-job-team-note"/);
  assert.match(problem, /aria-labelledby="service-job-problem-heading"/);
  assert.match(notes, /aria-labelledby="service-job-internal-notes-heading"/);
});
