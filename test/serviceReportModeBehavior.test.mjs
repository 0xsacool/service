import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const RUNTIME = fileURLToPath(new URL('./support/componentRuntime.mjs', import.meta.url));
const JSX_RUNTIME = fileURLToPath(new URL('./support/componentJsxRuntime.mjs', import.meta.url));
const REACT_DOM = fileURLToPath(new URL('./support/componentReactDom.mjs', import.meta.url));

class VisibilityDocument extends EventTarget {
  constructor() {
    super();
    this.visibilityState = 'visible';
  }
}

globalThis.window = new EventTarget();
globalThis.document = new VisibilityDocument();
globalThis.__SERVICE_REPORT_TEST_MODE__ = 'disabled';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: {
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: JSX_RUNTIME },
      { find: /^react\/jsx-runtime$/, replacement: JSX_RUNTIME },
      { find: /^react-dom$/, replacement: REACT_DOM },
      { find: /^react$/, replacement: RUNTIME },
    ],
  },
  define: {
    'import.meta.env.VITE_SERVICE_REPORT_V2_MODE': 'globalThis.__SERVICE_REPORT_TEST_MODE__',
  },
  ssr: { noExternal: ['lucide-react'] },
  optimizeDeps: { noDiscovery: true, include: [] },
  cacheDir: join(tmpdir(), 'service-report-mode-behavior-runtime'),
});
after(async () => {
  await vite.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__SERVICE_REPORT_TEST_MODE__;
});

const { createElement, mountComponent } = await vite.ssrLoadModule(RUNTIME);
const { useServiceReports } = await vite.ssrLoadModule('/src/hooks/useServiceReports.ts');
const { ServiceReportsSection } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/ServiceReportsSection.tsx'
);
const { repositories } = await vite.ssrLoadModule('/src/repositories/repositoryProvider.ts');

let jobSequence = 0;
const nextJobId = () => `BRN-2026-${String((jobSequence += 1)).padStart(6, '0')}`;

function makeReport(id, serviceJobId, overrides = {}) {
  return {
    id,
    sourceSchemaVersion: 1,
    serviceJobId,
    reportNo: 'FR-2026-000001',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: null,
    technician: 'QA Technician',
    customerReportedProblem: `Issue recorded in ${id}`,
    inspectionFindings: 'Fault reproduced',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: 'QA remark',
    resultStatus: 'repaired',
    resultDetail: 'Repair completed',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
    ...overrides,
  };
}

function makeV2Draft(id, serviceJobId) {
  return makeReport(id, serviceJobId, {
    sourceSchemaVersion: 2,
    schemaVersion: 2,
    reportId: id,
    brandId: 'bruno-thailand',
    activeDraftGeneration: 1,
    createdByUid: 'staff-uid-1',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'QA Technician',
    contentRevision: 0,
    predecessorReportId: null,
    warrantyOutcome: 'undetermined',
    finalizedByUid: null,
    finalizedByRoleSnapshot: null,
    finalizedByDisplayNameSnapshot: null,
    finalizedFromRevision: null,
    finalContentDigest: null,
    approvalState: 'not-submitted',
    currentApprovalEventId: null,
    approvalDecidedAt: null,
  });
}

function makeServiceJob(id) {
  return {
    id,
    brandId: 'bruno-thailand',
    serviceRequestNumber: id,
    customerName: 'QA Customer',
    customerPhone: '0000000000',
    customerEmail: 'qa@example.com',
    product: 'QA Product',
    serialNumber: 'SERIAL-1',
    issue: 'Reported issue',
    technician: 'QA Technician',
    warranty: false,
  };
}

