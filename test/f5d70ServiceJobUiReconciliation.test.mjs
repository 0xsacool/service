import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-70 Phase 5B / 5B.1 — Service Job UI state reconciliation, corrected
// after independent review found the entity boundary exploitable. The
// approved conflict policy is LOCAL LAST WRITE WINS, DIRTY FIELDS ONLY: a
// field or atomic group tracks the newest persisted claim only while
// pristine; once the user has diverged from that, incoming persisted data
// must never overwrite the local draft, and Save must submit only what was
// actually changed. The entity boundary itself is React's own key
// mechanism (key={claim.id} on ServiceJobDetailsView) — a genuinely
// different Service Job always arrives via a fresh mount, never via a
// render where old-entity local state coexists with the new entity's id.
//
// What this file proves and how:
//   - The pure reconciliation/patch-building logic (serviceJobDraftReconciliation.ts,
//     serviceJobUpdate.ts) is exercised at real runtime via ssrLoadModule —
//     genuine function calls, genuine assertions on return values.
//   - Everything React-lifecycle-shaped (the key prop, effect timing/deps,
//     PublicTrackingSection's derived isActive, NewServiceJob's freshest-job
//     resolution) is proven STRUCTURALLY against the actual source text —
//     this project has no jsdom/React-testing-library, and this phase is
//     explicitly forbidden from adding one. A structural assertion proves
//     the source contains the required shape (e.g. "key={claim.id} is
//     present on this exact render call"); it does not execute React's
//     reconciler and therefore cannot itself observe a real mount/unmount
//     cycle, StrictMode double-invocation, or paint timing. Those specific
//     properties (which the corrective patch relies on) are properties of
//     React's own documented, versioned behavior — not something this
//     project's test infrastructure re-verifies — and are called out
//     explicitly in the Phase 5B.1 report rather than silently assumed.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { notesEqual, reconcileField } = await vite.ssrLoadModule(
  '/src/services/serviceJobDraftReconciliation.ts'
);
const { buildServiceJobUpdate } = await vite.ssrLoadModule('/src/services/serviceJobUpdate.ts');

