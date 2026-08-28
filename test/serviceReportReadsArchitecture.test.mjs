import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const worker = read('worker/src/serviceReportReadRoutes.ts');
const dispatcher = read('worker/src/index.ts');
const firestoreRepository = read('src/repositories/firestoreServiceReportsRepository.ts');
const browserRepository = read('src/repositories/workerServiceReportReadRepository.ts');
const historyHook = read('src/hooks/useServiceReports.ts');
const approvalHook = read('src/hooks/useApprovalConsoleReads.ts');
const rules = read('firestore.rules');
const indexes = JSON.parse(read('firestore.indexes.json'));

test('D24 GET is mode-independent and method-compatible with the existing POST path', () => {
  assert.match(dispatcher, /request\.method === 'GET'/);
  assert.match(dispatcher, /handleServiceReportHistoryRead/);
  assert.match(dispatcher, /request\.method === 'POST'.*SERVICE_JOBS_PREFIX/s);
  assert.doesNotMatch(worker, /serviceReportV2Mode/);
});

test('D24 authorizes through profile and authoritative Service Job before its bounded query', () => {
  const profile = worker.indexOf("store.get('staffProfiles', uid)");
  const job = worker.indexOf("store.get('serviceJobs', serviceJobId)");
  const query = worker.indexOf('store.queryHistory(serviceJobId, HISTORY_LIMIT)');
  assert.ok(profile > 0 && job > profile && query > job);
  assert.match(worker, /const HISTORY_LIMIT = 51/);
  assert.match(worker, /equal\('serviceJobId', stringValue\(serviceJobId\)\)/);
});

