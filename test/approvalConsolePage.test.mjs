import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Phase 6R-B — Approval Console presentational components. ApprovalQueueList
// and ApprovalReviewPanel take a fully-formed ApprovalQueueState /
// ApprovalReviewState as a prop (they never call the D25 hooks themselves —
// only ApprovalConsolePage/SelectedReview do), so each state (loading, empty,
// populated, error, stale) can be rendered directly via
// renderToStaticMarkup with a hand-built state object — no async resolution
// needed. This is real component rendering, not a source-regex assertion.
//
// A one-shot renderToStaticMarkup pass never runs effects, so it cannot prove
// interactive/asynchronous behavior. Phase 6R-B.2 stopped relying on manual
// verification for that: button clicks, search-mode switching, the decision
// modals and evidence resolution are mounted and driven for real in
// test/approvalConsoleInteractionRuntime.test.mjs and
// test/approvalConsoleEvidenceRuntime.test.mjs, on top of the D25 hook's own
// lifecycle suite (test/approvalConsoleHookLifecycle.test.mjs). What stays
// here is the pure state-to-markup rendering contract, which a prop-driven
// component is exactly the right seam for.

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { ApprovalQueueList } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalQueueList.tsx'
);
const { ApprovalReviewPanel } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalReviewPanel.tsx'
);
const { ApprovalQueueSearchControls } = await vite.ssrLoadModule(
  '/src/features/approval-console/components/ApprovalQueueSearchControls.tsx'
);
const { repositories } = await vite.ssrLoadModule('/src/repositories/repositoryProvider.ts');

const DIGEST = `sha256:v1:${'a'.repeat(64)}`;
const EVIDENCE_KEY = 'service-jobs/BRN-2026-000001/before/photo-1.jpg';

// hasAuthoritativeData defaults to true — i.e. a Worker page HAS been received
// for this request identity — so each case below opts out of it explicitly when
// modelling a state where nothing has loaded yet (SF-4).
function baseQueueState(overrides = {}) {
  return {
    items: [],
    nextCursor: null,
    isLoading: false,
    isLoadingMore: false,
    isStale: false,
    error: null,
    hasAuthoritativeData: true,
    refresh() {},
    loadMore() {},
    ...overrides,
  };
}

function queueItem(overrides = {}) {
  return {
    queueItemVersion: 1,
    reportId: 'report-1',
    serviceJobId: 'BRN-2026-000001',
    reportNo: 'FR-2026-000001',
    trackingReference: 'BRN-2026-000001',
    finalizedAt: '2026-02-01T00:00:00.000Z',
    approvalState: 'pending',
    predecessorReportId: null,
    technician: 'ช่างทดสอบ',
    finalizedByDisplayName: 'ช่างทดสอบ',
    warrantyOutcome: 'covered',
    customerName: 'ลูกค้าทดสอบ',
    productName: 'สินค้าทดสอบ',
    modelOrSku: 'SKU-1',
    serialNumber: 'SN-0001',
    customerReportedProblem: 'เปิดไม่ติด',
    resultStatus: 'repaired',
    finalContentDigest: DIGEST,
    evidenceCount: 1,
    ...overrides,
  };
}

function baseReviewState(overrides = {}) {
  return {
    review: null,
    decisionEnabled: false,
    isLoading: false,
    isDeciding: false,
    isStale: false,
    error: null,
    refresh() {},
    async decide() {},
    ...overrides,
  };
}

function reviewFixture(overrides = {}) {
  return {
    reviewVersion: 1,
    reportId: 'report-1',
    serviceJobId: 'BRN-2026-000001',
    reportNo: 'FR-2026-000001',
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
      parts: [{ description: 'ฟิวส์', partNo: 'F-1', quantity: 1, remark: '' }],
      technicianRemark: 'ทดสอบแล้วใช้งานได้ปกติ',
      resultStatus: 'repaired',
      resultDetail: '',
      evidenceAttachmentIds: [EVIDENCE_KEY],
      claimNo: null,
      factoryReference: null,
      warrantyOutcome: 'covered',
    },
    snapshot: {
      trackingReference: 'BRN-2026-000001',
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
    finalContentDigest: DIGEST,
    ...overrides,
  };
}

