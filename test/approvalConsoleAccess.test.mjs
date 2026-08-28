import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createServer } from 'vite';

// Phase 6R-B — Approval Console UI role gating. canAccessApprovalConsoleForBackend
// is pure and unit-tested directly; ApprovalConsoleRouteGuard is proven as real
// component behavior (SSR static markup, no mocking of the guard itself) using
// the same vite.ssrLoadModule + renderToStaticMarkup seam as
// test/f5d64Accessibility.test.mjs.
//
// Phase 6R-B.2 (SF-1) — the matrix below is asserted for BOTH backend kinds.
// The gate used to short-circuit to true in mock, which handed technician and
// roleless staff the console's nav entry and route; Decision 047 requires them
// to fail closed in every mode, so backend kind is now proven irrelevant to the
// outcome rather than merely intended to be.

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { canAccessApprovalConsoleForBackend, canAccessApprovalConsole } = await vite.ssrLoadModule(
  '/src/services/approvalConsoleAccess.ts'
);
const { ApprovalConsoleRouteGuard } = await vite.ssrLoadModule(
  '/src/auth/ApprovalConsoleRouteGuard.tsx'
);
const { AuthSessionContext } = await vite.ssrLoadModule('/src/auth/authSessionContext.ts');

const BACKEND_KINDS = ['mock', 'firestore', null];
const ALLOWED_ROLES = ['approver', 'admin'];
const DENIED_ROLES = ['technician', null, undefined];

test('mock backend allows approver and admin', () => {
  assert.equal(canAccessApprovalConsoleForBackend('mock', 'approver'), true);
  assert.equal(canAccessApprovalConsoleForBackend('mock', 'admin'), true);
});

test('mock backend denies technician and roleless staff', () => {
  assert.equal(canAccessApprovalConsoleForBackend('mock', 'technician'), false);
  assert.equal(canAccessApprovalConsoleForBackend('mock', null), false);
  assert.equal(canAccessApprovalConsoleForBackend('mock', undefined), false);
});

test('firestore backend allows only approver/admin, denies technician/roleless', () => {
  assert.equal(canAccessApprovalConsoleForBackend('firestore', 'approver'), true);
  assert.equal(canAccessApprovalConsoleForBackend('firestore', 'admin'), true);
  assert.equal(canAccessApprovalConsoleForBackend('firestore', 'technician'), false);
  assert.equal(canAccessApprovalConsoleForBackend('firestore', null), false);
  assert.equal(canAccessApprovalConsoleForBackend('firestore', undefined), false);
});

test('the outcome is identical in every backend mode — no mode may bypass the role gate', () => {
  for (const role of ALLOWED_ROLES) {
    const results = BACKEND_KINDS.map((kind) => canAccessApprovalConsoleForBackend(kind, role));
    assert.deepEqual(results, [true, true, true], `${role} is allowed in every mode`);
  }
  for (const role of DENIED_ROLES) {
    const results = BACKEND_KINDS.map((kind) => canAccessApprovalConsoleForBackend(kind, role));
    assert.deepEqual(results, [false, false, false], `${String(role)} is denied in every mode`);
  }
});

test('canAccessApprovalConsole applies the same predicate the backend-explicit form does', () => {
  for (const role of [...ALLOWED_ROLES, ...DENIED_ROLES]) {
    assert.equal(
      canAccessApprovalConsole(role),
      canAccessApprovalConsoleForBackend('firestore', role),
      `${String(role)} resolves identically through both entry points`
    );
  }
});

test('canAccessApprovalConsole never accepts a canImportProducts-shaped argument', () => {
  // Structural proof by construction: the exported function takes exactly one
  // parameter (role). canImportProducts cannot be consulted because it is not
  // part of the signature at all.
  assert.equal(canAccessApprovalConsole.length, 1);
});

test('canImportProducts is independent of Approval Console access in every mode', () => {
  // A denied role stays denied whatever the Product Import capability says, and
  // an allowed role stays allowed without it — the two never move together.
  for (const kind of BACKEND_KINDS) {
    assert.equal(canAccessApprovalConsoleForBackend(kind, 'technician'), false);
    assert.equal(canAccessApprovalConsoleForBackend(kind, 'approver'), true);
  }
});

