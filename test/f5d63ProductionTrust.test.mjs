import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { formatCurrencyTHB, formatDate, formatThaiDate, formatTime } =
  await vite.ssrLoadModule('/src/utils/formatDate.ts');
const { getBrandDisplayLabel } = await vite.ssrLoadModule('/src/types/brand.ts');
const { aggregateDashboardServiceJobs } = await vite.ssrLoadModule(
  '/src/features/dashboard/dashboardAggregation.ts'
);

test('dashboard source contains no fabricated operational metrics or staff identity', async () => {
  const source = await readSource('src/features/dashboard/pages/Dashboard.tsx');

  assert.doesNotMatch(source, /Daniel|Weekly intake bar chart|\+12%|เริ่มวันนี้ 2/);
  assert.doesNotMatch(source, /อะไหล่หนึ่งรายการจะมาถึงพรุ่งนี้/);
  assert.match(source, /awaitingParts/);
  assert.match(source, /ยังไม่มีงานบริการในแบรนด์นี้/);
});

test('dashboard aggregation excludes every closed or pickup-ready job and accounts for every status', () => {
  const jobs = [
    { status: 'In Repair' },
    { status: 'Completed' },
    { status: 'Ready for Pickup' },
    { status: 'Cancelled' },
    { status: 'Rejected' },
  ];

  const aggregation = aggregateDashboardServiceJobs(jobs);
  const counts = new Map(
    aggregation.statusBreakdown.map(({ status, count }) => [status, count])
  );

  assert.equal(aggregation.active, 1);
  assert.equal(aggregation.inRepair, 1);
  assert.equal(aggregation.ready, 1);
  assert.equal(aggregation.completed, 1);
  assert.equal(counts.get('Completed'), 1);
  assert.equal(counts.get('Ready for Pickup'), 1);
  assert.equal(counts.get('Cancelled'), 1);
  assert.equal(counts.get('Rejected'), 1);
  assert.equal(
    aggregation.statusBreakdown.reduce((total, entry) => total + entry.count, 0),
    jobs.length
  );

  for (const status of ['Completed', 'Ready for Pickup', 'Cancelled', 'Rejected']) {
    assert.equal(aggregateDashboardServiceJobs([{ status }]).active, 0);
  }
});

test('production technician reassignment is read-only and omitted from save edits', async () => {
  const source = await readSource(
    'src/features/service-jobs/pages/ServiceJobDetails.tsx'
  );

  assert.match(source, /canReassignTechnician = backendKind === 'mock'/);
  // F5d-70 Phase 5B — save is now dirty-only: techDirty additionally
  // requires the local value to have actually diverged from the persisted
  // one, but canReassignTechnician is still a hard, unconditional gate —
  // in production (canReassignTechnician === false) techDirty can never be
  // true, so technician can never enter the save patch, exactly as before.
  assert.match(source, /const techDirty = canReassignTechnician && tech !== claim\.technician;/);
  assert.match(source, /techDirty \? \{ technician: tech \} : \{\}/);
  assert.match(source, /การเปลี่ยนช่างผู้รับผิดชอบยังไม่พร้อมใช้งานในระบบจริง/);
  assert.doesNotMatch(source, /แก้ไขการมอบหมาย|<Pencil/);
});

test('search is shown only on routes that consume it and inert controls are absent', async () => {
  const [shell, list] = await Promise.all([
    readSource('src/shared/layouts/StaffShell.tsx'),
    readSource('src/features/service-jobs/pages/ServiceJobsList.tsx'),
  ]);

  assert.match(shell, /location\.pathname === ROUTES\.serviceJobs/);
  assert.match(shell, /location\.pathname === ROUTES\.masterDataProducts/);
  assert.match(shell, /ค้นหางานบริการ ลูกค้า สินค้า หรืออาการ/);
  assert.match(shell, /ค้นหาสินค้า แบรนด์ รุ่น หรือ SKU/);
  assert.doesNotMatch(shell, /Bell|<Bell|bg-danger-500/);
  assert.doesNotMatch(list, /SlidersHorizontal|เรียงลำดับ/);
});

