import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createComponentRuntimeServer, COMPONENT_RUNTIME_PATH } from './support/componentRuntimeServer.mjs';

// Phase 6R-B.2 — SF-5 runtime interaction fidelity for the two surfaces
// Phase 4R.6 §37 found were only covered by a one-shot SSR render: the queue
// search-mode controls and the approve/reject decision modals. Both are mounted
// for real here and driven through their own controls; nothing below asserts on
// source text, and nothing re-implements what the components do.
//
// Modal renders through createPortal, which the runtime's react-dom shim
// renders in place; its focus-trap effect bails out at its own null-ref guard
// because there is no DOM. Focus/inert behavior is therefore NOT claimed by
// this suite — only the decision wiring is.

const vite = await createComponentRuntimeServer('interaction');
after(() => vite.close());

const { mountComponent, createElement, deferred } = await vite.ssrLoadModule(COMPONENT_RUNTIME_PATH);
const { ApprovalQueueSearchControls } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalQueueSearchControls.tsx'
);
const { ApprovalDecisionControls } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalDecisionControls.tsx'
);
const { ApprovalReviewPanel } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalReviewPanel.tsx'
);
const { ApprovalDecisionGuardError } = await vite.ssrLoadModule(
  '/src/hooks/useApprovalConsoleReads.ts'
);
const { GUARD_REASON_MESSAGES } = await vite.ssrLoadModule(
  '/src/features/approval-console/approvalConsoleUi.ts'
);

// --- search controls -------------------------------------------------------

const QUEUE_TAB = 'คิวที่รอการอนุมัติ';
const REPORT_TAB = 'ค้นหาเลขที่ใบรายงาน';
const TRACKING_TAB = 'ค้นหาเลขติดตาม';

function mountSearch() {
  const requests = [];
  const root = mountComponent(
    createElement(ApprovalQueueSearchControls, {
      onRequestChange: (request) => requests.push(request),
    })
  );
  return { root, requests, last: () => requests[requests.length - 1] };
}

const input = (root) => root.find((node) => node.type === 'input');
const selectedTab = (root) =>
  root.find((node) => node.props.role === 'tab' && node.props['aria-selected'] === true);

test('search: the base queue mode is selected on mount and offers no search field', () => {
  const { root, requests } = mountSearch();
  assert.equal(root.byRole('tab').length, 3);
  assert.ok(root.text().includes(QUEUE_TAB));
  assert.equal(input(root), null);
  assert.deepEqual(requests, [], 'mounting emits no request of its own');
  root.unmount();
});

test('search: switching queue -> report-number opens an exact-match field and resets to the base queue', async () => {
  const { root, requests, last } = mountSearch();
  await root.click(root.button(REPORT_TAB));

  assert.ok(input(root), 'the report-number field is now mounted');
  assert.equal(input(root).props.value, '');
  assert.ok(root.text().includes('ค้นหาแบบตรงตัวเท่านั้น'));
  assert.deepEqual(last(), { mode: 'queue', pageSize: 25 });
  assert.equal(requests.length, 1);
  root.unmount();
});

test('search: typing an exact report number submits a report-number request verbatim', async () => {
  const { root, last } = mountSearch();
  await root.click(root.button(REPORT_TAB));
  await root.type(input(root), 'FR-2026-000001');

  assert.deepEqual(last(), {
    mode: 'report-number',
    reportNo: 'FR-2026-000001',
    pageSize: 25,
  });
  assert.equal(input(root).props.value, 'FR-2026-000001', 'the field is controlled by the component');
  root.unmount();
});

test('search: switching queue -> tracking-reference submits a tracking-reference request', async () => {
  const { root, last } = mountSearch();
  await root.click(root.button(TRACKING_TAB));
  await root.type(input(root), 'BRN-2026-000001');

  assert.deepEqual(last(), {
    mode: 'tracking-reference',
    trackingReference: 'BRN-2026-000001',
    pageSize: 25,
  });
  root.unmount();
});

