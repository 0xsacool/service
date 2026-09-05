import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirestoreClient } from '../src/firestoreClient.ts';
import { createWorkerHandler } from '../src/index.ts';
import { isValidServiceReport } from '../../src/services/serviceReport.ts';

// Frozen pre-fix decoder behavior, retained only to reproduce the A failure.
function oldDecode(value) {
  if (!value) return null;
  if (value.nullValue !== undefined) return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.integerValue === 'string') return Number(value.integerValue);
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(oldDecode);
  if (value.mapValue) return Object.fromEntries(
    Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, oldDecode(entry)]),
  );
  return null;
}
const env = {
  ATTACHMENTS_BUCKET: {},
  ALLOWED_ORIGINS: 'http://worker.test',
  FIRESTORE_PROJECT_ID: 'offline-timestamp-test',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:1',
};
const prefix = 'projects/offline-timestamp-test/databases/(default)/documents/';
const jobId = 'BRN-2026-999999';
const reportId = '11111111-1111-4111-8111-111111111111';
const iso = '2026-08-17T15:04:53.988Z';
const timestamp = '2026-08-17T15:07:54.201164Z';
function wire(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(wire) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) } };
}
const job = {
  brandId: 'bruno-thailand', customerName: 'Offline customer',
  customerPhone: '0000000000', customerEmail: '', product: 'Offline unit',
  productCategory: 'Other', serialNumber: 'OFFLINE', issue: 'Fault',
  description: '', status: 'Received', priority: 'Normal', createdAt: iso,
  updatedAt: iso, technician: '', estimatedCompletion: '', warranty: false,
  photos: [], accessories: [], timeline: [], notes: [], closedAt: null,
  publicTrackingTokenHash: null, publicTrackingCodeHash: null,
  serviceRequestNumber: 'SR-2026-000001',
};
const draft = {
  id: reportId, serviceJobId: jobId, reportNo: 'FR-2026-000001',
  status: 'draft', createdAt: iso, updatedAt: timestamp, finalizedAt: null,
  technician: 'Offline technician', customerReportedProblem: 'Fault reported',
  inspectionFindings: 'Fault reproduced', serviceActions: ['repair'],
  parts: [], technicianRemark: '', resultStatus: 'repaired', resultDetail: '',
  evidenceAttachmentIds: [], claimNo: null, factoryReference: null, snapshot: null,
};
function document(collection, id, value) {
  return { name: prefix + collection + '/' + id, fields: wire(value).mapValue.fields };
}
function reportDocument(overrides = {}) {
  const doc = document('serviceReports', reportId, draft);
  doc.fields.updatedAt = { timestampValue: timestamp };
  Object.assign(doc.fields, overrides);
  return doc;
}
async function harness(callback, report = reportDocument()) {
  const docs = new Map([
    ['serviceReports/' + reportId, report],
    ['serviceJobs/' + jobId, document('serviceJobs', jobId, job)],
    ['staffProfiles/offline-staff', document('staffProfiles', 'offline-staff', { brandId: 'bruno-thailand' })],
    ['serviceReportActiveDrafts/' + jobId, document('serviceReportActiveDrafts', jobId, { draftReportId: reportId })],
  ]);
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:1');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: url.pathname, body });
    if (url.pathname.endsWith(':beginTransaction')) return Response.json({ transaction: 'offline-txn' });
    if (url.pathname.endsWith(':commit')) return Response.json({ writeResults: [] });
    const key = decodeURIComponent(url.pathname.split('/documents/')[1]);
    assert.ok(key);
    const found = docs.get(key);
    return found ? Response.json(found) : new Response('', { status: 404 });
  };
  try {
    const client = createFirestoreClient(env);
    const handler = createWorkerHandler({
      tokenVerifier: { async verify(token) {
        if (token !== 'offline-token') throw new Error('Offline rejection');
        return { uid: 'offline-staff' };
      } },
      createFirestoreClient: () => client,
    });
    const finalize = (token = 'offline-token') => handler.fetch(new Request(
      'http://worker.test/service-jobs/' + jobId + '/service-reports/' + reportId + '/finalize',
      { method: 'POST', headers: token === null ? {} : { Authorization: 'Bearer ' + token }, body: '{}' },
    ), env);
    await callback({ client, docs, requests, finalize });
  } finally { globalThis.fetch = original; }
}
const read = (client) => client.getServiceReport({ id: 'offline-txn' }, reportId);
const lockReads = (requests) => requests.filter(r => r.path.includes('/serviceReportActiveDrafts/'));
const commits = (requests) => requests.filter(r => r.path.endsWith(':commit'));

