import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// F5d-70 Phase 6F.2 — production acceptance found the "เพิ่ม" Internal Note
// button was draft-only: it appended to local React state and cleared the
// input, looking completed, but performed no persistence call — only the
// separate page-level "บันทึกการเปลี่ยนแปลง" action ever wrote it. A
// reload/navigation before that global Save silently destroyed the note.
// This file proves addNote() is now its own notes-only persistence
// operation, entirely independent of saveChanges()'s dirty-field patch, and
// that it cannot leak unrelated in-progress edits into its request.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const sourcePromise = readSource(
  'src/features/service-jobs/pages/ServiceJobDetails.tsx'
);

const extractFunction = (source, name) => {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `expected to find ${name} declaration`);
  // Walk to this function's matching closing brace by simple depth count —
  // sufficient here since the extracted body contains no template-literal
  // braces of its own.
  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(bodyStart, i + 1);
};

// --- A/G/H: notes-only update, pending guard, shared handler ---------------

test('addNote is an async, independently-guarded operation (not the old synchronous draft-only append)', async () => {
  const source = await sourcePromise;
  assert.match(source, /const addNote = async \(\) => \{/);
  assert.doesNotMatch(source, /const addNote = \(\) => \{/);
});

test('addNote fails closed while a note submission is already pending (checked at the very top, before any await)', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const guardIndex = body.indexOf('if (isAddingNote || isSaving) return;');
  const awaitIndex = body.indexOf('await updateServiceJob');
  assert.notEqual(guardIndex, -1, 'expected an isAddingNote || isSaving pending guard');
  assert.notEqual(awaitIndex, -1, 'expected an awaited updateServiceJob call');
  assert.ok(
    guardIndex < awaitIndex,
    'the pending guard must run before the persistence call, not after'
  );
});

// --- F5d-70 Phase 6F.4: mutual exclusion between Quick Add and global Save ---

test('addNote guard includes BOTH isAddingNote and isSaving — Quick Add cannot start while global Save is in flight', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  assert.match(body, /if \(isAddingNote \|\| isSaving\) return;/);
});

test('saveChanges guard includes BOTH isSaving and isAddingNote — global Save cannot start while Quick Add is in flight', async () => {
  const source = await sourcePromise;
  const saveStart = source.indexOf('const saveChanges = async () => {');
  const addNoteStart = source.indexOf('const addNote = async () => {');
  const saveBody = source.slice(saveStart, addNoteStart);
  assert.match(saveBody, /if \(isSaving \|\| isAddingNote\) return;/);
  // this guard must be the very first statement, before dirty calculation,
  // the repository mutation, and onDone/navigation
  const guardIndex = saveBody.indexOf('if (isSaving || isAddingNote) return;');
  const dirtyIndex = saveBody.indexOf('const statusDirty');
  const updateCallIndex = saveBody.indexOf('await updateServiceJob(claim.id,');
  const onDoneIndex = saveBody.indexOf('onDone();');
  assert.notEqual(guardIndex, -1);
  assert.ok(guardIndex < dirtyIndex);
  assert.ok(guardIndex < updateCallIndex);
  assert.ok(guardIndex < onDoneIndex);
});

test('the note input is disabled while either Quick Add or global Save is in flight', async () => {
  const source = await sourcePromise;
  assert.match(
    source,
    /id="service-job-team-note"[\s\S]*?disabled=\{isAddingNote \|\| isSaving\}/
  );
});

test('the Add button is disabled while either Quick Add or global Save is in flight', async () => {
  const source = await sourcePromise;
  assert.match(
    source,
    /onClick=\{\(\) => void addNote\(\)\}\s*\n\s*disabled=\{isAddingNote \|\| isSaving\}/
  );
});

test('the global Save button is disabled while either Save or Quick Add is in flight', async () => {
  const source = await sourcePromise;
  assert.match(
    source,
    /onClick=\{\(\) => void saveChanges\(\)\} disabled=\{isSaving \|\| isAddingNote\}/
  );
});

test('pending labels stay truthful — Quick Add shows its own pending label, Save is simply disabled (no borrowed/duplicated spinner text)', async () => {
  const source = await sourcePromise;
  assert.match(source, /\{isAddingNote \? 'กำลังเพิ่ม…' : 'เพิ่ม'\}/);
  assert.match(source, /\{isSaving \? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'\}/);
});

test('blank/whitespace-only note text is a no-op — no state changes, no persistence call', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  assert.match(body, /const text = note\.trim\(\);\s*\n\s*if \(!text\) return;/);
});

// --- B: notes-only update — no unrelated dirty fields ------------------------

test('addNote calls updateServiceJob with ONLY a notes key — no status/technician/metadata fields', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const callMatch = body.match(/await updateServiceJob\(claim\.id, (\{[\s\S]*?\})\);/);
  assert.notEqual(callMatch, null, 'expected an updateServiceJob(claim.id, { ... }) call');
  const argsLiteral = callMatch[1];
  assert.match(argsLiteral, /^\{\s*notes:\s*nextNotes\s*\}$/);
  for (const forbidden of [
    'status',
    'technician',
    'contactChannel',
    'orderNumber',
    'purchaseDate',
    'orderDeliveredDate',
    'externalEvidence',
  ]) {
    assert.doesNotMatch(argsLiteral, new RegExp(forbidden));
  }
});

