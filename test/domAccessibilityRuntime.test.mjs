import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { installDomTestEnvironment } from './support/domTestEnvironment.mjs';

const dom = installDomTestEnvironment();
const React = await import('react');
const { act, createElement, Fragment, useEffect, useLayoutEffect, useRef } = React;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useNavigate } = await import('react-router-dom');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

const { Modal } = await vite.ssrLoadModule('/src/shared/components/Modal.tsx');
const { StaffShell } = await vite.ssrLoadModule('/src/shared/layouts/StaffShell.tsx');
const { AuthSessionContext } = await vite.ssrLoadModule(
  '/src/auth/authSessionContext.ts'
);
const { RouteAccessibility } = await vite.ssrLoadModule(
  '/src/app/RouteAccessibility.tsx'
);
const { STAFF_DESKTOP_MEDIA_QUERY } = await vite.ssrLoadModule(
  '/src/shared/layouts/drawerAccessibility.ts'
);

after(async () => {
  await vite.close();
  dom.cleanup();
});

beforeEach(() => {
  dom.resetBody();
  dom.setMediaMatches(STAFF_DESKTOP_MEDIA_QUERY, false);
});

async function mount(element) {
  const container = document.createElement('div');
  container.setAttribute('data-react-test-root', '');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    async rerender(nextElement) {
      await act(async () => {
        root.render(nextElement);
      });
    },
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

function keydown(key, options = {}) {
  return new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
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

test('Modal uses a real portal, isolates background, traps focus, and restores focus on unmount', async () => {
  const opener = document.createElement('button');
  opener.textContent = 'เปิด';
  document.body.append(opener);
  opener.focus();

  let closeCalls = 0;
  const mounted = await mount(
    createElement(
      Modal,
      {
        title: 'ทดสอบ DOM modal',
        onClose() {
          closeCalls += 1;
        },
      },
      createElement(
        Fragment,
        null,
        createElement('input', { id: 'modal-input', 'aria-label': 'ชื่อ' }),
        createElement('button', { id: 'modal-confirm', type: 'button' }, 'ยืนยัน')
      )
    )
  );

  const overlay = document.querySelector('[data-modal-overlay]');
  const dialog = document.querySelector('[role="dialog"]');
  const input = document.querySelector('#modal-input');
  const confirm = document.querySelector('#modal-confirm');
  const closeButton = document.querySelector('[aria-label="ปิดกล่องโต้ตอบ"]');

  assert.ok(overlay);
  assert.ok(dialog);
  assert.ok(input);
  assert.ok(confirm);
  assert.ok(closeButton);
  assert.equal(
    overlay.parentElement,
    document.body,
    'Modal must portal directly to body'
  );
  assert.equal(opener.inert, true);
  assert.equal(mounted.container.inert, true);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  await dom.nextAnimationFrame();
  assert.equal(document.activeElement, input, 'first form field receives initial focus');

  closeButton.focus();
  const reverseWrap = keydown('Tab', { shiftKey: true });
  await dispatch(document, reverseWrap);
  assert.equal(reverseWrap.defaultPrevented, true);
  assert.equal(
    document.activeElement,
    confirm,
    'Shift+Tab wraps first focusable to last'
  );

  confirm.focus();
  const forwardWrap = keydown('Tab');
  await dispatch(document, forwardWrap);
  assert.equal(forwardWrap.defaultPrevented, true);
  assert.equal(document.activeElement, closeButton, 'Tab wraps last focusable to first');

  const escape = keydown('Escape');
  await dispatch(document, escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(closeCalls, 1);

  await mounted.unmount();
  assert.equal(opener.inert, false);
  assert.equal(
    document.activeElement,
    opener,
    'focus returns to the element active before mount'
  );
  opener.remove();
});

test('Modal preventClose layout-effect ref blocks Escape during the protected commit', async () => {
  let closeCalls = 0;
  let commitEscape = null;

  function CommitProbe({ preventClose }) {
    useLayoutEffect(() => {
      if (!preventClose) return;
      const escape = keydown('Escape');
      document.dispatchEvent(escape);
      commitEscape = escape;
    }, [preventClose]);

    return createElement(
      Modal,
      {
        title: 'ป้องกันการปิด',
        preventClose,
        onClose() {
          closeCalls += 1;
        },
      },
      createElement('input', { 'aria-label': 'ข้อมูล' })
    );
  }

  const mounted = await mount(createElement(CommitProbe, { preventClose: false }));
  await mounted.rerender(createElement(CommitProbe, { preventClose: true }));

  assert.ok(commitEscape, 'parent layout effect must dispatch the commit-window Escape');
  assert.equal(commitEscape.defaultPrevented, true);
  assert.equal(
    closeCalls,
    0,
    'Modal layout effect must publish preventClose before the parent layout probe runs'
  );

  const overlayBackdrop = document.querySelector(
    '[data-modal-overlay] > [aria-hidden="true"]'
  );
  const closeButton = document.querySelector('[aria-label="ปิดกล่องโต้ตอบ"]');
  assert.ok(overlayBackdrop);
  assert.ok(closeButton);

  await click(overlayBackdrop);
  await click(closeButton);
  assert.equal(
    closeCalls,
    0,
    'all close controls remain blocked while preventClose is true'
  );

  await mounted.unmount();
});

test('negative control: passive ref synchronization is too late for the commit-window Escape', async () => {
  let closeCalls = 0;
  let commitEscape = null;

  function PassiveSynchronizationProbe({ preventClose }) {
    const preventCloseRef = useRef(preventClose);

    useEffect(() => {
      preventCloseRef.current = preventClose;
    }, [preventClose]);

    useEffect(() => {
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (!preventCloseRef.current) closeCalls += 1;
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    return null;
  }

  function CommitProbe({ preventClose }) {
    useLayoutEffect(() => {
      if (!preventClose) return;
      const escape = keydown('Escape');
      document.dispatchEvent(escape);
      commitEscape = escape;
    }, [preventClose]);

    return createElement(PassiveSynchronizationProbe, { preventClose });
  }

  const mounted = await mount(createElement(CommitProbe, { preventClose: false }));
  await mounted.rerender(createElement(CommitProbe, { preventClose: true }));

  assert.ok(commitEscape);
  assert.equal(commitEscape.defaultPrevented, true);
  assert.equal(
    closeCalls,
    1,
    'a useEffect-synchronized ref still exposes the stale false value in this commit window'
  );

  await mounted.unmount();
});

function staffSessionValue() {
  return {
    status: 'authorized',
    user: {
      uid: 'staff-dom-test',
      email: 'staff@example.test',
      async getIdToken() {
        return 'dom-test-token';
      },
    },
    staffProfile: {
      uid: 'staff-dom-test',
      brandId: 'bruno-thailand',
      canImportProducts: false,
      repairReportActor: null,
    },
    error: null,
    async signIn() {},
    async signOut() {},
    workerTokenProvider: {
      async getToken() {
        return 'dom-test-token';
      },
    },
  };
}

function staffShellElement() {
  return createElement(
    AuthSessionContext.Provider,
    { value: staffSessionValue() },
    createElement(
      MemoryRouter,
      { initialEntries: ['/dashboard'] },
      createElement(
        StaffShell,
        {
          search: '',
          setSearch() {},
        },
        createElement('p', null, 'DOM shell content')
      )
    )
  );
}

test('StaffShell mobile drawer applies inert, traps focus, and restores opener focus on Escape', async () => {
  const mounted = await mount(staffShellElement());
  const opener = document.querySelector('[aria-label="เปิดเมนู"]');
  const background = document.querySelector('[data-drawer-background]');
  assert.ok(opener);
  assert.ok(background);

  opener.focus();
  await click(opener);
  await dom.nextAnimationFrame();

  const drawer = document.querySelector(
    '[role="dialog"][aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"]'
  );
  assert.ok(drawer);
  assert.equal(background.inert, true);

  const initial = drawer.querySelector('[data-drawer-initial-focus]');
  assert.ok(initial);
  assert.equal(document.activeElement, initial);

  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = Array.from(drawer.querySelectorAll(selector));
  assert.ok(focusables.length >= 2);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  first.focus();
  const reverseWrap = keydown('Tab', { shiftKey: true });
  await dispatch(document, reverseWrap);
  assert.equal(reverseWrap.defaultPrevented, true);
  assert.equal(document.activeElement, last);

  last.focus();
  const forwardWrap = keydown('Tab');
  await dispatch(document, forwardWrap);
  assert.equal(forwardWrap.defaultPrevented, true);
  assert.equal(document.activeElement, first);

  const escape = keydown('Escape');
  await dispatch(document, escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(document.querySelector('[aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"]'), null);
  assert.equal(background.inert, false);
  assert.equal(document.activeElement, opener);

  await mounted.unmount();
});

test('StaffShell current-route drawer navigation closes to main focus and desktop transition does the same', async () => {
  const mounted = await mount(staffShellElement());
  const opener = document.querySelector('[aria-label="เปิดเมนู"]');
  const main = document.querySelector('#main-content');
  assert.ok(opener);
  assert.ok(main);

  await click(opener);
  await dom.nextAnimationFrame();
  const currentRouteLink = document.querySelector(
    '[role="dialog"] a[data-drawer-initial-focus]'
  );
  assert.ok(currentRouteLink);
  await click(currentRouteLink);
  assert.equal(document.querySelector('[aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"]'), null);
  assert.equal(document.activeElement, main);

  await click(opener);
  await dom.nextAnimationFrame();
  assert.ok(document.querySelector('[aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"]'));

  await act(async () => {
    dom.setMediaMatches(STAFF_DESKTOP_MEDIA_QUERY, true);
  });
  assert.equal(document.querySelector('[aria-label="เมนูนำทางสำหรับเจ้าหน้าที่"]'), null);
  assert.equal(document.activeElement, main);

  await mounted.unmount();
});

function RouteHarness({ targetPath }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(targetPath);
  }, [navigate, targetPath]);

  return createElement(
    Fragment,
    null,
    createElement(RouteAccessibility),
    createElement('button', { id: 'route-focus-sentinel', type: 'button' }, 'sentinel'),
    createElement('main', { id: 'route-main', tabIndex: -1 }, 'route content')
  );
}

test('RouteAccessibility moves focus after detail navigation but preserves New Service Job form focus policy', async () => {
  const renderRoute = (targetPath) =>
    createElement(
      MemoryRouter,
      { initialEntries: ['/dashboard'] },
      createElement(RouteHarness, { targetPath })
    );

  const mounted = await mount(renderRoute('/dashboard'));
  const main = document.querySelector('#route-main');
  const sentinel = document.querySelector('#route-focus-sentinel');
  assert.ok(main);
  assert.ok(sentinel);

  await mounted.rerender(renderRoute('/service-jobs/BRN-2026-000002'));
  await dom.nextAnimationFrame();
  assert.equal(document.activeElement, main);
  assert.equal(document.title, 'รายละเอียดงานบริการ — Service Tech');

  sentinel.focus();
  await mounted.rerender(renderRoute('/service-jobs/new'));
  await dom.nextAnimationFrame();
  assert.equal(
    document.activeElement,
    sentinel,
    'New Service Job keeps focus with the form instead of forcing main focus'
  );
  assert.equal(document.title, 'สร้างงานบริการใหม่ — Service Tech');

  await mounted.unmount();
});