test('Thai document metadata and neutral production terminology are present', async () => {
  const [html, details] = await Promise.all([
    readSource('index.html'),
    readSource('src/features/service-jobs/pages/ServiceJobDetails.tsx'),
  ]);

  assert.match(html, /<html lang="th">/);
  assert.match(html, /<title>Service Tech — ระบบจัดการงานบริการ<\/title>/);
  assert.doesNotMatch(html, /Bolt|vite\.svg/);
  assert.match(details, /formatCurrencyTHB\(claim\.quote\)/);
  assert.doesNotMatch(details, /AppleCare\+|\$\{claim\.quote\}/);
  assert.match(details, /อยู่ในระยะรับประกัน/);
  assert.match(details, /อยู่นอกระยะรับประกัน/);
});

test('Bangkok date and time formatting is deterministic at a UTC date boundary', () => {
  const instant = '2026-08-13T18:30:00.000Z';

  assert.equal(formatDate(instant), '14/08/2026');
  assert.equal(formatTime(new Date(instant)), '01:30');
  assert.equal(formatThaiDate(instant), '14/08/2026 (พ.ศ. 2569)');
  assert.match(formatCurrencyTHB(1234.5), /฿1,234\.50/);
});

test('trusted brand labels use the canonical brand mapping', async () => {
  const [shell, details] = await Promise.all([
    readSource('src/shared/layouts/StaffShell.tsx'),
    readSource('src/features/service-jobs/pages/ServiceJobDetails.tsx'),
  ]);

  assert.equal(getBrandDisplayLabel('bruno-thailand'), 'BRUNO THAILAND · BRN');
  assert.equal(getBrandDisplayLabel('join-lux-club'), 'JOIN LUX CLUB · JLC');
  assert.match(shell, /getBrandDisplayLabel\(staffProfile\.brandId\)/);
  assert.match(details, /getBrandDisplayLabel\(claim\.brandId\)/);
  assert.doesNotMatch(
    details,
    /tracking.*getBrandDisplayLabel|getBrandDisplayLabel.*prefix/i
  );
});

test('operational safety label and disabled public tracking boundary remain intact', async () => {
  const [indicator, publicTracking] = await Promise.all([
    readSource('src/shared/components/RuntimeModeIndicator.tsx'),
    readSource('src/features/tracking/publicTracking.ts'),
  ]);

  assert.match(indicator, />FIRESTORE \+ WORKER</);
  assert.match(publicTracking, /if \(!baseUrl\) return unavailablePublicTrackingGateway/);
  assert.doesNotMatch(publicTracking, /configured\s*\|\|\s*['"]http:\/\//);
});

test('save actions disable themselves during their existing in-flight states', async () => {
  const [newJob, details, login] = await Promise.all([
    readSource('src/features/service-jobs/pages/NewServiceJob.tsx'),
    readSource('src/features/service-jobs/pages/ServiceJobDetails.tsx'),
    readSource('src/features/auth/pages/Login.tsx'),
  ]);

  assert.match(newJob, /disabled=\{isSaving\}/);
  // F5d-70 Phase 6F.4 — ServiceJobDetails' global Save button now also
  // disables while a Quick Add note is in flight (approved mutual
  // exclusion between the two mutation operations, protecting against a
  // navigation/unmount race independent review found). This is a strict
  // superset of the original protection — isSaving still unconditionally
  // disables the button — so the assertion is scoped specifically to the
  // <PrimaryButton onClick={() => void saveChanges()}> Save action (not
  // the Internal Notes Add button, which also disables on isAddingNote ||
  // isSaving but is a different action) and requires both conditions.
  const saveButtonMatch = details.match(
    /<PrimaryButton onClick=\{\(\) => void saveChanges\(\)\} disabled=\{([^}]+)\}>/
  );
  assert.notEqual(saveButtonMatch, null, 'expected to find the global Save button');
  assert.match(saveButtonMatch[1], /\bisSaving\b/);
  assert.match(saveButtonMatch[1], /\bisAddingNote\b/);
  assert.match(login, /disabled=\{isSigningIn\}/);
});