test('exact observed A-style chain: old timestamp decoder produces null; real corrected parser returns a draft', async () => {
  const doc = reportDocument();
  const oldCandidate = Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, oldDecode(v)]));
  assert.equal(oldCandidate.updatedAt, null);
  assert.equal(isValidServiceReport(oldCandidate), false);
  await harness(async ({ client }) => {
    const parsed = await read(client);
    assert.deepEqual(parsed, draft);
  });
});

test('timestampValue createdAt, updatedAt, finalizedAt null and nested timestamps retain precision', async () => {
  await harness(async ({ client }) => {
    const parsed = await read(client);
    assert.ok(parsed);
    assert.equal(parsed.createdAt, timestamp);
    assert.equal(parsed.updatedAt, timestamp);
    assert.equal(parsed.finalizedAt, null);
    assert.deepEqual(parsed.offlineNested, { values: [timestamp, { at: timestamp }] });
  }, reportDocument({
    createdAt: { timestampValue: timestamp },
    offlineNested: { mapValue: { fields: { values: { arrayValue: { values: [
      { timestampValue: timestamp }, { mapValue: { fields: { at: { timestampValue: timestamp } } } },
    ] } } } } },
  }));
});

test('valid timestamp grammar includes calendar, UTC/offset, 1..9 fractional digits and range boundaries', async () => {
  const values = [
    '0001-01-01T00:00:00Z', '0099-12-31T23:59:59Z',
    '2000-02-29T00:00:00Z', '2024-02-29T00:00:00Z',
    '2026-09-05T07:00:00+07:00', '2026-09-05T00:00:00-23:59',
    '9999-12-31T23:59:59.999999999Z',
    ...Array.from({ length: 9 }, (_, i) => '2026-09-05T00:00:00.' + '1'.repeat(i + 1) + 'Z'),
  ];
  for (const value of values) {
    await harness(async ({ client }) => assert.equal((await read(client)).updatedAt, value),
      reportDocument({ updatedAt: { timestampValue: value } }));
  }
});

test('malformed timestamp values and ambiguous wire unions fail closed, including nullable/nested positions', async () => {
  const invalid = [
    null, 0, true, [], {}, '', '2026-09-05', '2026-09-05T00:00:00',
    '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60',
    '2026-01-01T00:00:00.1234567890Z', '0000-01-01T00:00:00Z',
    '0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01',
    ' 2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z\n',
  ];
  for (const value of invalid) {
    for (const field of ['createdAt', 'updatedAt', 'finalizedAt']) {
      await harness(async ({ client, requests }) => {
        await assert.rejects(read(client), { message: 'Invalid Firestore timestamp' });
        assert.equal(lockReads(requests).length, 0);
        assert.equal(commits(requests).length, 0);
      }, reportDocument({ [field]: { timestampValue: value } }));
    }
  }
  for (const value of [
    { timestampValue: timestamp, nullValue: null },
    { timestampValue: timestamp, stringValue: iso },
    { mapValue: { fields: { at: { timestampValue: 'invalid' } } } },
    { arrayValue: { values: [{ timestampValue: 'invalid' }] } },
  ]) {
    await harness(async ({ client }) => {
      await assert.rejects(read(client), { message: 'Invalid Firestore timestamp' });
    }, reportDocument({ offlineNested: value }));
  }
});

test('all existing non-timestamp wire semantics remain identical, including unsupported reference/double values', async () => {
  const fields = {
    text: { stringValue: 'text' }, bool: { booleanValue: true }, integer: { integerValue: '42' },
    nil: { nullValue: null }, empty: {}, array: { arrayValue: {} }, map: { mapValue: {} },
    reference: { referenceValue: 'projects/offline/documents/test/x' },
    double: { doubleValue: 1.25 }, bytes: { bytesValue: 'YQ==' },
    geo: { geoPointValue: { latitude: 1, longitude: 2 } },
    nested: wire({ items: [null, false, 2, 'text', { child: 'value' }] }),
  };
  const expected = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, oldDecode(v)]));
  await harness(async ({ client }) => {
    const parsed = await read(client);
    assert.equal(JSON.stringify(parsed.offlineValues), JSON.stringify(expected));
  }, reportDocument({ offlineValues: { mapValue: { fields } } }));
});