function render(element) {
  return renderToStaticMarkup(element);
}

// --- ApprovalQueueList -------------------------------------------------

// SF-4 case A — nothing authoritative has arrived yet.
test('queue: initial loading state renders LoadingState, not the empty state or list', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ isLoading: true, hasAuthoritativeData: false }),
      onSelect() {},
    })
  );
  assert.match(markup, /กำลังโหลดรายการที่รอการอนุมัติ/);
  assert.doesNotMatch(markup, /ไม่มีรายการที่รอการอนุมัติ/);
  assert.doesNotMatch(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
});

// SF-4 case B — the failure that Phase 4R.6 §11 caught reading as an empty
// queue. A request that failed before any page arrived must render the error
// and nothing else: it has no authority to say the queue is empty.
test('queue: a failed initial request renders the error alone, never the authoritative empty state', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({
        error: new Error('เครือข่ายขัดข้อง'),
        hasAuthoritativeData: false,
      }),
      onSelect() {},
    })
  );
  assert.match(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
  assert.doesNotMatch(markup, /ไม่มีรายการที่รอการอนุมัติ/);
  assert.doesNotMatch(markup, /กำลังโหลดรายการที่รอการอนุมัติ/);
});

test('queue: a failed invalid search renders the error alone, not an empty result', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({
        error: new Error('invalid_report_number'),
        isLoading: false,
        hasAuthoritativeData: false,
      }),
      onSelect() {},
    })
  );
  assert.match(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
  assert.doesNotMatch(markup, /ไม่มีรายการที่รอการอนุมัติ/);
});

// SF-4 case D — only a successful, authoritative page may claim emptiness.
test('queue: empty state renders only for an authoritative, non-failing empty page', () => {
  const markup = render(
    createElement(ApprovalQueueList, { queue: baseQueueState(), onSelect() {} })
  );
  assert.match(markup, /ไม่มีรายการที่รอการอนุมัติ/);
  assert.doesNotMatch(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
  assert.doesNotMatch(markup, /กำลังโหลดรายการที่รอการอนุมัติ/);
});

test('queue: an authoritative empty page that then fails to refresh drops the empty claim', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ error: new Error('refresh failed'), hasAuthoritativeData: true }),
      onSelect() {},
    })
  );
  assert.match(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
  assert.doesNotMatch(markup, /ไม่มีรายการที่รอการอนุมัติ/);
});

// SF-4 case E — a populated authoritative page renders as the list.
test('queue: populated state renders one row per item and no empty state', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem(), queueItem({ reportId: 'report-2', reportNo: 'FR-2026-000002' })] }),
      onSelect() {},
    })
  );
  assert.match(markup, /FR-2026-000001/);
  assert.match(markup, /FR-2026-000002/);
  assert.doesNotMatch(markup, /ไม่มีรายการที่รอการอนุมัติ/);
});

// SF-4 case C — a failed refresh keeps the retained list, with the error above.
test('queue: error state renders as a separate block, not replacing already-loaded items', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()], error: new Error('เครือข่ายขัดข้อง') }),
      onSelect() {},
    })
  );
  assert.match(markup, /โหลดรายการที่รอการอนุมัติไม่สำเร็จ/);
  assert.match(markup, /เครือข่ายขัดข้อง/);
  assert.match(markup, /FR-2026-000001/);
});

test('queue: stale banner renders only when not also in an error state', () => {
  const staleMarkup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()], isStale: true }),
      onSelect() {},
    })
  );
  assert.match(staleMarkup, /ข้อมูลอาจไม่เป็นปัจจุบัน/);

  const errorAndStaleMarkup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()], isStale: true, error: new Error('x') }),
      onSelect() {},
    })
  );
  assert.doesNotMatch(errorAndStaleMarkup, /ข้อมูลอาจไม่เป็นปัจจุบัน/);
});