test('search: blank and whitespace-only input never issues a search request', async () => {
  const { root, requests, last } = mountSearch();
  await root.click(root.button(REPORT_TAB));
  await root.type(input(root), 'FR-2026-000001');
  await root.type(input(root), '');
  assert.deepEqual(last(), { mode: 'queue', pageSize: 25 });

  await root.type(input(root), '   ');
  assert.deepEqual(last(), { mode: 'queue', pageSize: 25 });
  assert.ok(
    requests.every((request) => request.mode !== 'report-number' || request.reportNo.trim().length > 0),
    'no search request is ever issued for blank text'
  );
  root.unmount();
});

test('search: pressing the queue tab returns to the base queue and clears the field', async () => {
  const { root, last } = mountSearch();
  await root.click(root.button(REPORT_TAB));
  await root.type(input(root), 'FR-2026-000001');
  assert.equal(last().mode, 'report-number');

  await root.click(root.button(QUEUE_TAB));
  assert.deepEqual(last(), { mode: 'queue', pageSize: 25 });
  assert.equal(input(root), null, 'the search field is gone in base queue mode');
  assert.ok(selectedTab(root) && root.text().includes(QUEUE_TAB));
  root.unmount();
});

test('search: a mode switch retains no prior-mode text and issues no prior-mode request', async () => {
  const { root, requests, last } = mountSearch();
  await root.click(root.button(REPORT_TAB));
  await root.type(input(root), 'FR-2026-000001');

  await root.click(root.button(TRACKING_TAB));
  assert.equal(input(root).props.value, '', 'the previous mode\'s text does not carry over');
  assert.deepEqual(last(), { mode: 'queue', pageSize: 25 }, 'the switch itself resets to the base queue');

  await root.type(input(root), 'FR-2026-000001');
  assert.deepEqual(
    last(),
    { mode: 'tracking-reference', trackingReference: 'FR-2026-000001', pageSize: 25 },
    'the same text now searches in the new mode only'
  );
  const afterSwitch = requests.slice(requests.length - 2);
  assert.ok(
    afterSwitch.every((request) => request.mode !== 'report-number'),
    'no stale report-number request is emitted after the switch'
  );
  root.unmount();
});

// --- decision modals -------------------------------------------------------

// Phase 6R-B.3 (R6R-SF5) — A and B are two DIFFERENT reviews, in both id
// components. The Phase 6R-B.2 version of this helper had one hard-coded
// identity, so the cross-review test below compared a review with itself and
// could not fail. Everything a decision modal owns is keyed off exactly these
// two fields.
const REVIEW_A = { serviceJobId: 'BRN-2026-000001', reportId: 'report-a' };
const REVIEW_B = { serviceJobId: 'BRN-2026-000002', reportId: 'report-b' };

function decisionState(overrides = {}, identity = REVIEW_A) {
  const calls = [];
  const state = {
    review: { ...identity, approvalState: 'pending' },
    decisionEnabled: true,
    isLoading: false,
    isDeciding: false,
    isStale: false,
    error: null,
    refresh() {},
    async decide(...args) {
      calls.push(args);
    },
    ...overrides,
  };
  return { state, calls };
}

function mountDecision(state) {
  return mountComponent(createElement(ApprovalDecisionControls, { review: state }));
}