function installRepositories(serviceJobId, initialReports) {
  let history = [...initialReports];
  let failNextV2Finalize = false;
  let loseNextV2FinalizeResponse = false;
  let committedV2Finalizations = 0;
  const finalizedByKey = new Map();
  const calls = { v1Update: [], v1Finalize: [], v2Update: [], v2Finalize: [] };
  const replace = (report) => {
    history = [...history.filter((item) => item.id !== report.id), report];
    return report;
  };
  repositories.serviceJobs = {
    ...repositories.serviceJobs,
    getById: (id) => id === serviceJobId ? makeServiceJob(id) : undefined,
  };
  repositories.attachments = {
    ...repositories.attachments,
    getForJob: () => [],
  };
  repositories.serviceReports = {
    ...repositories.serviceReports,
    async fetchHistoryForServiceJob(id) {
      return id === serviceJobId ? [...history] : [];
    },
    async updateDraft(reportId, patch, expectedUpdatedAt, idempotencyKey) {
      calls.v1Update.push({ reportId, patch, expectedUpdatedAt, idempotencyKey });
      const current = history.find((item) => item.id === reportId);
      assert.ok(current);
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw Object.assign(new Error('The V1 draft timestamp is stale'), { status: 412 });
      }
      return replace({ ...current, ...patch, updatedAt: '2026-02-01T00:00:00.000Z' });
    },
    async finalize(reportId) {
      calls.v1Finalize.push(reportId);
      const current = history.find((item) => item.id === reportId);
      assert.ok(current);
      return replace({
        ...current,
        status: 'final',
        finalizedAt: '2026-02-02T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
      });
    },
    async updateDraftV2(reportId, expectedContentRevision, patch, idempotencyKey) {
      calls.v2Update.push({ reportId, expectedContentRevision, patch, idempotencyKey });
      const current = history.find((item) => item.id === reportId);
      assert.ok(current);
      if (current.contentRevision !== expectedContentRevision) {
        throw Object.assign(new Error('The V2 draft revision is stale'), { status: 412 });
      }
      return replace({
        ...current,
        ...patch,
        contentRevision: expectedContentRevision + 1,
        updatedAt: '2026-02-01T00:00:00.000Z',
      });
    },
    async finalizeV2(reportId, expectedContentRevision, idempotencyKey) {
      calls.v2Finalize.push({ reportId, expectedContentRevision, idempotencyKey });
      const prior = finalizedByKey.get(idempotencyKey);
      if (prior) {
        assert.equal(prior.reportId, reportId);
        assert.equal(prior.expectedContentRevision, expectedContentRevision);
        return prior.report;
      }
      const current = history.find((item) => item.id === reportId);
      assert.ok(current);
      if (current.contentRevision !== expectedContentRevision) {
        throw Object.assign(new Error('The V2 finalize revision is stale'), { status: 412 });
      }
      if (failNextV2Finalize) {
        failNextV2Finalize = false;
        throw Object.assign(new Error('Simulated finalize failure'), { status: 503 });
      }
      const finalized = replace({
        ...current,
        status: 'final',
        finalizedAt: '2026-02-02T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
      });
      finalizedByKey.set(idempotencyKey, { reportId, expectedContentRevision, report: finalized });
      committedV2Finalizations += 1;
      if (loseNextV2FinalizeResponse) {
        loseNextV2FinalizeResponse = false;
        throw new TypeError('Simulated lost finalize response');
      }
      return finalized;
    },
  };
  return {
    calls,
    failNextV2Finalize() { failNextV2Finalize = true; },
    loseNextV2FinalizeResponse() { loseNextV2FinalizeResponse = true; },
    committedV2Finalizations: () => committedV2Finalizations,
    setHistory(next) { history = [...next]; },
    getHistory: () => [...history],
  };
}

function mountHookFor(serviceJobId) {
  let result;
  function Probe() {
    result = useServiceReports(serviceJobId);
    return null;
  }
  const root = mountComponent(createElement(Probe, null));
  return { root, result: () => result };
}

function mountSection(serviceJob) {
  return mountComponent(createElement(ServiceReportsSection, { serviceJob }));
}

test('the V1 hook rejects update and finalize locally in v2-active mode', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJobId = nextJobId();
  const report = makeReport('v1-hook-active', serviceJobId);
  const { calls } = installRepositories(serviceJobId, [report]);
  const host = mountHookFor(serviceJobId);
  await host.root.flush();

  await assert.rejects(
    host.result().updateDraft(report.id, { technicianRemark: 'must not call the repository' }),
    /V1 Service Reports are read-only/
  );
  await assert.rejects(host.result().finalize(report.id), /V1 Service Reports are read-only/);
  assert.deepEqual(calls.v1Update, []);
  assert.deepEqual(calls.v1Finalize, []);
  host.root.unmount();
});