test('queue: pagination — load-more control present with a cursor, absent without one', () => {
  const withCursor = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()], nextCursor: 'opaque-cursor-value' }),
      onSelect() {},
    })
  );
  assert.match(withCursor, /โหลดเพิ่มเติม/);

  const withoutCursor = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()], nextCursor: null }),
      onSelect() {},
    })
  );
  assert.doesNotMatch(withoutCursor, /โหลดเพิ่มเติม/);
});

test('queue row never renders a raw digest, uid, or R2 path', () => {
  const markup = render(
    createElement(ApprovalQueueList, {
      queue: baseQueueState({ items: [queueItem()] }),
      onSelect() {},
    })
  );
  assert.doesNotMatch(markup, /sha256:v1:/);
  assert.doesNotMatch(markup, /service-jobs\//);
});

// --- ApprovalQueueSearchControls (initial render only — SSR is one-shot) --

test('search controls: base queue mode renders no search field, all three mode tabs present', () => {
  const markup = render(
    createElement(ApprovalQueueSearchControls, { onRequestChange() {} })
  );
  assert.match(markup, /คิวที่รอการอนุมัติ/);
  assert.match(markup, /ค้นหาเลขที่ใบรายงาน/);
  assert.match(markup, /ค้นหาเลขติดตาม/);
  assert.doesNotMatch(markup, /<input/);
});

// --- ApprovalReviewPanel -------------------------------------------------

test('review: loading state (no review yet) renders LoadingState and no decision controls', () => {
  const markup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ isLoading: true }),
      onBack() {},
    })
  );
  assert.match(markup, /กำลังโหลดใบรายงาน/);
  assert.doesNotMatch(markup, />อนุมัติ</);
});

test('review: error state renders ErrorState with the raw (safe) message', () => {
  const markup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ error: new Error('ไม่พบใบรายงาน') }),
      onBack() {},
    })
  );
  assert.match(markup, /โหลดใบรายงานไม่สำเร็จ/);
  assert.match(markup, /ไม่พบใบรายงาน/);
});

test('review: populated state renders business content and decision controls, never a raw uid/digest/R2 path', () => {
  const markup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ review: reviewFixture(), decisionEnabled: true }),
      onBack() {},
    })
  );
  assert.match(markup, /FR-2026-000001/);
  assert.match(markup, /เปิดไม่ติด/);
  assert.match(markup, /พบฟิวส์ขาด/);
  assert.match(markup, /อยู่ในประกัน/);
  assert.match(markup, />อนุมัติ</);
  assert.match(markup, /ปฏิเสธ/);
  // Privacy: no digest, no raw R2 evidence key, no uid-shaped field ever rendered.
  assert.doesNotMatch(markup, new RegExp(DIGEST));
  assert.doesNotMatch(markup, /service-jobs\/BRN-2026-000001\/before\/photo-1\.jpg/);
});

test('review: decision buttons are disabled when decisionEnabled is false', () => {
  const markup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ review: reviewFixture(), decisionEnabled: false }),
      onBack() {},
    })
  );
  const approveButton = markup.match(/<button[^>]*disabled[^>]*>\s*<svg[\s\S]*?อนุมัติ/);
  assert.ok(approveButton, 'expected the approve button to render as disabled');
});

test('review: evidence names come from attachment metadata, never the raw R2 key, with a graceful fallback', () => {
  repositories.attachments = {
    ...repositories.attachments,
    getForJob(jobId) {
      return jobId === 'BRN-2026-000001'
        ? [{ id: EVIDENCE_KEY, name: 'รูปก่อนซ่อม.jpg', category: 'before', size: 1024, contentType: 'image/jpeg' }]
        : [];
    },
  };
  const markup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ review: reviewFixture() }),
      onBack() {},
    })
  );
  assert.match(markup, /รูปก่อนซ่อม\.jpg/);
  assert.doesNotMatch(markup, /service-jobs\/BRN-2026-000001\/before\/photo-1\.jpg/);

  repositories.attachments = { ...repositories.attachments, getForJob: () => [] };
  const fallbackMarkup = render(
    createElement(ApprovalReviewPanel, {
      review: baseReviewState({ review: reviewFixture() }),
      onBack() {},
    })
  );
  assert.match(fallbackMarkup, /ไฟล์แนบไม่พร้อมใช้งาน/);
});
