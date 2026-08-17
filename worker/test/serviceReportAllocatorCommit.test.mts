import { createFirestoreClient } from '../src/firestoreClient.ts';
import { allocateServiceReportDraft } from '../src/serviceReportCreation.ts';
import { finalizeServiceReportTransaction } from '../src/serviceReportFinalization.ts';
import type { Env } from '../src/env.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

// F5d-66 — same regression class as serviceJobAllocatorCommit.test.mts
// (F5d-33/F5d-34 B-1): a FakeStore-driven test can prove the allocation
// *algorithm* is correct but not that firestoreClient.ts's real REST
// serialization is something Firestore will actually accept. This exercises
// createFirestoreClient() end to end for both new Service Report writes,
// stubbing only the network boundary.

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

const RESOURCE_NAME_PREFIX = 'projects/test-project/databases/(default)/documents/';

function serviceJobDoc(id: string, brandId: string) {
  return {
    name: `${RESOURCE_NAME_PREFIX}serviceJobs/${id}`,
    fields: {
      brandId: { stringValue: brandId },
      customerName: { stringValue: 'QA Customer' },
      customerPhone: { stringValue: '0000000000' },
      customerEmail: { stringValue: '' },
      product: { stringValue: 'QA Product' },
      productCategory: { stringValue: 'Other' },
      serialNumber: { stringValue: 'SERIAL-1' },
      issue: { stringValue: 'Reported issue' },
      description: { stringValue: 'Description' },
      status: { stringValue: 'Received' },
      priority: { stringValue: 'Normal' },
      createdAt: { stringValue: '2026-01-01' },
      updatedAt: { stringValue: '2026-01-01' },
      technician: { stringValue: 'Unassigned' },
      estimatedCompletion: { stringValue: '—' },
      warranty: { booleanValue: false },
      photos: { arrayValue: { values: [] } },
      accessories: { arrayValue: { values: [] } },
      timeline: { arrayValue: { values: [] } },
      notes: { arrayValue: { values: [] } },
      closedAt: { nullValue: null },
      publicTrackingTokenHash: { nullValue: null },
      publicTrackingCodeHash: { nullValue: null },
      serviceRequestNumber: { stringValue: 'SR-2026-000001' },
    },
  };
}

function serviceReportDoc(id: string, overrides: Record<string, unknown> = {}) {
  const base = {
    name: `${RESOURCE_NAME_PREFIX}serviceReports/${id}`,
    fields: {
      serviceJobId: { stringValue: 'BRN-2026-000001' },
      reportNo: { stringValue: 'FR-2026-000001' },
      status: { stringValue: 'draft' },
      createdAt: { stringValue: '2026-01-01T00:00:00.000Z' },
      updatedAt: { stringValue: '2026-01-01T00:00:00.000Z' },
      finalizedAt: { nullValue: null },
      technician: { stringValue: 'QA Tech' },
      customerReportedProblem: { stringValue: 'Fault reported' },
      inspectionFindings: { stringValue: 'Fault reproduced' },
      serviceActions: { arrayValue: { values: [{ stringValue: 'repair' }] } },
      parts: { arrayValue: { values: [] } },
      technicianRemark: { stringValue: '' },
      resultStatus: { stringValue: 'repaired' },
      resultDetail: { stringValue: '' },
      evidenceAttachmentIds: { arrayValue: { values: [] } },
      claimNo: { nullValue: null },
      factoryReference: { nullValue: null },
      snapshot: { nullValue: null },
    },
  };
  return { ...base, fields: { ...base.fields, ...overrides } };
}

interface CapturedRequest {
  url: URL;
  body: unknown;
}

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
let sequence = 0;