for (const mode of ['disabled', 'compatibility']) {
  test(`the V1 hook still updates and finalizes in ${mode} mode`, async () => {
    globalThis.__SERVICE_REPORT_TEST_MODE__ = mode;
    const serviceJobId = nextJobId();
    const report = makeReport(`v1-hook-${mode}`, serviceJobId);
    const { calls } = installRepositories(serviceJobId, [report]);
    const host = mountHookFor(serviceJobId);
    await host.root.flush();

    await host.result().updateDraft(report.id, { technicianRemark: 'saved in legacy mode' });
    await host.result().finalize(report.id);
    assert.equal(calls.v1Update.length, 1);
    assert.equal(calls.v1Finalize.length, 1);
    host.root.unmount();
  });
}

test('V2 draft mutations remain enabled in v2-active mode', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJobId = nextJobId();
  const report = makeV2Draft('v2-hook-active', serviceJobId);
  const { calls } = installRepositories(serviceJobId, [report]);
  const host = mountHookFor(serviceJobId);
  await host.root.flush();
  assert.equal(host.result().reports[0]?.sourceSchemaVersion, 2);

  await host.result().updateDraft(report.id, { technicianRemark: 'V2 update' });
  await host.result().finalize(report.id);
  assert.equal(calls.v1Update.length, 0);
  assert.equal(calls.v1Finalize.length, 0);
  assert.equal(calls.v2Update.length, 1);
  assert.equal(calls.v2Finalize.length, 1);
  host.root.unmount();
});

test('V2 finalize 503 retries the saved revision without another draft write', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJob = makeServiceJob(nextJobId());
  const draft = makeV2Draft('v2-finalize-retry', serviceJob.id);
  const repository = installRepositories(serviceJob.id, [draft]);
  repository.failNextV2Finalize();
  const root = mountSection(serviceJob);
  await root.flush();
  await root.click(root.button('ดำเนินการแก้ไขต่อ'));

  const confirmFinalize = async () => {
    await root.click(root.button('สรุปผลใบรายงาน'));
    await root.click(root.button('ยืนยันการสรุปผล'));
  };

  await confirmFinalize();
  assert.equal(repository.getHistory()[0].contentRevision, 1, 'the draft save commits before the simulated finalize failure');
  assert.equal(repository.getHistory()[0].status, 'draft');
  assert.equal(repository.calls.v2Update[0].expectedContentRevision, 0);
  assert.equal(repository.calls.v2Finalize[0].expectedContentRevision, 1, 'first finalize uses the saved revision N+1');
  assert.ok(root.text().includes('Simulated finalize failure'));

  await confirmFinalize();
  assert.equal(repository.calls.v2Update.length, 1, 'an ambiguous finalize response must not resave the draft');
  assert.equal(repository.calls.v2Finalize[1].expectedContentRevision, 1, 'retry finalizes the same saved revision');
  assert.equal(repository.calls.v2Finalize[1].idempotencyKey, repository.calls.v2Finalize[0].idempotencyKey);
  assert.equal(repository.getHistory()[0].status, 'final');
  root.unmount();
});

test('V2 finalize retries the same request when the committed response is lost', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJob = makeServiceJob(nextJobId());
  const draft = makeV2Draft('v2-finalize-lost-response', serviceJob.id);
  const repository = installRepositories(serviceJob.id, [draft]);
  repository.loseNextV2FinalizeResponse();
  const root = mountSection(serviceJob);
  await root.flush();
  await root.click(root.button('ดำเนินการแก้ไขต่อ'));

  const confirmFinalize = async () => {
    await root.click(root.button('สรุปผลใบรายงาน'));
    await root.click(root.button('ยืนยันการสรุปผล'));
  };

  await confirmFinalize();
  assert.equal(repository.getHistory()[0].status, 'final', 'the server committed before its response was lost');
  assert.equal(repository.committedV2Finalizations(), 1);
  assert.equal(repository.calls.v2Update.length, 1);
  assert.equal(repository.calls.v2Finalize[0].expectedContentRevision, 1);
  assert.ok(root.text().includes('Simulated lost finalize response'));
  assert.ok(root.text().includes('ผลการสรุปอาจสำเร็จแล้ว'));

  await confirmFinalize();
  assert.equal(repository.calls.v2Update.length, 1, 'retry does not attempt to save a finalized report');
  assert.equal(repository.calls.v2Finalize.length, 2);
  assert.equal(repository.calls.v2Finalize[1].expectedContentRevision, 1);
  assert.equal(
    repository.calls.v2Finalize[1].idempotencyKey,
    repository.calls.v2Finalize[0].idempotencyKey,
    'retry uses the same idempotency key'
  );
  assert.equal(repository.committedV2Finalizations(), 1, 'replay causes no second finalization');
  root.unmount();
});