// A complete ApprovalReviewV1 for the identity given, wrapped around the same
// decision state the controls-level tests use, so the panel-level test drives
// the real ApprovalReviewPanel -> ApprovalDecisionControls seam rather than a
// stand-in. No evidence ids: the evidence lifecycle has its own suite, and an
// empty list keeps the attachments repository out of this one entirely.
function panelState(state, identity) {
  return {
    ...state,
    review: {
      reviewVersion: 1,
      ...identity,
      reportNo: `FR-2026-${identity.reportId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      finalizedAt: '2026-02-01T00:00:00.000Z',
      approvalState: 'pending',
      predecessorReportId: null,
      createdBy: { role: 'technician', displayName: 'ช่างทดสอบ' },
      finalizedBy: { role: 'technician', displayName: 'ช่างทดสอบ' },
      content: {
        technician: 'ช่างทดสอบ',
        customerReportedProblem: 'เปิดไม่ติด',
        inspectionFindings: 'พบฟิวส์ขาด',
        serviceActions: ['repair'],
        parts: [],
        technicianRemark: '',
        resultStatus: 'repaired',
        resultDetail: '',
        evidenceAttachmentIds: [],
        claimNo: null,
        factoryReference: null,
        warrantyOutcome: 'covered',
      },
      snapshot: {
        trackingReference: identity.serviceJobId,
        customerName: 'ลูกค้าทดสอบ',
        customerPhone: '0800000000',
        customerEmail: 'test@example.com',
        brandCode: 'BRN',
        brandName: 'Bruno Thailand',
        productName: 'สินค้าทดสอบ',
        modelOrSku: 'SKU-1',
        serialNumber: 'SN-0001',
        customerReportedProblem: 'เปิดไม่ติด',
      },
      finalizedFromRevision: 1,
      finalContentDigest: `sha256:v1:${'a'.repeat(64)}`,
    },
  };
}

test('decision: the approve modal opens on demand and is absent until then', async () => {
  const { state } = decisionState();
  const root = mountDecision(state);
  assert.ok(!root.text().includes('ยืนยันการอนุมัติใบรายงาน'));

  await root.click(root.button('อนุมัติ'));
  const dialog = root.find((node) => node.props.role === 'dialog');
  assert.ok(dialog, 'the approve confirmation is a labelled dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.ok(root.text().includes('ยืนยันการอนุมัติใบรายงาน'));
  root.unmount();
});

test('decision: confirming an approval sends decision "approved" with no rejection reason', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('อนุมัติ'));
  await root.click(root.button('ยืนยันการอนุมัติ'));

  assert.deepEqual(calls, [['approved', null]]);
  assert.ok(!root.text().includes('ยืนยันการอนุมัติใบรายงาน'), 'the modal closes on success');
  root.unmount();
});

test('decision: decide() is called with exactly two arguments — no caller-supplied digest', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));
  await root.type(root.field('textarea'), 'a');
  await root.click(root.button('ยืนยันการปฏิเสธ'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2, 'the UI passes exactly decision + reason, nothing more');
  assert.deepEqual(calls[0], ['rejected', 'a']);
  assert.ok(
    !calls.flat().some((argument) => typeof argument === 'string' && argument.includes('sha256:')),
    'no digest-shaped value is ever handed to decide()'
  );
  root.unmount();
});

test('decision: the reject modal opens with a labelled reason field', async () => {
  const { state } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));

  assert.ok(root.find((node) => node.props.role === 'dialog'));
  assert.ok(root.field('textarea'), 'a reason field is mounted');
  assert.ok(root.text().includes('เหตุผลในการปฏิเสธ'));
  root.unmount();
});

test('decision: a blank or whitespace-only rejection reason cannot be submitted', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));

  assert.equal(root.button('ยืนยันการปฏิเสธ').props.disabled, true, 'blank reason is refused');
  await root.type(root.field('textarea'), '    ');
  assert.equal(root.button('ยืนยันการปฏิเสธ').props.disabled, true, 'whitespace-only is refused');

  await assert.rejects(
    async () => root.click(root.button('ยืนยันการปฏิเสธ')),
    /disabled/,
    'the control genuinely cannot be actuated'
  );
  assert.deepEqual(calls, []);
  root.unmount();
});

test('decision: a valid rejection sends the trimmed reason', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));
  await root.type(root.field('textarea'), '  สภาพเครื่องไม่ตรงกับรายงาน  ');
  await root.click(root.button('ยืนยันการปฏิเสธ'));

  assert.deepEqual(calls, [['rejected', 'สภาพเครื่องไม่ตรงกับรายงาน']]);
  root.unmount();
});

test('decision: an in-flight decision disables every terminal control', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));
  await root.type(root.field('textarea'), 'เหตุผล');

  await root.rerender(
    createElement(ApprovalDecisionControls, { review: { ...state, isDeciding: true } })
  );

  assert.equal(root.button('ยืนยันการปฏิเสธ'), null, 'the confirm control now reads as in progress');
  assert.equal(root.button('กำลังปฏิเสธ').props.disabled, true);
  assert.equal(root.button('ยกเลิก').props.disabled, true, 'cancel cannot abandon a commit mid-flight');
  assert.equal(root.button('กำลังดำเนินการ').props.disabled, true, 'the approve entry point is disabled');
  assert.equal(root.button('ปฏิเสธ').props.disabled, true, 'the reject entry point is disabled');
  assert.deepEqual(calls, []);
  root.unmount();
});

test('decision: entry points are disabled whenever the hook says a decision is not permitted', () => {
  const { state } = decisionState({ decisionEnabled: false });
  const root = mountDecision(state);
  assert.equal(root.button('อนุมัติ').props.disabled, true);
  assert.equal(root.button('ปฏิเสธ').props.disabled, true);
  root.unmount();
});

test('decision: cancelling either modal sends no mutation', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);

  await root.click(root.button('อนุมัติ'));
  await root.click(root.button('ยกเลิก'));
  assert.ok(!root.text().includes('ยืนยันการอนุมัติใบรายงาน'));

  await root.click(root.button('ปฏิเสธ'));
  await root.type(root.field('textarea'), 'เหตุผลที่จะไม่ถูกส่ง');
  await root.click(root.button('ยกเลิก'));
  assert.ok(!root.text().includes('ยืนยันการปฏิเสธ'));

  assert.deepEqual(calls, [], 'no decision was ever dispatched');
  root.unmount();
});

test('decision: closing the dialog with its X control sends no mutation', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('อนุมัติ'));

  const close = root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'ปิดกล่องโต้ตอบ'
  );
  assert.ok(close, 'the dialog offers a labelled close control');
  await root.click(close);

  assert.ok(!root.text().includes('ยืนยันการอนุมัติใบรายงาน'));
  assert.deepEqual(calls, []);
  root.unmount();
});

// --- cross-review modal identity (Phase 6R-B.3, finding R6R-SF5) -----------
//
// The Phase 6R-B.2 test these replace built A and B from one hard-coded
// identity and ended in a literal tautology
// (`deepEqual(second.calls.length === 0 ? [] : second.calls, second.calls)`),
// so it passed against a component that would happily confirm A's modal into
// B. A and B below differ in BOTH serviceJobId and reportId, and every
// assertion is about observable dispatch, not source text.

const APPROVE_MODAL = 'ยืนยันการอนุมัติใบรายงาน';
const APPROVE_OPEN = 'อนุมัติ';
const APPROVE_CONFIRM = 'ยืนยันการอนุมัติ';
const REJECT_OPEN = 'ปฏิเสธ';
const REJECT_CONFIRM = 'ยืนยันการปฏิเสธ';
const A_REASON = 'A: สภาพเครื่องไม่ตรงกับรายงาน';

test('decision: an approve modal opened under review A dispatches nothing when a distinct review B becomes current', async () => {
  const a = decisionState({}, REVIEW_A);
  const b = decisionState({}, REVIEW_B);
  const root = mountDecision(a.state);
  await root.click(root.button(APPROVE_OPEN));
  assert.ok(root.text().includes(APPROVE_MODAL), 'A opened its own confirmation');

  // The approver moves to a genuinely different report while it is still open.
  await root.rerender(createElement(ApprovalDecisionControls, { review: b.state }));

  assert.ok(!root.text().includes(APPROVE_MODAL), "A's modal does not survive under B");
  const confirm = root.button(APPROVE_CONFIRM);
  assert.equal(confirm, null, 'no confirm control survives the identity change');
  if (confirm) await root.click(confirm);
  await root.flush();

  assert.deepEqual(a.calls, [], 'the superseded review is never decided');
  assert.deepEqual(b.calls, [], 'B is never decided by a modal it did not open');
  root.unmount();
});

test('decision: a reject modal opened under A dispatches nothing under a distinct B, and B inherits no part of its reason', async () => {
  const a = decisionState({}, REVIEW_A);
  const b = decisionState({}, REVIEW_B);
  const root = mountDecision(a.state);
  await root.click(root.button(REJECT_OPEN));
  await root.type(root.field('textarea'), A_REASON);
  assert.equal(root.field('textarea').props.value, A_REASON, "A's reason is entered");

  await root.rerender(createElement(ApprovalDecisionControls, { review: b.state }));

  assert.equal(root.field('textarea'), null, "A's reject modal does not survive under B");
  const confirm = root.button(REJECT_CONFIRM);
  assert.equal(confirm, null, 'no confirm control survives the identity change');
  if (confirm) await root.click(confirm);
  await root.flush();
  assert.deepEqual(a.calls, [], 'A is never decided');
  assert.deepEqual(b.calls, [], 'B is never decided by a modal it did not open');
  assert.ok(!root.text().includes(A_REASON), "A's reason is nowhere on screen under B");

  // B opening its own reject modal starts from an empty field.
  await root.click(root.button(REJECT_OPEN));
  assert.equal(root.field('textarea').props.value, '', 'B starts with no inherited reason');
  assert.equal(
    root.button(REJECT_CONFIRM).props.disabled,
    true,
    "B's confirm is refused, so A's reason cannot have carried over invisibly"
  );
  root.unmount();
});

test('decision: a same-identity rerender keeps the modal and a legitimate decision still dispatches exactly once', async () => {
  const first = decisionState({}, REVIEW_A);
  const root = mountDecision(first.state);
  await root.click(root.button(REJECT_OPEN));
  await root.type(root.field('textarea'), A_REASON);

  // A new state object for the SAME review identity — a refresh, not a move.
  const again = decisionState({}, REVIEW_A);
  await root.rerender(createElement(ApprovalDecisionControls, { review: again.state }));

  assert.ok(root.field('textarea'), 'the modal survives a same-identity rerender');
  assert.equal(root.field('textarea').props.value, A_REASON, 'so does its reason');

  await root.click(root.button(REJECT_CONFIRM));
  assert.deepEqual(again.calls, [['rejected', A_REASON]], 'the current review is decided once');
  assert.deepEqual(first.calls, [], 'the superseded state object is never called');
  assert.equal(root.field('textarea'), null, 'the modal closes on success');
  root.unmount();
});

test('decision: a modal that outlives a detour to B and back to A still belongs to A and decides only A', async () => {
  // Retention across a same-identity return is not the defect: the modal is
  // still the one A opened, so confirming it decides A. What must never happen
  // is it being reachable, or dispatchable, while B is current. (In the real
  // page ApprovalReviewPanel's identity key discards it outright; this drives
  // the component directly, where the ownership derivation is the only guard.)
  const a = decisionState({}, REVIEW_A);
  const b = decisionState({}, REVIEW_B);
  const root = mountDecision(a.state);
  await root.click(root.button(APPROVE_OPEN));

  await root.rerender(createElement(ApprovalDecisionControls, { review: b.state }));
  assert.equal(root.button(APPROVE_CONFIRM), null, 'unreachable while B is current');
  assert.deepEqual(b.calls, [], 'and undispatchable against B');

  await root.rerender(createElement(ApprovalDecisionControls, { review: a.state }));
  const confirm = root.button(APPROVE_CONFIRM);
  if (confirm) await root.click(confirm);
  await root.flush();

  assert.deepEqual(b.calls, [], 'B is never decided');
  assert.ok(
    a.calls.length === 0 || (a.calls.length === 1 && a.calls[0][0] === 'approved'),
    'any decision that does happen is A\'s own, at most once'
  );
  root.unmount();
});

test('decision: an identity change while a decision is in flight adds no second and no cross-identity dispatch', async () => {
  const gate = deferred();
  const aCalls = [];
  const bCalls = [];
  const a = decisionState(
    {
      async decide(...args) {
        aCalls.push(args);
        await gate.promise;
      },
    },
    REVIEW_A
  );
  const b = decisionState(
    {
      async decide(...args) {
        bCalls.push(args);
      },
    },
    REVIEW_B
  );

  const root = mountDecision(a.state);
  await root.click(root.button(APPROVE_OPEN));
  await root.click(root.button(APPROVE_CONFIRM));
  assert.equal(aCalls.length, 1, "A's decision is in flight");

  await root.rerender(createElement(ApprovalDecisionControls, { review: b.state }));
  gate.resolve();
  await root.flush();

  assert.equal(aCalls.length, 1, 'the in-flight decision is not dispatched a second time');
  assert.deepEqual(bCalls, [], "A's completion never dispatches against B");
  assert.ok(!root.text().includes(APPROVE_MODAL), "A's modal is gone under B");
  root.unmount();
});

test('decision: the review panel remounts the decision controls when the review identity changes', async () => {
  const a = decisionState({}, REVIEW_A);
  const b = decisionState({}, REVIEW_B);
  const root = mountComponent(
    createElement(ApprovalReviewPanel, { review: panelState(a.state, REVIEW_A), onBack() {} })
  );

  await root.click(root.button(APPROVE_OPEN));
  assert.ok(root.text().includes(APPROVE_MODAL), 'A opened its confirmation inside the panel');

  await root.rerender(
    createElement(ApprovalReviewPanel, { review: panelState(b.state, REVIEW_B), onBack() {} })
  );

  assert.ok(!root.text().includes(APPROVE_MODAL), 'the identity key destroyed the previous modal state');
  assert.equal(root.button(APPROVE_CONFIRM), null, 'no confirm control survived the remount');
  await root.flush();
  assert.deepEqual(a.calls, []);
  assert.deepEqual(b.calls, []);
  root.unmount();
});

test('decision: unmounting while a modal is open dispatches nothing', async () => {
  const { state, calls } = decisionState();
  const root = mountDecision(state);
  await root.click(root.button('ปฏิเสธ'));
  await root.type(root.field('textarea'), 'เหตุผล');
  root.unmount();
  await root.flush();

  assert.deepEqual(calls, []);
});

test('decision: a refused decision surfaces the guard\'s Thai reason, not a raw Error message', async () => {
  const { state } = decisionState({
    async decide() {
      throw new ApprovalDecisionGuardError('review-stale');
    },
  });
  const root = mountDecision(state);
  await root.click(root.button('อนุมัติ'));
  await root.click(root.button('ยืนยันการอนุมัติ'));

  const alert = root.find((node) => node.props.role === 'alert');
  assert.ok(alert, 'the refusal is announced');
  assert.ok(root.text().includes(GUARD_REASON_MESSAGES['review-stale']));
  assert.ok(!root.text().includes('Approval decision refused'), 'the raw guard message is not shown');
  assert.ok(root.text().includes('ยืนยันการอนุมัติ'), 'the modal stays open so the approver can react');
  root.unmount();
});

test('decision: a failed commit never renders as success and keeps the modal open', async () => {
  const { state } = decisionState({
    async decide() {
      throw new Error('worker unavailable');
    },
  });
  const root = mountDecision(state);
  await root.click(root.button('อนุมัติ'));
  await root.click(root.button('ยืนยันการอนุมัติ'));

  assert.ok(root.find((node) => node.props.role === 'alert'));
  assert.ok(root.text().includes('ยืนยันการอนุมัติใบรายงาน'), 'the confirmation is not dismissed');
  root.unmount();
});