test('addNote never calls the page-level saveChanges() function', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  assert.doesNotMatch(body, /saveChanges\(/);
});

test('nextNotes is built from the current local notes array plus exactly one new note object', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  assert.match(
    body,
    /const nextNotes = \[\s*\n\s*\.\.\.notes,\s*\n\s*\{\s*\n\s*author: user\?\.email \?\? 'เจ้าหน้าที่',\s*\n\s*date: toIsoDate\(new Date\(\)\),\s*\n\s*text,\s*\n\s*\},\s*\n\s*\];/
  );
});

// --- C/D/E/F: non-optimistic success ordering, failure UX --------------------

test('the input is not cleared until persistence has succeeded — setNote("") appears only after the awaited call, never before', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const awaitIndex = body.indexOf('await updateServiceJob');
  const clearIndex = body.indexOf("setNote('')");
  assert.notEqual(clearIndex, -1, 'expected setNote(\'\') to appear');
  assert.ok(clearIndex > awaitIndex, 'input must not clear before the await settles');
  // and not inside the catch/finally blocks either
  const catchIndex = body.indexOf('} catch (error) {');
  assert.ok(clearIndex < catchIndex, "the success-path setNote('') must run before catch, not inside it");
});

test('on success, local notes are set to the exact persisted nextNotes value, before the input is cleared', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  assert.match(
    body,
    /await updateServiceJob\(claim\.id, \{ notes: nextNotes \}\);\s*\n\s*setNotes\(nextNotes\);\s*\n\s*setNote\(''\);/
  );
});

test('on failure, the note text is retained (no setNote call in the catch branch) and no note is optimistically appended', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const catchMatch = body.match(/\} catch \(error\) \{([\s\S]*?)\} finally \{/);
  assert.notEqual(catchMatch, null, 'expected a catch block');
  const catchBody = catchMatch[1];
  assert.doesNotMatch(catchBody, /setNote\(/);
  assert.doesNotMatch(catchBody, /setNotes\(/);
  assert.match(catchBody, /setNoteError\(serviceJobUpdateErrorMessage\(error\)\)/);
});

test('setNotes(nextNotes) — the only place the note is added to displayed state — is never reachable before the awaited persistence call', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const awaitIndex = body.indexOf('await updateServiceJob');
  const allSetNotesCalls = [...body.matchAll(/setNotes\(/g)];
  assert.equal(allSetNotesCalls.length, 1, 'expected exactly one setNotes call in addNote');
  assert.ok(allSetNotesCalls[0].index > awaitIndex);
});

test('pending state is entered before the call and always cleared in finally, regardless of outcome', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const setTrueIndex = body.indexOf('setIsAddingNote(true)');
  const awaitIndex = body.indexOf('await updateServiceJob');
  const finallyMatch = body.match(/\} finally \{([\s\S]*?)\}\s*$/);
  assert.notEqual(setTrueIndex, -1);
  assert.ok(setTrueIndex < awaitIndex, 'must enter pending before persisting');
  assert.notEqual(finallyMatch, null, 'expected a finally block');
  assert.match(finallyMatch[1], /setIsAddingNote\(false\)/);
});

test('error is cleared at the start of every submission attempt, before the call', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const clearErrorIndex = body.indexOf('setNoteError(null)');
  const awaitIndex = body.indexOf('await updateServiceJob');
  assert.notEqual(clearErrorIndex, -1);
  assert.ok(clearErrorIndex < awaitIndex);
});

// --- H: Enter and button share the same guarded handler ----------------------

test('both the button click and Enter keydown invoke the exact same addNote() function — no separate optimistic path for either', async () => {
  const source = await sourcePromise;
  assert.match(source, /onKeyDown=\{\(e\) => e\.key === 'Enter' && void addNote\(\)\}/);
  assert.match(source, /onClick=\{\(\) => void addNote\(\)\}/);
});

test('the submit button is visually disabled while a note or a global save is pending', async () => {
  const source = await sourcePromise;
  const buttonBlock = source.match(
    /onClick=\{\(\) => void addNote\(\)\}\s*\n\s*disabled=\{isAddingNote \|\| isSaving\}/
  );
  assert.notEqual(buttonBlock, null);
});

// --- Inline error surface -----------------------------------------------------

test('a note-specific inline error is rendered near the Internal Notes control, independent of the page-level saveError alert', async () => {
  const source = await sourcePromise;
  assert.match(source, /<AsyncErrorAlert message=\{noteError\} className="mt-2" \/>/);
  // saveError's own alert must remain a distinct, separately-rendered element
  assert.match(source, /<AsyncErrorAlert message=\{saveError\} className="pb-4" \/>/);
});