function baseServiceJob(overrides = {}) {
  return {
    id: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    customerName: 'QA Customer',
    customerPhone: '0812345678',
    customerEmail: 'qa@example.com',
    product: 'Blender X100',
    productCategory: 'Kitchen',
    serialNumber: 'SN1',
    issue: 'issue',
    description: 'description',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: true,
    photos: [],
    timeline: [],
    notes: [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: null,
    purchaseDate: null,
    orderDeliveredDate: null,
    externalEvidenceUrl: null,
    externalEvidenceNote: null,
    ...overrides,
  };
}

// =====================================================================
// Draft reconciliation (pure helpers)
// =====================================================================

test('1. pristine field resolves to the newest persisted value', () => {
  assert.equal(reconcileField('Received', 'Received', 'In Repair'), 'In Repair');
});

test('2. dirty field preserves the local override', () => {
  assert.equal(reconcileField('Diagnosing', 'Received', 'In Repair'), 'Diagnosing');
});

test('3. reconciliation is per-field independent — a dirty field never blocks a different, pristine field from adopting the fresh value', () => {
  // status is dirty (local diverged from what was last shown)...
  const status = reconcileField('Diagnosing', 'Received', 'In Repair');
  assert.equal(status, 'Diagnosing');
  // ...but notes, evaluated completely independently, is pristine and adopts the fresh value.
  const previousNotes = [{ author: 'A', date: '2026-08-01', text: 'x' }];
  const nextNotes = [{ author: 'A', date: '2026-08-01', text: 'x' }, { author: 'B', date: '2026-08-02', text: 'y' }];
  const notes = reconcileField(previousNotes, previousNotes, nextNotes, notesEqual);
  assert.equal(notes, nextNotes);
});

test('4. returning a local override to the value it was last shown re-marks it pristine on the next reconciliation pass', () => {
  // The user typed a value back to what they were last shown (`previous`);
  // the next reconciliation pass correctly treats it as pristine again and
  // lets it adopt whatever the persisted value has since become.
  const result = reconcileField('Received', 'Received', 'Completed');
  assert.equal(result, 'Completed');
});

test('5. atomic metadata groups remain coherent — a dirty contact group never corrupts a pristine order group, and vice versa', () => {
  const current = baseServiceJob({
    orderNumber: 'ABC-1',
    orderVerification: 'verified',
  });
  // Only the contact group is supplied as dirty.
  const contactOnlyPatch = buildServiceJobUpdate(
    { contactChannel: 'line', contactChannelIdentity: 'lineid1' },
    current,
    'firestore'
  );
  assert.equal(contactOnlyPatch.contactChannel, 'line');
  assert.equal(contactOnlyPatch.contactChannelIdentity, 'lineid1');
  assert.equal('orderNumber' in contactOnlyPatch, false);
  assert.equal('orderVerification' in contactOnlyPatch, false);

  // Only the order group is supplied as dirty, against a job that already
  // has a real contact channel — the invariant resolver must not corrupt it.
  const current2 = baseServiceJob({ contactChannel: 'shopee', contactChannelIdentity: 'shp1' });
  const orderOnlyPatch = buildServiceJobUpdate(
    { orderNumber: 'NEW-1', orderVerification: 'unverified' },
    current2,
    'firestore'
  );
  assert.equal(orderOnlyPatch.orderNumber, 'NEW-1');
  assert.equal(orderOnlyPatch.orderVerification, 'unverified');
  assert.equal('contactChannel' in orderOnlyPatch, false);
  assert.equal('contactChannelIdentity' in orderOnlyPatch, false);
});

// =====================================================================
// Dirty-only save
// =====================================================================

test('6. a notes-only dirty patch omits status entirely', () => {
  const current = baseServiceJob({ status: 'Received' });
  const patch = buildServiceJobUpdate(
    { notes: [{ author: 'A', date: '2026-08-01', text: 'note' }] },
    current,
    'firestore'
  );
  assert.equal('status' in patch, false);
  assert.deepEqual(patch.notes, [{ author: 'A', date: '2026-08-01', text: 'note' }]);
});

test('7. a status-only dirty patch omits notes entirely', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate({ status: 'In Repair' }, current, 'firestore');
  assert.equal(patch.status, 'In Repair');
  assert.equal('notes' in patch, false);
});

test('8. a status-only dirty patch omits unrelated metadata entirely', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate({ status: 'In Repair' }, current, 'firestore');
  for (const key of [
    'contactChannel',
    'contactChannelIdentity',
    'orderNumber',
    'orderVerification',
    'purchaseDate',
    'orderDeliveredDate',
    'externalEvidenceUrl',
    'externalEvidenceNote',
    'technician',
  ]) {
    assert.equal(key in patch, false, `expected "${key}" to be absent from a status-only patch`);
  }
});

test('9. a dirty atomic metadata group includes every value required for its own invariant', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate(
    { orderNumber: 'NEW-1', orderVerification: null },
    current,
    'firestore'
  );
  // resolveServiceEventMetadataInvariants defaults a present order number
  // with no stated verification to 'unverified' — both keys must be present
  // together since that invariant genuinely couples them.
  assert.equal(patch.orderNumber, 'NEW-1');
  assert.equal(patch.orderVerification, 'unverified');
});

test('an entirely empty edits object produces a patch with no editable-field keys (only updatedAt/closedAt)', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate({}, current, 'firestore');
  for (const key of [
    'status',
    'notes',
    'technician',
    'contactChannel',
    'contactChannelIdentity',
    'orderNumber',
    'orderVerification',
    'purchaseDate',
    'orderDeliveredDate',
    'externalEvidenceUrl',
    'externalEvidenceNote',
  ]) {
    assert.equal(key in patch, false);
  }
  assert.ok('updatedAt' in patch);
  assert.ok('closedAt' in patch);
});

// =====================================================================
// Empty save — skip the repository update entirely
// =====================================================================

const serviceJobDetailsSourcePromiseForSave = readSource(
  'src/features/service-jobs/pages/ServiceJobDetails.tsx'
);

