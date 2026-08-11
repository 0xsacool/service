import { allocateServiceJob, isValidIdempotencyKey, MAX_INTAKE_BYTES, MAX_PHOTOS_TOTAL_BYTES, MAX_PHOTO_DATA_URL_BYTES, parseServiceJobIntake, TransactionConflictError, type AllocationTransaction, type ServiceJobCreationDataAccess } from '../src/serviceJobCreation.ts';
import { bangkokIsoDate } from '../../src/services/bangkokTime.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

let failures = 0;
function check(name: string, value: boolean) { if (value) console.log(`  PASS  ${name}`); else { failures += 1; console.error(`  FAIL  ${name}`); } }
const key = '11111111-1111-4111-8111-111111111111';
const raw = { intake: { customerName: 'QA', customerPhone: '1', customerEmail: '', product: 'Product', productCategory: 'Other', serialNumber: 'S', problemDescription: '', problemChips: [], accessories: [], internalNotes: '', photos: [], warranty: false } };
const intake = parseServiceJobIntake(raw);
check('only bounded intake payload is accepted', intake !== null && parseServiceJobIntake({ ...raw, brandId: 'bruno-thailand' }) === null);
check('UUID v4 idempotency key is required', isValidIdempotencyKey(key) && !isValidIdempotencyKey('bad'));

class FakeStore implements ServiceJobCreationDataAccess {
  jobs = new Map<string, ServiceJob>(); keys = new Map<string, string>(); tracking = 0; requests = 0; conflicts = 0; writes = 0;
  async beginServiceJobTransaction(): Promise<AllocationTransaction> { return { id: crypto.randomUUID() }; }
  async getIntakeKey(_: AllocationTransaction, id: string) { return this.keys.get(id) ?? null; }
  async getSequence(_: AllocationTransaction, __: 'bruno-thailand' | 'join-lux-club', type: 'tracking_number' | 'service_request') { return type === 'tracking_number' ? this.tracking : this.requests; }
  async getServiceJob(_: AllocationTransaction, id: string) { return this.jobs.get(id) ?? null; }
  async commitServiceJobCreation(_: AllocationTransaction, input: { key: string; job: ServiceJob; trackingSequence: number; serviceRequestSequence: number }) { if (this.conflicts-- > 0) throw new TransactionConflictError(); if (this.jobs.has(input.job.id) || this.keys.has(input.key)) throw new TransactionConflictError(); this.jobs.set(input.job.id, input.job); this.keys.set(input.key, input.job.id); this.tracking = input.trackingSequence; this.requests = input.serviceRequestSequence; this.writes += 1; }
}
if (!intake) throw new Error('test intake malformed');
const store = new FakeStore();
store.jobs.set('BRN-2026-000001', { id: 'BRN-2026-000001', serviceRequestNumber: 'SR-2026-000001', brandId: 'bruno-thailand', customerName: 'legacy', customerPhone: '', customerEmail: '', product: '', productCategory: '', serialNumber: '', issue: '', description: '', status: 'Received', priority: 'Normal', createdAt: '2026-01-01', updatedAt: '2026-01-01', technician: '', estimatedCompletion: '', warranty: false, photos: [], timeline: [], notes: [], closedAt: null, publicTrackingTokenHash: null, publicTrackingCodeHash: null });
const first = await allocateServiceJob({ brandId: 'bruno-thailand', key, intake, dataAccess: store, now: () => new Date('2025-12-31T17:00:00.000Z') });
check('Bangkok year and occupied legacy ID are handled safely', first.id === 'BRN-2026-000002' && first.serviceRequestNumber === 'SR-2026-000001' && store.jobs.has('BRN-2026-000001'));
const replay = await allocateServiceJob({ brandId: 'bruno-thailand', key, intake, dataAccess: store });
check('idempotent replay returns canonical job without advancing counters', replay.id === first.id && store.writes === 1);
store.conflicts = 1;
const next = await allocateServiceJob({ brandId: 'bruno-thailand', key: '22222222-2222-4222-8222-222222222222', intake, dataAccess: store });
check('transaction conflict retries without partial writes', next.id === 'BRN-2026-000003' && store.writes === 2);

// F5d-33/F5d-34 B-7 — a moment just before Bangkok midnight in UTC (Bangkok
// = UTC+7, so 2026-01-01T18:30Z is 2026-01-02T01:30 in Bangkok). The date
// must roll over to the next day, and the recorded time must reflect the
// same explicit Asia/Bangkok zone the timeline date used — both computed
// independently here rather than by re-deriving the source's own math, and
// both host-timezone-independent (an explicit IANA zone, never the runtime
// default this Worker actually runs under).
const bangkokBoundary = new Date('2026-01-01T18:30:00.000Z');
const boundaryJob = await allocateServiceJob({
  brandId: 'bruno-thailand',
  key: '33333333-3333-4333-8333-333333333333',
  intake,
  dataAccess: store,
  now: () => bangkokBoundary,
});
const expectedBangkokDate = bangkokIsoDate(bangkokBoundary);
const expectedBangkokTime = bangkokBoundary.toLocaleTimeString('th-TH', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Bangkok',
});
check(
  'the timeline date rolls over to the Bangkok calendar day, not the UTC one',
  boundaryJob.createdAt === expectedBangkokDate &&
    boundaryJob.timeline[0]?.date === expectedBangkokDate &&
    expectedBangkokDate === '2026-01-02'
);
check(
  'the timeline time is explicitly Bangkok-zoned, not the Workers runtime default',
  boundaryJob.timeline[0]?.time === expectedBangkokTime
);

// F5d-33/F5d-34 B-8 — the previous ~32 KB-per-photo cap rejected realistic
// compressed intake photos; the new caps must accept a properly-sized photo
// while still bounding both a single oversized photo and the aggregate
// across several individually-small ones (the real constraint: staying
// under Firestore's 1 MiB document ceiling once photos are embedded in the
// ServiceJob document — see MAX_PHOTOS_TOTAL_BYTES's own comment).
function intakeWithPhotos(photos: string[]): unknown {
  return { intake: { ...raw.intake, photos } };
}
check(
  'a single photo at the per-photo cap is accepted',
  parseServiceJobIntake(intakeWithPhotos(['x'.repeat(MAX_PHOTO_DATA_URL_BYTES)])) !== null
);
check(
  'a single photo one byte over the per-photo cap is rejected',
  parseServiceJobIntake(intakeWithPhotos(['x'.repeat(MAX_PHOTO_DATA_URL_BYTES + 1)])) === null
);
{
  const perPhoto = Math.floor(MAX_PHOTOS_TOTAL_BYTES / 3) - 1;
  const withinAggregate = [perPhoto, perPhoto, perPhoto].map((size) => 'x'.repeat(size));
  const overAggregate = [perPhoto, perPhoto, perPhoto, perPhoto].map((size) =>
    'x'.repeat(size)
  );
  check(
    'several individually-small photos within the aggregate budget are accepted',
    parseServiceJobIntake(intakeWithPhotos(withinAggregate)) !== null
  );
  check(
    'the same small per-photo size exceeds the aggregate budget once summed across enough photos',
    parseServiceJobIntake(intakeWithPhotos(overAggregate)) === null
  );
}
check(
  'the photo item-count cap is still enforced independent of size',
  parseServiceJobIntake(intakeWithPhotos(new Array(11).fill('x'))) === null
);
check(
  'MAX_INTAKE_BYTES comfortably covers the photo aggregate budget plus other fields',
  MAX_INTAKE_BYTES > MAX_PHOTOS_TOTAL_BYTES
);

if (failures) process.exitCode = 1;