for (const version of [1, 2]) {
  test(`V${version} editor keeps dirty form data and refuses a stale displayed version after history refresh`, async () => {
    globalThis.__SERVICE_REPORT_TEST_MODE__ = version === 2 ? 'v2-active' : 'compatibility';
    const serviceJob = makeServiceJob(nextJobId());
    const draft = version === 2
      ? makeV2Draft(`stale-editor-v${version}`, serviceJob.id)
      : makeReport(`stale-editor-v${version}`, serviceJob.id);
    const repository = installRepositories(serviceJob.id, [draft]);
    const root = mountSection(serviceJob);
    await root.flush();
    await root.click(root.button('ดำเนินการแก้ไขต่อ'));

    const findingsField = () => root.find(
      (node) => node.type === 'textarea' && node.props.placeholder === 'บันทึกผลการตรวจสอบ…'
    );
    await root.type(findingsField(), 'Unsaved dirty form');
    const remote = {
      ...draft,
      inspectionFindings: 'Remote edit',
      updatedAt: '2026-02-10T00:00:00.000Z',
      ...(version === 2 ? { contentRevision: draft.contentRevision + 1 } : {}),
    };
    repository.setHistory([remote]);
    window.dispatchEvent(new Event('focus'));
    await root.flush();

    assert.equal(findingsField().props.value, 'Unsaved dirty form', 'history refresh must not replace dirty editor state');
    await root.click(root.button('บันทึกร่าง'));
    assert.equal(repository.getHistory()[0].inspectionFindings, 'Remote edit', 'stale editor must not overwrite the remote change');
    assert.ok(root.text().includes('stale'), 'the stale-save refusal is shown to the technician');

    await root.click(root.button('กลับใบรายงาน'));
    await root.click(root.button('ดำเนินการแก้ไขต่อ'));
    assert.equal(findingsField().props.value, 'Remote edit', 'a newly opened editor uses the current report');
    await root.type(findingsField(), 'Fresh editor save');
    await root.click(root.button('บันทึกร่าง'));
    assert.equal(repository.getHistory()[0].inspectionFindings, 'Fresh editor save');
    const saves = version === 2 ? repository.calls.v2Update : repository.calls.v1Update;
    assert.equal(saves.length, 2);
    assert.equal(
      version === 2 ? saves[0].expectedContentRevision : saves[0].expectedUpdatedAt,
      version === 2 ? draft.contentRevision : draft.updatedAt
    );
    assert.equal(
      version === 2 ? saves[1].expectedContentRevision : saves[1].expectedUpdatedAt,
      version === 2 ? remote.contentRevision : remote.updatedAt
    );
    root.unmount();
  });
}