test('saveChanges computes anyDirty and skips updateServiceJob entirely when nothing is dirty', async () => {
  const source = await serviceJobDetailsSourcePromiseForSave;
  assert.match(
    source,
    /const anyDirty =\s*\n\s*statusDirty \|\|\s*\n\s*notesDirty \|\|\s*\n\s*techDirty \|\|\s*\n\s*contactDirty \|\|\s*\n\s*orderDirty \|\|\s*\n\s*purchaseDateDirty \|\|\s*\n\s*orderDeliveredDateDirty \|\|\s*\n\s*externalEvidenceUrlDirty \|\|\s*\n\s*externalEvidenceNoteDirty;/
  );
  const skipBlock = source.match(/if \(!anyDirty\) \{[\s\S]*?\n {6}\}/);
  assert.notEqual(skipBlock, null, 'expected an early-return branch for the no-op save');
  assert.match(skipBlock[0], /onDone\(\);/);
  assert.match(skipBlock[0], /return;/);
  // The skip branch appears strictly before the updateServiceJob call in
  // source order, and updateServiceJob appears exactly once WITHIN
  // saveChanges — so the skip really does bypass it, not run alongside it.
  // F5d-70 Phase 6F.2 — scoped to saveChanges' own body rather than the
  // whole file: addNote() now has its own, entirely separate
  // updateServiceJob call (notes-only quick-add persistence), so a
  // whole-file count would no longer isolate this specific invariant.
  const skipIndex = source.indexOf(skipBlock[0]);
  const updateCallIndex = source.indexOf('await updateServiceJob(claim.id,');
  assert.ok(skipIndex < updateCallIndex);
  const saveChangesBody = source.match(/const saveChanges = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.equal((saveChangesBody.match(/await updateServiceJob\(/g) ?? []).length, 1);
});

test('an empty save still performs the existing completion/navigation behavior (onDone), just without a repository mutation', async () => {
  const source = await serviceJobDetailsSourcePromiseForSave;
  const saveBody = source.match(/const saveChanges = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  // Exactly two onDone() calls in the whole handler: the empty-save skip
  // path and the normal post-mutation path — both reach the same
  // completion behavior, one without ever calling the repository.
  assert.equal((saveBody.match(/onDone\(\);/g) ?? []).length, 2);
});

// =====================================================================
// Double notification
// =====================================================================

test('10. applying the same reconciliation twice with no real change is idempotent — a dirty override survives repeated equivalent updates', () => {
  const local = 'Diagnosing'; // dirty relative to the persisted baseline
  const previous = 'Received';
  const next = 'Received'; // "persisted update" that didn't actually change anything
  const firstPass = reconcileField(local, previous, next);
  const secondPass = reconcileField(firstPass, previous, next);
  assert.equal(firstPass, 'Diagnosing');
  assert.equal(secondPass, 'Diagnosing');
});

// =====================================================================
// Public Tracking (source-structural — no jsdom in this project)
// =====================================================================

const publicTrackingSourcePromise = readSource(
  'src/features/service-jobs/components/PublicTrackingSection.tsx'
);

test('11/15. isActive is derived directly from job.publicTrackingCodeHash (persisted) OR issuedCode (local) — never an independent stored flag', async () => {
  const source = await publicTrackingSourcePromise;
  assert.match(
    source,
    /const isActive = job\.publicTrackingCodeHash !== null \|\| issuedCode !== null;/
  );
  assert.doesNotMatch(source, /useState\(job\.publicTrackingCodeHash/);
  assert.doesNotMatch(source, /setIsActive/);
});

test('12. persisted activation never synthesizes plaintext — issuedCode is set only from a real issuance result, never from job.publicTrackingCodeHash', async () => {
  const source = await publicTrackingSourcePromise;
  // F5d-70 Phase 5B.1 — with the entity-reset effect removed, there is now
  // exactly one explicit setIssuedCode(...) call site in the whole
  // component: the real issuance result inside issue().
  const setIssuedCodeCalls = [...source.matchAll(/setIssuedCode\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(setIssuedCodeCalls.length, 1, 'expected exactly one setIssuedCode(...) call site');
  assert.equal(setIssuedCodeCalls[0], 'result.code');
});

test('13. no localStorage/sessionStorage/IndexedDB/cookie/dataVersion persistence surface exists for the transient plaintext', async () => {
  for (const path of [
    'src/features/service-jobs/components/PublicTrackingSection.tsx',
    'src/features/service-jobs/pages/ServiceJobDetails.tsx',
  ]) {
    const source = await readSource(path);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    // Checks for actual imports/calls, not prose — both files legitimately
    // mention "F5d-70 dataVersion reactivity" in comments explaining why a
    // fresh `claim`/`job` prop shows up, without importing or calling it.
    assert.doesNotMatch(source, /bumpDataVersion\(|from '.*dataVersion'/);
  }
});

test('14. rotate reuses the exact same issue() path — a single code path always overwrites the previous plaintext with the newest, never preserves an old one', async () => {
  const source = await publicTrackingSourcePromise;
  // Only one function issues/rotates; RotateConfirmation's onConfirm calls
  // the same issue() the first-time-issue button calls.
  assert.equal((source.match(/const issue = async \(\) => \{/g) ?? []).length, 1);
  assert.equal((source.match(/onConfirm=\{\(\) => void issue\(\)\}/g) ?? []).length, 2);
});

test('16. issuedCode has no persisted source and defaults to null on every fresh mount — the remount contract structurally destroys it', async () => {
  const source = await publicTrackingSourcePromise;
  assert.match(source, /const \[issuedCode, setIssuedCode\] = useState<string \| null>\(null\);/);
});

test('F5d-70 Phase 5B.1: no entity-RESET effect exists — entity isolation still does not rely on a passive prop-driven reconciliation effect', async () => {
  const source = await publicTrackingSourcePromise;
  // The Phase 5B reset effect (previousJobIdRef + useEffect keyed on
  // job.id, re-initializing state when job.id changed) was removed and
  // must not come back: independent review's point — a passive effect
  // cannot be the entity-isolation mechanism, since it only runs after a
  // render has already committed — still holds. This is distinct from the
  // Phase 5B.2 mount-lifetime guard added below, which has an EMPTY
  // dependency array (never re-keyed on job.id) and only gates an
  // in-flight async continuation, never reconciles state from a prop.
  assert.doesNotMatch(source, /previousJobIdRef/);
  assert.doesNotMatch(source, /\}, \[job\.id\]\);/);
});

// =====================================================================
// F5d-70 Phase 5B.2 — stale async issuance continuation guard
// =====================================================================

test('5B.2-1/5B.2-2. PublicTrackingSection has an explicit mount-lifetime ownership ref, established unconditionally (not per-issuance)', async () => {
  const source = await publicTrackingSourcePromise;
  assert.match(source, /import \{ useLayoutEffect, useRef, useState \} from 'react';/);
  assert.match(source, /const mountedRef = useRef\(true\);/);
  // Established once, before any issuance can ever be awaited — not
  // created fresh inside issue() itself.
  const mountedRefIndex = source.indexOf('const mountedRef = useRef(true);');
  const issueFnIndex = source.indexOf('const issue = async () => {');
  assert.ok(mountedRefIndex < issueFnIndex, 'expected mountedRef to be declared before issue()');
});

// --- F5d-70 Phase 5B.3: StrictMode-safe setup/cleanup re-arming ------------

test('5B.3-1/5B.3-2/5B.3-3. the guard is a useLayoutEffect whose SETUP assigns true and whose CLEANUP assigns false — not a cleanup-only guard', async () => {
  const source = await publicTrackingSourcePromise;
  const guardEffect = source.match(
    /useLayoutEffect\(\(\) => \{\s*\n\s*mountedRef\.current = true;\s*\n\s*return \(\) => \{\s*\n\s*mountedRef\.current = false;\s*\n\s*\};\s*\n\s*\}, \[\]\);/
  );
  assert.notEqual(
    guardEffect,
    null,
    'expected useLayoutEffect with setup assigning true and cleanup assigning false'
  );
});

test('5B.3-4. the setup assignment (true) appears in source before the cleanup assignment (false) within the same effect body', async () => {
  const source = await publicTrackingSourcePromise;
  const effectBody = source.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\}, \[\]\);/)[1];
  const setupIndex = effectBody.indexOf('mountedRef.current = true;');
  const cleanupIndex = effectBody.indexOf('mountedRef.current = false;');
  assert.ok(setupIndex >= 0 && cleanupIndex >= 0 && setupIndex < cleanupIndex);
});

test('5B.3-5. the guard effect remains mount-lifetime-only: an empty dependency array, never keyed on job/job.id/hash/dataVersion', async () => {
  const source = await publicTrackingSourcePromise;
  const effectDeclaration = source.match(/useLayoutEffect\(\(\) => \{\s*\n\s*mountedRef\.current = true;[\s\S]*?\n(\s*\}, \[[^\]]*\]\);)/);
  assert.notEqual(effectDeclaration, null);
  assert.equal(effectDeclaration[1].trim(), '}, []);');
});

test('5B.3-explicit-lifecycle-invariant: source proves the StrictMode setup -> cleanup -> setup sequence ends with ownership true while mounted, and only a real unmount (cleanup with no following setup) ends with false', async () => {
  const source = await publicTrackingSourcePromise;
  // This is not merely "cleanup exists" — it specifically proves BOTH
  // assignments are present in the SAME effect, which is exactly what
  // makes a StrictMode setup->cleanup->setup sequence self-correcting:
  // simulated cleanup sets false, but the second setup (React always runs
  // setup again immediately after StrictMode's simulated cleanup, for a
  // component that stays mounted) sets it back to true before any real
  // application code observes it. A cleanup-only guard (Phase 5B.2's
  // defect) would leave it false forever after that simulated pair,
  // because nothing ever sets it back to true again.
  const setupCount = (source.match(/mountedRef\.current = true;/g) ?? []).length;
  const cleanupCount = (source.match(/mountedRef\.current = false;/g) ?? []).length;
  assert.equal(setupCount, 1, 'expected exactly one setup assignment (mountedRef.current = true)');
  assert.equal(cleanupCount, 1, 'expected exactly one cleanup assignment (mountedRef.current = false)');
});

test('5B.2-3. the guard is checked immediately after await onIssue(job.id), before setIssuedCode or onIssued', async () => {
  const source = await publicTrackingSourcePromise;
  const successPath = source.match(
    /const result = await onIssue\(job\.id\);\s*\n[\s\S]{0,700}?if \(!mountedRef\.current\) return;\s*\n\s*setIssuedCode\(result\.code\);\s*\n\s*setConfirmingRotate\(false\);\s*\n\s*onIssued\?\.\(result\.code\);/
  );
  assert.notEqual(
    successPath,
    null,
    'expected the guard check between the await and setIssuedCode/onIssued'
  );
});

test('5B.2-4. a stale continuation structurally cannot reach onIssued — the guard return precedes every write in the success path', async () => {
  const source = await publicTrackingSourcePromise;
  const tryBlock = source.match(/try \{\s*\n\s*const result = await onIssue\(job\.id\);([\s\S]*?)\} catch/)[1];
  const guardIndex = tryBlock.indexOf('if (!mountedRef.current) return;');
  const onIssuedIndex = tryBlock.indexOf('onIssued?.(result.code);');
  const setIssuedCodeIndex = tryBlock.indexOf('setIssuedCode(result.code);');
  assert.ok(guardIndex >= 0 && guardIndex < setIssuedCodeIndex && setIssuedCodeIndex < onIssuedIndex);
});

test('5B.2-5. catch and finally are guarded too — no parent callback or meaningful local write survives a stale continuation through the error path', async () => {
  const source = await publicTrackingSourcePromise;
  const catchBlock = source.match(/\} catch \(issuanceError\) \{([\s\S]*?)\} finally \{/)[1];
  assert.match(catchBlock, /^\s*if \(!mountedRef\.current\) return;/);
  // onRefreshJob (a parent callback) only fires after the guard, since the
  // guard is the very first statement in the catch block.
  const guardIndex = catchBlock.indexOf('if (!mountedRef.current) return;');
  const onRefreshIndex = catchBlock.indexOf('onRefreshJob?.(job.id);');
  assert.ok(guardIndex < onRefreshIndex);
  const finallyBlock = source.match(/\} finally \{([\s\S]*?)\n {2}\};/)[1];
  assert.match(finallyBlock, /if \(mountedRef\.current\) setIsIssuing\(false\);/);
});

test('5B.2-6. the ordinary (non-stale) success path is unchanged: setIssuedCode, setConfirmingRotate(false), and onIssued all still fire when mounted', async () => {
  const source = await publicTrackingSourcePromise;
  assert.match(source, /setIssuedCode\(result\.code\);/);
  assert.match(source, /setConfirmingRotate\(false\);/);
  assert.match(source, /onIssued\?\.\(result\.code\);/);
});

test('5B.2-7. rotate uses the exact same guarded issue() path — no separate, unguarded rotate implementation exists', async () => {
  const source = await publicTrackingSourcePromise;
  assert.equal((source.match(/const issue = async \(\) => \{/g) ?? []).length, 1);
  assert.equal((source.match(/onConfirm=\{\(\) => void issue\(\)\}/g) ?? []).length, 2);
});

test('5B.2-8. the mount guard introduces no new persistence surface — mountedRef is an ephemeral boolean ref, nothing else', async () => {
  const source = await publicTrackingSourcePromise;
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(source, /mountedRef.*(code|Srv|SRV)/i);
});

test('5B.2-9. NewServiceJob still clears savedPublicTrackingCode when starting a new job (unchanged, re-verified)', async () => {
  const source = await readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
  const startBlock = source.match(/const startNewServiceJob = \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.notEqual(startBlock, null);
  assert.match(startBlock[1], /setSavedPublicTrackingCode\(null\);/);
});

test('5B.2-10. the corrected source structurally prevents a resolved-but-stale A issuance from ever reaching onIssued: no code path calls onIssued without first passing the mounted check', async () => {
  const source = await publicTrackingSourcePromise;
  // Exactly one onIssued call site in the whole file, and it is the one
  // already proven (test 5B.2-3/4) to be preceded by the guard.
  assert.equal((source.match(/onIssued\?\.\(/g) ?? []).length, 1);
});

// =====================================================================
// NewServiceJob — freshest job resolution
// =====================================================================

const newServiceJobSourcePromise = readSource('src/features/service-jobs/pages/NewServiceJob.tsx');

test('17/18. displayJob resolves the freshest repository row by id, falling back to the original saved snapshot', async () => {
  const source = await newServiceJobSourcePromise;
  assert.match(
    source,
    /const displayJob = savedJob\s*\n\s*\? \(serviceJobs\.find\(\(job\) => job\.id === savedJob\.id\) \?\? savedJob\)\s*\n\s*: null;/
  );
});

test('displayJob (not savedJob) is what PublicTrackingSection and ServiceRequestPrintPreview actually render', async () => {
  const source = await newServiceJobSourcePromise;
  assert.match(source, /<PublicTrackingSection\s+job=\{displayJob \?\? savedJob\}/);
  assert.match(source, /<ServiceRequestPrintPreview\s+job=\{displayJob \?\? savedJob\}/);
});

test('19. the auto-print effect depends on exactly [savedJob] — a repository refresh (displayJob/serviceJobs changing) cannot re-trigger it', async () => {
  const source = await newServiceJobSourcePromise;
  const effectBlock = source.match(
    /useEffect\(\(\) => \{\s*\n\s*if \(savedJob\) \{[\s\S]*?\}, \[savedJob\]\);/
  );
  assert.notEqual(effectBlock, null, 'expected the auto-print effect with dependency array [savedJob]');
  assert.match(effectBlock[0], /window\.print\(\);/);
  // displayJob must never appear inside this specific effect body or its
  // dependency array.
  assert.doesNotMatch(effectBlock[0], /displayJob/);
});

test('savedJob itself is reassigned only by handleSaveAndPrint (once) and startNewServiceJob (reset) — no effect re-derives it from serviceJobs', async () => {
  const source = await newServiceJobSourcePromise;
  const setSavedJobCalls = [...source.matchAll(/setSavedJob\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(setSavedJobCalls.sort(), ['job', 'null'].sort());
});

// =====================================================================
// Entity boundary (ServiceJobDetails)
// =====================================================================

const serviceJobDetailsSourcePromise = readSource(
  'src/features/service-jobs/pages/ServiceJobDetails.tsx'
);

// --- F5d-70 Phase 5B.1: entity boundary is now React's own key mechanism ---

test('20.1. ServiceJobDetailsView is keyed by claim.id — the exact entity identity, nothing else', async () => {
  const source = await serviceJobDetailsSourcePromise;
  const viewCall = source.match(/<ServiceJobDetailsView\s+([\s\S]*?)\/>/);
  assert.notEqual(viewCall, null, 'expected the ServiceJobDetailsView render call');
  assert.match(viewCall[1], /key=\{claim\.id\}/);
});

test('20.2. the key expression is literally claim.id — not dataVersion, publicTrackingCodeHash, status, updatedAt, or the generic claim object itself', async () => {
  const source = await serviceJobDetailsSourcePromise;
  const keyMatch = source.match(/key=\{([^}]*)\}/);
  assert.notEqual(keyMatch, null, 'expected a key prop on ServiceJobDetailsView');
  assert.equal(keyMatch[1].trim(), 'claim.id');
  for (const forbidden of ['dataVersion', 'publicTrackingCodeHash', 'status', 'updatedAt', 'JSON.stringify(claim)']) {
    assert.notEqual(keyMatch[1].trim(), forbidden);
  }
});

test('20.3/20.5. no passive entity-boundary reset branch remains — isolation is the mount/unmount lifecycle (the key), not an effect', async () => {
  const source = await serviceJobDetailsSourcePromise;
  // Checks for the actual conditional statement, not prose — this file's
  // own comments legitimately explain (by describing it) that the old
  // `if (previous.id !== claim.id)` branch was removed, without
  // reintroducing that statement.
  assert.doesNotMatch(source, /if \(previous\.id !== claim\.id\)/);
  assert.doesNotMatch(source, /setIssuedTrackingCode\(null\)/);
});

test('20.4. same-job data changes (a claim update, not an identity change) are still selectively reconciled, never a blind full copy', async () => {
  const source = await serviceJobDetailsSourcePromise;
  assert.match(source, /if \(previous === claim\) return;/);
  assert.match(source, /reconcileField\(current, previous\.status, claim\.status\)/);
});

test('the reconciliation effect runs at layout-phase (useLayoutEffect, not useEffect) and depends only on [claim, canReassignTechnician]', async () => {
  const source = await serviceJobDetailsSourcePromise;
  assert.match(source, /import \{ useEffect, useLayoutEffect, useRef, useState \} from 'react';/);
  const layoutEffectBlock = source.match(
    /useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[claim, canReassignTechnician\]\);/
  );
  assert.notEqual(
    layoutEffectBlock,
    null,
    'expected the reconciliation effect to be a useLayoutEffect with deps [claim, canReassignTechnician]'
  );
});

test('the reconciliation effect never calls the repository or bumps dataVersion', async () => {
  const source = await serviceJobDetailsSourcePromise;
  const layoutEffectBlock = source.match(
    /useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[claim, canReassignTechnician\]\);/
  )[0];
  assert.doesNotMatch(layoutEffectBlock, /updateServiceJob|bumpDataVersion/);
});

// =====================================================================
// Existing three-state QR / transient-credential contract still holds
// =====================================================================

test('the F5d-69G transient plaintext handoff to DeliveryNotePrintPreview is untouched by this phase', async () => {
  const source = await serviceJobDetailsSourcePromise;
  assert.match(source, /publicTrackingCode=\{issuedTrackingCode \?\? undefined\}/);
  assert.match(source, /onIssued=\{setIssuedTrackingCode\}/);
});