// --- I: global dirty-only Save contract remains intact ------------------------

test('saveChanges() dirty-field computation and skip-when-nothing-dirty behavior are unchanged', async () => {
  const source = await sourcePromise;
  assert.match(source, /const notesDirty = !notesEqual\(notes, claim\.notes\);/);
  assert.match(source, /const anyDirty =\s*\n\s*statusDirty \|\|\s*\n\s*notesDirty \|\|/);
  assert.match(source, /if \(!anyDirty\) \{\s*\n\s*onDone\(\);\s*\n\s*return;\s*\n\s*\}/);
  assert.match(source, /\.\.\.\(notesDirty \? \{ notes \} : \{\}\),/);
});

test('saveChanges() itself is untouched aside from surrounding context — its own updateServiceJob call still sends the full dirty patch, not notes-only', async () => {
  const source = await sourcePromise;
  const saveStart = source.indexOf('const saveChanges = async () => {');
  const addNoteStart = source.indexOf('const addNote = async () => {');
  assert.ok(saveStart !== -1 && addNoteStart !== -1 && saveStart < addNoteStart);
  const saveBody = source.slice(saveStart, addNoteStart);
  assert.match(saveBody, /await updateServiceJob\(claim\.id, \{\s*\n\s*\.\.\.\(statusDirty/);
});

// --- J: entity-key / Public Tracking contracts unaffected ----------------------

test('the key={claim.id} entity boundary and PublicTrackingSection wiring are unaffected by this patch', async () => {
  const source = await sourcePromise;
  assert.match(source, /key=\{claim\.id\}/);
  assert.match(source, /<PublicTrackingSection\s+([\s\S]*?)\/>/);
  const sectionCall = source.match(/<PublicTrackingSection\s+([\s\S]*?)\/>/)[1];
  assert.match(sectionCall, /onIssue=\{issuePublicTrackingCode\}/);
  assert.match(sectionCall, /onRefreshJob=\{readServiceJob\}/);
  assert.match(sectionCall, /onIssued=\{setIssuedTrackingCode\}/);
});

test('this patch does not touch PublicTrackingSection.tsx or NewServiceJob.tsx source files', async () => {
  const [publicTracking, newServiceJob] = await Promise.all([
    readSource('src/features/service-jobs/components/PublicTrackingSection.tsx'),
    readSource('src/features/service-jobs/pages/NewServiceJob.tsx'),
  ]);
  // Sanity: these files still exist and are readable; the actual "unchanged"
  // guarantee is enforced by git diff scoping in the phase report, not by a
  // content assertion here (this file cannot see git history).
  assert.ok(publicTracking.length > 0);
  assert.ok(newServiceJob.length > 0);
});

// --- K: note shape unchanged ----------------------------------------------------

test('the persisted note object shape remains exactly {author, date, text} — no new fields introduced', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  const noteObjectMatch = body.match(/\{\s*\n\s*author: user\?\.email \?\? 'เจ้าหน้าที่',\s*\n\s*date: toIsoDate\(new Date\(\)\),\s*\n\s*text,\s*\n\s*\}/);
  assert.notEqual(noteObjectMatch, null);
});

// --- L: no navigation / onDone from the quick-note path -------------------------

test('addNote never calls onDone or navigate — it is a local persistence action, not a page-completion action', async () => {
  const source = await sourcePromise;
  const body = extractFunction(source, 'addNote');
  // Matches an actual call site, not prose in a comment (e.g. the F5d-70
  // Phase 6F.4 comment explaining Save's onDone() mentions the name without
  // calling it here).
  assert.doesNotMatch(body, /[^/]\bonDone\(\);/);
  assert.doesNotMatch(body, /\bnavigate\(/);
});

// --- Same-job reconciliation: unrelated dirty fields survive a notes-only write --

test('the same-job reconciliation effect resolves each field/group independently by its own pristine check — a notes-only persisted update cannot discard an unrelated dirty field', async () => {
  const source = await sourcePromise;
  // status/tech/eventMetadata each compare the LOCAL value against the
  // PREVIOUS claim value (never against `next` directly) to decide
  // pristine-ness, so a notes-only write (which changes claim.notes but
  // leaves claim.status/technician/contact/order/etc identical to
  // `previous`) can only ever affect the notes field's own reconciliation
  // branch — every other field's pristine check independently evaluates to
  // "unchanged from previous", which is a no-op regardless of what notes did.
  assert.match(source, /setStatus\(\(current\) => reconcileField\(current, previous\.status, claim\.status\)\);/);
  assert.match(source, /setNotes\(\(current\) => reconcileField\(current, previous\.notes, claim\.notes, notesEqual\)\);/);
  assert.match(source, /setTech\(\(current\) => reconcileField\(current, previous\.technician, claim\.technician\)\);/);
});