test('timestamp draft reaches lock/job/completeness checks and unchanged four-field mutation plus lock deletion', async () => {
  let timestampCommit;
  await harness(async ({ requests, finalize }) => {
    const response = await finalize();
    assert.equal(response.status, 200);
    assert.equal(lockReads(requests).length, 1);
    assert.equal(commits(requests).length, 1);
    timestampCommit = commits(requests)[0].body;
    assert.deepEqual(timestampCommit.writes[0].updateMask.fieldPaths, ['status', 'finalizedAt', 'snapshot', 'updatedAt']);
    assert.equal(timestampCommit.writes.length, 2);
    assert.equal(timestampCommit.writes[1].delete, prefix + 'serviceReportActiveDrafts/' + jobId);
    assert.deepEqual(timestampCommit.writes.map(w => w.currentDocument), [{ exists: true }, { exists: true }]);
  });
  await harness(async ({ requests, finalize }) => {
    assert.equal((await finalize()).status, 200);
    const stringCommit = commits(requests)[0].body;
    for (const body of [timestampCommit, stringCommit]) {
      for (const key of ['updatedAt', 'finalizedAt']) body.writes[0].update.fields[key] = '<clock>';
    }
    assert.deepEqual(timestampCommit, stringCommit);
  }, reportDocument({ updatedAt: { stringValue: timestamp } }));
});

test('valid final timestamp parses and already-final state returns without lock lookup or mutation', async () => {
  const snapshot = {
    trackingReference: jobId, customerName: 'Offline', customerPhone: '', customerEmail: '',
    brandCode: 'BRN', brandName: 'Bruno Thailand', productName: 'Offline',
    modelOrSku: null, serialNumber: '', customerReportedProblem: 'Fault',
  };
  await harness(async ({ client, requests, finalize }) => {
    const parsed = await read(client);
    assert.equal(parsed.finalizedAt, timestamp);
    assert.equal((await finalize()).status, 200);
    assert.equal(lockReads(requests).length, 0);
    assert.equal(commits(requests).length, 0);
  }, reportDocument({ status: wire('final'), finalizedAt: { timestampValue: timestamp }, snapshot: wire(snapshot) }));
});

test('missing/malformed reports, auth/brand, lock and completeness guards remain closed before mutation', async () => {
  const cases = [
    ['missing', 404, s => s.docs.delete('serviceReports/' + reportId), 0],
    ['malformed report', 404, s => { s.docs.get('serviceReports/' + reportId).fields.serviceActions = wire(['invalid']); }, 0],
    ['malformed timestamp', 500, s => { s.docs.get('serviceReports/' + reportId).fields.updatedAt = { timestampValue: 'invalid' }; }, 0],
    ['missing lock', 409, s => s.docs.delete('serviceReportActiveDrafts/' + jobId), 1],
    ['wrong lock', 409, s => { s.docs.get('serviceReportActiveDrafts/' + jobId).fields.draftReportId = wire('other'); }, 1],
    ['incomplete', 400, s => { s.docs.get('serviceReports/' + reportId).fields.inspectionFindings = wire(''); }, 1],
    ['foreign report job', 404, s => { s.docs.get('serviceReports/' + reportId).fields.serviceJobId = wire('foreign-job'); }, 0],
    ['brand mismatch', 403, s => { s.docs.get('serviceJobs/' + jobId).fields.brandId = wire('join-lux-club'); }, 0],
    ['missing profile', 403, s => s.docs.delete('staffProfiles/offline-staff'), 0],
  ];
  for (const [label, status, mutate, locks] of cases) {
    await harness(async s => {
      mutate(s);
      assert.equal((await s.finalize()).status, status, label);
      assert.equal(lockReads(s.requests).length, locks, label);
      assert.equal(commits(s.requests).length, 0, label);
    });
  }
  for (const [token, status] of [[null, 401], ['invalid-offline-token', 403]]) {
    await harness(async ({ requests, finalize }) => {
      assert.equal((await finalize(token)).status, status);
      assert.equal(requests.length, 0);
    });
  }
});