function sessionValue(role, { hasProfile = true } = {}) {
  return {
    status: 'authorized',
    user: { uid: 'uid-1', email: 'staff@example.com' },
    staffProfile: hasProfile
      ? {
          uid: 'uid-1',
          brandId: 'bruno-thailand',
          canImportProducts: true, // deliberately true, to prove it's ignored
          repairReportActor:
            role === undefined
              ? undefined
              : role === null
                ? null
                : { uid: 'uid-1', brandId: 'bruno-thailand', canImportProducts: true, role, displayName: 'QA Staff' },
        }
      : null,
    error: null,
    signIn: async () => {},
    signOut: async () => {},
    workerTokenProvider: { getToken: async () => null },
  };
}

function renderGuarded(role, options) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/approval-console'] },
      createElement(
        AuthSessionContext.Provider,
        { value: sessionValue(role, options) },
        createElement(
          Routes,
          null,
          createElement(
            Route,
            { element: createElement(ApprovalConsoleRouteGuard) },
            createElement(Route, {
              path: '/approval-console',
              element: createElement('div', { 'data-testid': 'protected' }, 'PROTECTED_CONSOLE_CONTENT'),
            })
          )
        )
      )
    )
  );
}

test('approver role renders the protected Approval Console content', () => {
  const markup = renderGuarded('approver');
  assert.match(markup, /PROTECTED_CONSOLE_CONTENT/);
});

test('admin role renders the protected Approval Console content', () => {
  const markup = renderGuarded('admin');
  assert.match(markup, /PROTECTED_CONSOLE_CONTENT/);
});

test('technician role is denied with the Thai fail-closed panel, never the protected content', () => {
  const markup = renderGuarded('technician');
  assert.doesNotMatch(markup, /PROTECTED_CONSOLE_CONTENT/);
  assert.match(markup, /ไม่มีสิทธิ์เข้าถึง Approval Console/);
});

test('roleless staff (repairReportActor null) is denied', () => {
  const markup = renderGuarded(null);
  assert.doesNotMatch(markup, /PROTECTED_CONSOLE_CONTENT/);
  assert.match(markup, /ไม่มีสิทธิ์เข้าถึง Approval Console/);
});

test('roleless staff (repairReportActor undefined) is denied', () => {
  const markup = renderGuarded(undefined);
  assert.doesNotMatch(markup, /PROTECTED_CONSOLE_CONTENT/);
});

test('staff with no profile at all is denied', () => {
  const markup = renderGuarded(undefined, { hasProfile: false });
  assert.doesNotMatch(markup, /PROTECTED_CONSOLE_CONTENT/);
  assert.match(markup, /ไม่มีสิทธิ์เข้าถึง Approval Console/);
});

test('a denied staff member is told why and offered a way back, in Thai', () => {
  const markup = renderGuarded('technician');
  assert.match(markup, /ผู้มีบทบาทผู้อนุมัติหรือผู้ดูแลระบบเท่านั้น/);
  assert.match(markup, /กลับหน้าภาพรวม/);
});

test('canImportProducts: true never grants a technician access through the route guard', () => {
  // sessionValue() sets canImportProducts: true on every profile precisely so
  // this cannot pass by accident — Product Import capability and Approval
  // Console access share no code path.
  assert.doesNotMatch(renderGuarded('technician'), /PROTECTED_CONSOLE_CONTENT/);
  assert.match(renderGuarded('approver'), /PROTECTED_CONSOLE_CONTENT/);
});

// Phase 6R-B.2 (SF-1) — the nav entry and the route guard must be the same
// decision, not two that happen to agree. StaffShell reads the role off the
// same staffProfile shape and hands it to the same exported predicate, so a
// role denied above cannot be offered the nav entry either.
test('navigation visibility is decided by the same canonical predicate as the route guard', async () => {
  const staffShell = await readFile(
    new URL('../src/shared/layouts/StaffShell.tsx', import.meta.url),
    'utf8'
  );
  assert.match(
    staffShell,
    /import \{ canAccessApprovalConsole \} from '\.\.\/\.\.\/services\/approvalConsoleAccess'/
  );
  assert.match(
    staffShell,
    /canSeeApprovalConsole = canAccessApprovalConsole\(\s*staffProfile\?\.repairReportActor\?\.role \?\? null\s*\)/
  );
  assert.equal(
    staffShell.match(/canSeeApprovalConsole/g).length,
    2,
    'the nav gate is read from one place only — no second, local rule'
  );
});