test('v2-active keeps V1 drafts viewable in history without edit or finalize controls', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJob = makeServiceJob(nextJobId());
  const oldDraft = makeReport('v1-draft-in-history', serviceJob.id, {
    reportNo: 'FR-2026-000001',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const latestFinal = makeReport('v1-final-latest', serviceJob.id, {
    reportNo: 'FR-2026-000002',
    status: 'final',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    finalizedAt: '2026-01-02T01:00:00.000Z',
    snapshot: {
      trackingReference: serviceJob.id,
      customerName: serviceJob.customerName,
      customerPhone: serviceJob.customerPhone,
      customerEmail: serviceJob.customerEmail,
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: serviceJob.product,
      modelOrSku: null,
      serialNumber: serviceJob.serialNumber,
      customerReportedProblem: 'Issue recorded in latest report',
    },
  });
  installRepositories(serviceJob.id, [oldDraft, latestFinal]);
  const root = mountSection(serviceJob);
  await root.flush();

  assert.ok(root.text().includes('ประวัติใบรายงาน'));
  assert.ok(root.text().includes(oldDraft.reportNo));
  assert.ok(root.text().includes('รายงานรูปแบบเดิมสามารถดูได้เท่านั้นในขณะนี้'));
  assert.equal(root.button('ดำเนินการแก้ไขต่อ'), null);
  assert.equal(root.button('แก้ไข'), null);
  assert.equal(root.button('สรุปผล'), null);
  assert.ok(root.button('ดู'), 'the report list retains view access');

  await root.click(root.button('ดู'));
  assert.ok(root.text().includes(oldDraft.customerReportedProblem));
  assert.ok(root.text().includes('อ่านได้อย่างเดียว'));
  assert.equal(root.button('แก้ไขร่าง'), null);
  assert.equal(root.button('บันทึกร่าง'), null);
  assert.equal(root.button('สรุปผล'), null);
  root.unmount();
});

for (const mode of ['disabled', 'compatibility']) {
  test(`V1 draft editing and finalization controls remain available in ${mode} mode`, async () => {
    globalThis.__SERVICE_REPORT_TEST_MODE__ = mode;
    const serviceJob = makeServiceJob(nextJobId());
    const draft = makeReport(`v1-component-${mode}`, serviceJob.id);
    installRepositories(serviceJob.id, [draft]);
    const root = mountSection(serviceJob);
    await root.flush();

    assert.ok(root.button('ดำเนินการแก้ไขต่อ'));
    await root.click(root.button('ดำเนินการแก้ไขต่อ'));
    assert.ok(root.button('บันทึกร่าง'));
    assert.ok(root.button('สรุปผล'));
    root.unmount();
  });
}

test('a selected V1 editor becomes view-only immediately when mode changes to v2-active', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'compatibility';
  const serviceJob = makeServiceJob(nextJobId());
  const draft = makeReport('v1-editor-mode-change', serviceJob.id);
  installRepositories(serviceJob.id, [draft]);
  const root = mountSection(serviceJob);
  await root.flush();
  assert.ok(root.button('ดำเนินการแก้ไขต่อ'));
  await root.click(root.button('ดำเนินการแก้ไขต่อ'));
  assert.ok(root.button('บันทึกร่าง'));
  assert.ok(root.button('สรุปผล'));

  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  await root.rerender(createElement(ServiceReportsSection, { serviceJob }));
  assert.ok(root.text().includes('รายงานรูปแบบเดิมสามารถดูได้เท่านั้นในขณะนี้'));
  assert.ok(root.text().includes(draft.customerReportedProblem));
  assert.equal(root.button('บันทึกร่าง'), null);
  assert.equal(root.button('สรุปผล'), null);
  assert.equal(root.button('แก้ไขร่าง'), null);
  root.unmount();
});

test('a V2 editor switches to read-only if the selected report becomes V1', async () => {
  globalThis.__SERVICE_REPORT_TEST_MODE__ = 'v2-active';
  const serviceJob = makeServiceJob(nextJobId());
  const draft = makeV2Draft('v2-editor-becomes-v1', serviceJob.id);
  const repository = installRepositories(serviceJob.id, [draft]);
  const root = mountSection(serviceJob);
  await root.flush();
  assert.ok(root.button('ดำเนินการแก้ไขต่อ'));
  await root.click(root.button('ดำเนินการแก้ไขต่อ'));
  assert.ok(root.button('บันทึกร่าง'));

  const changedReport = makeReport(draft.id, serviceJob.id, {
    ...draft,
    sourceSchemaVersion: 1,
    schemaVersion: undefined,
    reportId: undefined,
    brandId: undefined,
    activeDraftGeneration: undefined,
    createdByUid: undefined,
    createdByRoleSnapshot: undefined,
    createdByDisplayNameSnapshot: undefined,
    contentRevision: undefined,
    predecessorReportId: undefined,
    warrantyOutcome: undefined,
    finalizedByUid: undefined,
    finalizedByRoleSnapshot: undefined,
    finalizedByDisplayNameSnapshot: undefined,
    finalizedFromRevision: undefined,
    finalContentDigest: undefined,
    approvalState: undefined,
    currentApprovalEventId: undefined,
    approvalDecidedAt: undefined,
  });
  repository.setHistory([changedReport]);
  window.dispatchEvent(new Event('focus'));
  await root.flush();

  assert.ok(root.text().includes('รายงานรูปแบบเดิมสามารถดูได้เท่านั้นในขณะนี้'));
  assert.equal(root.button('บันทึกร่าง'), null);
  assert.equal(root.button('สรุปผล'), null);
  assert.equal(root.button('แก้ไขร่าง'), null);
  root.unmount();
});