test('D24 no longer uses a browser collection listener', () => {
  assert.doesNotMatch(firestoreRepository, /subscribeToServiceJob/);
  assert.doesNotMatch(firestoreRepository, /where\('serviceJobId'/);
  assert.match(firestoreRepository, /fetchHistoryForServiceJob/);
});

test('ordinary history has per-job identity, fencing, lifecycle refresh, and visible stale state', () => {
  assert.match(historyHook, /historyCache\.get\(serviceJobId\)/);
  assert.match(historyHook, /reportsJobId === serviceJobId/);
  assert.match(historyHook, /AbortController/);
  assert.match(historyHook, /historyGeneration/);
  assert.match(historyHook, /window\.addEventListener\('focus'/);
  assert.match(historyHook, /document\.addEventListener\('visibilitychange'/);
  assert.match(historyHook, /applyProvisional/);
  assert.match(historyHook, /setIsHistoryStale\(true\)/);
  assert.match(historyHook, /await refreshHistory\(\)/);
});

test('D25 exposes only the three exact queue routes and separate review detail', () => {
  assert.match(dispatcher, /\/service-reports\/approval-queue'/);
  assert.match(dispatcher, /approval-queue\/report-number\//);
  assert.match(dispatcher, /approval-queue\/tracking-reference\//);
  assert.match(dispatcher, /approval-review/);
  assert.doesNotMatch(browserRepository, /genericFilter|filterReports|listAllReports/);
});

test('D25 queue query, lookahead, cursor, batch authorization, and digest checks are pinned', () => {
  assert.match(worker, /equal\('brandId'/);
  assert.match(worker, /equal\('schemaVersion', \{ integerValue: '2' \}\)/);
  assert.match(worker, /equal\('approvalState', stringValue\('pending'\)\)/);
  assert.match(worker, /fieldPath: 'finalizedAt'.*DESCENDING/s);
  assert.match(worker, /fieldPath: '__name__'.*DESCENDING/s);
  assert.match(worker, /limit: input\.pageSize \+ 1/);
  assert.match(worker, /before: false/);
  assert.match(worker, /new Set\(reports\.map/);
  assert.match(worker, /store\.batchGet/);
  assert.match(worker, /computeServiceReportFinalDigest/);
});

test('D25 browser repository and lifecycle bind decisions to a displayed review digest', () => {
  assert.match(browserRepository, /fetchPendingApprovalQueue/);
  assert.match(browserRepository, /fetchApprovalReview/);
  assert.match(approvalHookCode, /approvalQueueCacheKey/);
  assert.match(approvalHookCode, /AbortController/);
  assert.match(approvalHookCode, /generation/);
  assert.match(approvalHookCode, /appendUnique/);
  assert.match(approvalHookCode, /review\.finalContentDigest/);
  assert.match(approvalHookCode, /onDecisionCommitted\(\)/);
  assert.match(approvalHookCode, /normalized\.cursor \?\? null/);
  assert.match(browserRepository, /isReviewPart/);
  assert.match(browserRepository, /normalizedSearchForRequest/);
  assert.doesNotMatch(approvalHookCode, /onDecisionCommitted\(\);\s*await fetchReview/);
});

test('read surfaces expose no transaction, mutation, R2, Product Import, or public tracking path', () => {
  for (const forbidden of [
    'beginTransaction', 'commit(', 'idempotency', 'ATTACHMENTS_BUCKET',
    'serviceReportApprovals', 'brandApprovalPolicies', 'productImports',
    '/public/tracking',
  ]) {
    assert.equal(worker.includes(forbidden), false, forbidden);
  }
});

test('final Rules deny all report lists and retain direct GET plus V2 draft CAS', () => {
  const match = rules.match(/match \/serviceReports\/\{reportId\} \{([\s\S]*?)\n    \}/);
  assert.ok(match);
  assert.match(match[1], /allow get: if staffOwnsServiceReport/);
  assert.match(match[1], /allow list: if false/);
  assert.match(match[1], /allow update: if validV2DraftUpdate/);
});

test('the frozen three indexes remain exact and no fourth index is introduced', () => {
  assert.equal(indexes.indexes.length, 3);
  assert.deepEqual(
    indexes.indexes.map((index) => index.fields.map((field) => field.fieldPath)),
    [
      ['brandId', 'schemaVersion', 'approvalState', 'finalizedAt', '__name__'],
      ['brandId', 'schemaVersion', 'approvalState', 'reportNo', 'finalizedAt', '__name__'],
      [
        'brandId', 'schemaVersion', 'approvalState',
        'snapshot.trackingReference', 'finalizedAt', '__name__',
      ],
    ]
  );
});

const serviceReportsSection = read(
  'src/features/service-jobs/components/ServiceReportsSection.tsx'
);
const serviceReportService = read('src/services/serviceReport.ts');

// Prose in a comment must never satisfy — or break — a source-conformance
// assertion. A comment saying "deliberately NOT localeCompare" is evidence of
// the opposite of a violation, so assertions run against code only.
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const historyHookCode = codeOnly(historyHook);
const approvalHookCode = codeOnly(approvalHook);
const serviceReportsSectionCode = codeOnly(serviceReportsSection);
const serviceReportServiceCode = codeOnly(serviceReportService);
const workerCode = codeOnly(worker);

test('BLOCKER-4R5-1: ordinary history exposes no generic approve/reject command', () => {
  // The hook's public surface must not offer decide(), and its body must not
  // reach the V2 terminal-decision transport at all.
  assert.doesNotMatch(historyHookCode, /\bdecide\s*[:(]/);
  assert.doesNotMatch(historyHookCode, /decideV2/);
  assert.doesNotMatch(serviceReportsSectionCode, /decideV2|\bdecide\(/);
});

test('BLOCKER-4R5-1: the approval console is the only decideV2 caller in the browser', () => {
  const callers = ['src/hooks/useApprovalConsoleReads.ts'];
  for (const path of [
    'src/hooks/useServiceReports.ts',
    'src/features/service-jobs/components/ServiceReportsSection.tsx',
  ]) {
    assert.doesNotMatch(codeOnly(read(path)), /decideV2/, `${path} must not call decideV2`);
  }
  assert.match(codeOnly(read(callers[0])), /repositories\.serviceReports\.decideV2/);
});

test('BLOCKER-4R5-1: decide() runs the guard before dispatching the mutation', () => {
  const decideBody = approvalHookCode.slice(
    approvalHookCode.indexOf('const decide = async'),
    approvalHookCode.indexOf('setDecidingIdentity(identity);')
  );
  assert.match(decideBody, /evaluateApprovalDecisionGuard\(/);
  assert.match(decideBody, /throw new ApprovalDecisionGuardError\(/);
  // The guard must be evaluated before the transport call, not after.
  assert.ok(
    approvalHookCode.indexOf('evaluateApprovalDecisionGuard(') <
      approvalHookCode.indexOf('repositories.serviceReports.decideV2')
  );
});

test('BLOCKER-4R5-1: the decision digest comes from the review, never from a caller', () => {
  // decide() takes exactly (decision, rejectionReason) — no digest parameter.
  assert.match(
    approvalHook,
    /const decide = async \(\s*decision: 'approved' \| 'rejected',\s*rejectionReason: string \| null\s*\): Promise<void> =>/
  );
  assert.match(approvalHookCode, /review\.finalContentDigest/);
  assert.doesNotMatch(approvalHookCode, /expectedFinalDigest\s*:/);
});

test('BLOCKER-4R5-1: decisionEnabled is derived from the same guard decide() enforces', () => {
  const enabled = approvalHookCode.slice(approvalHookCode.lastIndexOf('decisionEnabled:'));
  assert.match(enabled.slice(0, 600), /evaluateApprovalDecisionGuard\(/);
});

test('D24: documentary ordering is ordinal, never locale-sensitive', () => {
  assert.doesNotMatch(serviceReportServiceCode, /localeCompare|Intl\.Collator/);
  assert.match(serviceReportServiceCode, /export function compareOrdinal/);
  assert.match(serviceReportServiceCode, /export function compareServiceReportDocumentaryOrder/);
  assert.match(serviceReportServiceCode, /\.sort\(compareServiceReportDocumentaryOrder\)/);
});

test('D24: the 51-row sentinel is decided on row count before any row is parsed', () => {
  const limitCheck = worker.indexOf('history_limit_exceeded');
  const rowParse = worker.indexOf('documents.map((document) => historyItem');
  assert.ok(limitCheck !== -1 && rowParse !== -1);
  assert.ok(
    limitCheck < rowParse,
    'the limit sentinel must be thrown before rows are mapped through historyItem'
  );
  assert.match(worker, /documents\.length === HISTORY_LIMIT/);
});

test('D24: ordinary history UI consumes loading, error, stale, and refresh', () => {
  for (const state of ['isHistoryLoading', 'isHistoryStale', 'historyError', 'refresh']) {
    assert.match(
      serviceReportsSection,
      new RegExp(state),
      `ServiceReportsSection must render ${state}`
    );
  }
  assert.match(serviceReportsSection, /LoadingState/);
  assert.match(serviceReportsSection, /onClick=\{refresh\}/);
});

// ---------------------------------------------------------------------------
// Phase 6R-B — Approval Console UI (page-layer wiring on top of the frozen
// D25 hooks).
//
// Phase 6R-B.2 correction to this header: the components ARE mountable now.
// test/support/componentRuntime.mjs implements the wider surface a component
// needs (JSX, forwardRef, memo, useId, useLayoutEffect, context, portals) on
// top of the same dispatcher idea, and the behavior these assertions used to
// stand in for is proven by mounting and driving the real components in
// test/approvalConsoleInteractionRuntime.test.mjs and
// test/approvalConsoleEvidenceRuntime.test.mjs. What remains here is the
// narrower class of claim a runtime test genuinely cannot make: that a
// forbidden call site exists NOWHERE in a file, rather than that it did not
// happen along one exercised path.
// ---------------------------------------------------------------------------

const approvalConsolePage = read(
  'src/features/approval-console/pages/ApprovalConsolePage.tsx'
);
const approvalDecisionControls = read(
  'src/features/approval-console/components/ApprovalDecisionControls.tsx'
);
const evidenceList = read('src/features/approval-console/components/EvidenceList.tsx');
const evidencePreviewHook = read('src/features/approval-console/hooks/useEvidencePreview.ts');
const approvalConsoleRouteGuard = read('src/auth/ApprovalConsoleRouteGuard.tsx');
const approvalConsoleAccess = read('src/services/approvalConsoleAccess.ts');

const approvalConsolePageCode = codeOnly(approvalConsolePage);
const approvalDecisionControlsCode = codeOnly(approvalDecisionControls);
const evidenceListCode = codeOnly(evidenceList);

test('Phase 6R-B: ApprovalConsolePage is the only new useApprovalQueue/useApprovalReview caller', () => {
  assert.match(approvalConsolePageCode, /useApprovalQueue\(/);
  assert.match(approvalConsolePageCode, /useApprovalReview\(/);
  for (const path of [
    'src/features/service-jobs/components/ServiceReportsSection.tsx',
    'src/features/approval-console/components/ApprovalQueueList.tsx',
    'src/features/approval-console/components/ApprovalReviewPanel.tsx',
    'src/features/approval-console/components/ApprovalDecisionControls.tsx',
    'src/features/approval-console/components/EvidenceList.tsx',
  ]) {
    const code = codeOnly(read(path));
    assert.doesNotMatch(code, /useApprovalQueue\(|useApprovalReview\(/, `${path} must not call the D25 hooks directly`);
  }
});

test('Phase 6R-B: the page passes the selected queue item\'s own serviceJobId/reportId, and queue.refresh verbatim as onDecisionCommitted', () => {
  assert.match(
    approvalConsolePageCode,
    /useApprovalReview\(\s*serviceJobId,\s*reportId,\s*onDecisionCommitted\s*\)/
  );
  assert.match(
    approvalConsolePageCode,
    /onDecisionCommitted=\{queue\.refresh\}/
  );
  assert.match(
    approvalConsolePageCode,
    /setSelected\(\{\s*serviceJobId:\s*item\.serviceJobId,\s*reportId:\s*item\.reportId\s*\}\)/
  );
});

test('Phase 6R-B: ApprovalDecisionControls never calls decideV2 directly — only through review.decide', () => {
  assert.doesNotMatch(approvalDecisionControlsCode, /decideV2/);
  assert.match(approvalDecisionControlsCode, /review\.decide\(/);
});

test('Phase 6R-B: ServiceReportsSection (ordinary history) never gains a decision surface', () => {
  assert.doesNotMatch(serviceReportsSectionCode, /ApprovalDecisionControls/);
  assert.doesNotMatch(serviceReportsSectionCode, /decideV2|\bdecide\(/);
});

test('Phase 6R-B: evidence is only ever rendered via a URL resolved through getDownloadUrl, never a raw R2 key concatenation', () => {
  assert.match(codeOnly(evidencePreviewHook), /repositories\.attachments\.getDownloadUrl\(/);
  // No <a href=...> or <img src=...> may be built directly from the raw key
  // (e.g. `service-jobs/${...}` or the loop variable `key`) — only from the
  // resolved `state.url`.
  assert.doesNotMatch(evidenceListCode, /href=\{`?\$\{?key/);
  assert.doesNotMatch(evidenceListCode, /src=\{`?\$\{?key/);
  assert.match(evidenceListCode, /href=\{state\.url\}/);
});

test('Phase 6R-B.2 (SF-3): no evidence path anywhere reads a caught error\'s message', () => {
  // The runtime suite proves the safe message is what renders along the paths
  // it drives; this proves there is no OTHER path that could render a raw one.
  const evidencePreviewCode = codeOnly(evidencePreviewHook);
  assert.doesNotMatch(evidencePreviewCode, /error\.message|caught\.message/);
  assert.match(evidencePreviewCode, /safeEvidenceErrorMessage\(/);
  assert.doesNotMatch(evidenceListCode, /\.message/);
});

test('Phase 6R-B.2 (SF-2): every object URL the evidence controller creates is fenced and released', () => {
  const evidencePreviewCode = codeOnly(evidencePreviewHook);
  // A resolution that no longer owns the controller revokes rather than publishes.
  assert.match(evidencePreviewCode, /URL\.revokeObjectURL/);
  assert.match(evidencePreviewCode, /ownership/);
  assert.match(evidencePreviewCode, /useEvidencePreview\(ownerKey: string\)/);
  // The owner identity comes from the review being displayed, not from a
  // component-local guess.
  assert.match(evidenceListCode, /useEvidencePreview\(`\$\{serviceJobId\}/);
});

test('Phase 6R-B.2 (SF-4): the queue list can only claim emptiness from authoritative data', () => {
  const queueListCode = codeOnly(read(
    'src/features/approval-console/components/ApprovalQueueList.tsx'
  ));
  assert.match(queueListCode, /queue\.hasAuthoritativeData/);
  // The empty state must not be reachable from items.length alone.
  assert.doesNotMatch(queueListCode, /queue\.items\.length === 0 \?/);
});

test('Phase 6R-B: the UI role gate is defense-in-depth only and never consults canImportProducts', () => {
  assert.doesNotMatch(codeOnly(approvalConsoleAccess), /canImportProducts/);
  assert.match(approvalConsoleRouteGuard, /repairReportActor\?\.role/);
});

test('Phase 6R-B: no direct Firestore Approval Console list is introduced by the UI', () => {
  for (const path of [
    'src/features/approval-console/pages/ApprovalConsolePage.tsx',
    'src/features/approval-console/components/ApprovalQueueList.tsx',
    'src/features/approval-console/components/ApprovalQueueSearchControls.tsx',
  ]) {
    const code = codeOnly(read(path));
    assert.doesNotMatch(code, /firebase\/firestore|collection\(|onSnapshot\(/, `${path} must not touch Firestore directly`);
  }
});