const documents = new Map<string, unknown>();

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  captured.push({ url, body });

  if (url.pathname.endsWith(':beginTransaction')) {
    return new Response(JSON.stringify({ transaction: `txn-${(sequence += 1)}` }), {
      status: 200,
    });
  }
  if (url.pathname.endsWith(':commit')) {
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  const key = decodeURIComponent(url.pathname.replace(/^.*\/documents\//, ''));
  const doc = documents.get(key);
  if (!doc) return new Response('', { status: 404 });
  return new Response(JSON.stringify(doc), { status: 200 });
};

console.log('Running Service Report allocator/finalizer Firestore commit-shape regression test');

try {
  documents.set('serviceJobs/BRN-2026-000001', serviceJobDoc('BRN-2026-000001', 'bruno-thailand'));

  const client = createFirestoreClient(env);
  const draft = await allocateServiceReportDraft({
    serviceJobId: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111',
    input: {},
    dataAccess: client,
    now: () => new Date('2026-08-11T10:00:00.000Z'),
  });

  check('draft allocation completed', draft.serviceJobId === 'BRN-2026-000001');

  const createCommit = captured.find(
    (call) => call.url.pathname.endsWith(':commit') && !call.body?.writes?.some((w: { delete?: string }) => w.delete)
  );
  if (!createCommit) throw new Error('no create :commit request was captured');
  const createBody = createCommit.body as {
    writes?: { update?: { name?: string }; currentDocument?: { exists?: boolean } }[];
  };
  const createNames = (createBody.writes ?? []).map((write) => write.update?.name ?? '');

  check('draft creation issues exactly four writes', createNames.length === 4);
  check(
    'every draft-creation write.update.name is a bare Firestore resource name',
    createNames.every((name) => name.startsWith(RESOURCE_NAME_PREFIX))
  );
  check(
    'the Service Report write targets the allocated document ID',
    createNames.includes(`${RESOURCE_NAME_PREFIX}serviceReports/${draft.id}`)
  );
  check(
    'the active-draft lock write targets the parent Service Job ID',
    createNames.includes(`${RESOURCE_NAME_PREFIX}serviceReportActiveDrafts/BRN-2026-000001`)
  );
  check(
    'the sequence write targets the brand/repair_report/year document',
    createNames.includes(`${RESOURCE_NAME_PREFIX}numberSequences/bruno-thailand__repair_report__2026`)
  );
  check(
    'the idempotency key write targets the submitted key',
    createNames.includes(
      `${RESOURCE_NAME_PREFIX}serviceReportDraftKeys/11111111-1111-4111-8111-111111111111`
    )
  );
  const createOnlyWrites = (createBody.writes ?? []).filter(
    (write) =>
      write.update?.name === `${RESOURCE_NAME_PREFIX}serviceReports/${draft.id}` ||
      write.update?.name === `${RESOURCE_NAME_PREFIX}serviceReportActiveDrafts/BRN-2026-000001` ||
      write.update?.name ===
        `${RESOURCE_NAME_PREFIX}serviceReportDraftKeys/11111111-1111-4111-8111-111111111111`
  );
  check(
    'the report, lock, and idempotency-key writes are create-only (exists: false)',
    createOnlyWrites.length === 3 &&
      createOnlyWrites.every((write) => write.currentDocument?.exists === false)
  );

  documents.set('serviceReports/' + draft.id, serviceReportDoc(draft.id));
  documents.set(
    'serviceReportActiveDrafts/BRN-2026-000001',
    {
      name: `${RESOURCE_NAME_PREFIX}serviceReportActiveDrafts/BRN-2026-000001`,
      fields: { draftReportId: { stringValue: draft.id } },
    }
  );

  const finalized = await finalizeServiceReportTransaction({
    serviceJobId: 'BRN-2026-000001',
    reportId: draft.id,
    dataAccess: client,
    now: () => new Date('2026-08-11T11:00:00.000Z'),
  });

  check('finalization completed', finalized.status === 'final');

  const finalizeCommit = captured.find(
    (call) => call.url.pathname.endsWith(':commit') && call.body?.writes?.some((w: { delete?: string }) => w.delete)
  );
  if (!finalizeCommit) throw new Error('no finalize :commit request was captured');
  const finalizeBody = finalizeCommit.body as {
    writes?: {
      update?: { name?: string };
      updateMask?: { fieldPaths?: string[] };
      delete?: string;
      currentDocument?: { exists?: boolean };
    }[];
  };
  check('finalize issues exactly two writes', (finalizeBody.writes ?? []).length === 2);
  const updateWrite = (finalizeBody.writes ?? []).find((w) => w.update);
  const deleteWrite = (finalizeBody.writes ?? []).find((w) => w.delete);
  check(
    'the report update targets a bare resource name and is field-masked, not a full overwrite',
    updateWrite?.update?.name === `${RESOURCE_NAME_PREFIX}serviceReports/${draft.id}` &&
      Array.isArray(updateWrite?.updateMask?.fieldPaths) &&
      (updateWrite!.updateMask!.fieldPaths as string[]).includes('status') &&
      (updateWrite!.updateMask!.fieldPaths as string[]).includes('snapshot') &&
      !(updateWrite!.updateMask!.fieldPaths as string[]).includes('technician')
  );
  check(
    'the lock delete targets a bare resource name for the parent Service Job',
    deleteWrite?.delete === `${RESOURCE_NAME_PREFIX}serviceReportActiveDrafts/BRN-2026-000001`
  );
  check(
    'both finalize writes require the document to already exist',
    updateWrite?.currentDocument?.exists === true && deleteWrite?.currentDocument?.exists === true
  );
} finally {
  globalThis.fetch = originalFetch;
}

// F5d-66 Phase 2C-R — the closest realistic "malformed" canonical state:
// a real Firestore document exists at the reportId a draft key resolves
// to, but it fails isValidServiceReport() (e.g. missing a required field).
// firestoreClient.ts's parseServiceReportDocument() already collapses
// this to null before allocateServiceReportDraft() ever sees it, so it
// must produce the exact same fail-closed "no canonical Service Report"
// rejection as a genuinely absent document — proven here through the real
// REST parse path, not just the FakeStore abstraction (see
// serviceReportCreation.test.mts for that unit-level variant).
{
  const malformedDocuments = new Map<string, unknown>();
  malformedDocuments.set(
    'serviceJobs/BRN-2026-000002',
    serviceJobDoc('BRN-2026-000002', 'bruno-thailand')
  );
  malformedDocuments.set('serviceReportDraftKeys/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    name: `${RESOURCE_NAME_PREFIX}serviceReportDraftKeys/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    fields: { reportId: { stringValue: 'malformed-report-id' } },
  });
  // Missing technician/customerReportedProblem/etc. entirely — fails
  // isValidServiceReport()'s required-field checks, matching a corrupted
  // or partially-written document rather than a well-formed one.
  malformedDocuments.set('serviceReports/malformed-report-id', {
    name: `${RESOURCE_NAME_PREFIX}serviceReports/malformed-report-id`,
    fields: {
      serviceJobId: { stringValue: 'BRN-2026-000002' },
      status: { stringValue: 'draft' },
    },
  });

  let commitAttempted = false;
  const malformedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname.endsWith(':beginTransaction')) {
      return new Response(JSON.stringify({ transaction: 'txn-malformed' }), { status: 200 });
    }
    if (url.pathname.endsWith(':commit')) {
      commitAttempted = true;
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    const key = decodeURIComponent(url.pathname.replace(/^.*\/documents\//, ''));
    const doc = malformedDocuments.get(key);
    if (!doc) return new Response('', { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  }) as typeof fetch;

  globalThis.fetch = malformedFetch;
  try {
    const client = createFirestoreClient(env);
    let rejected = false;
    let message = '';
    try {
      await allocateServiceReportDraft({
        serviceJobId: 'BRN-2026-000002',
        brandId: 'bruno-thailand',
        key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        input: {},
        dataAccess: client,
        now: () => new Date('2026-08-11T10:00:00.000Z'),
      });
    } catch (error) {
      rejected = true;
      message = error instanceof Error ? error.message : '';
    }
    check(
      'a real Firestore document that fails isValidServiceReport() is treated identically to a missing document — fails closed',
      rejected && /no canonical Service Report/i.test(message)
    );
    check(
      'no :commit is ever attempted when the canonical document is malformed',
      !commitAttempted
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (failures) process.exitCode = 1;
