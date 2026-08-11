import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const {
  createMockSession,
  createSignedOutSession,
  getAuthorizedBrandId,
  resolveAuthenticatedSession,
} = await vite.ssrLoadModule('/src/auth/authSession.ts');
const { parseStaffProfile } = await vite.ssrLoadModule('/src/auth/staffProfile.ts');

const user = {
  uid: 'staff-bruno',
  email: 'staff@example.test',
  async getIdToken() {
    return 'not-a-real-token';
  },
};

test('a valid staff profile restores an authorized session scoped to its brand', async () => {
  const session = await resolveAuthenticatedSession(user, async (uid) =>
    parseStaffProfile(uid, uid, 'bruno-thailand')
  );

  assert.equal(session.status, 'authorized');
  assert.equal(getAuthorizedBrandId(session), 'bruno-thailand');
});

test('missing and malformed staff profiles fail closed', async () => {
  const missing = await resolveAuthenticatedSession(user, async () => null);
  const malformed = await resolveAuthenticatedSession(user, async (uid) =>
    parseStaffProfile(uid, uid, 'BRN')
  );

  assert.equal(missing.status, 'denied');
  assert.equal(malformed.status, 'denied');
  assert.equal(getAuthorizedBrandId(missing), null);
  assert.equal(getAuthorizedBrandId(malformed), null);
});

test('signed-out and mock session states remain explicit', () => {
  assert.equal(createSignedOutSession().status, 'signed-out');
  assert.equal(createMockSession().status, 'mock');
});

test('profile parsing rejects a document for a different Firebase user', () => {
  assert.equal(parseStaffProfile('staff-a', 'staff-b', 'bruno-thailand'), null);
});

test('the provider uses Firebase email/password and the route guard has no staff fallback', async () => {
  const [provider, guard, app] = await Promise.all([
    readFile(new URL('../src/auth/AuthSessionProvider.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/auth/StaffRouteGuard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(provider, /signInWithEmailAndPassword/);
  assert.match(provider, /onAuthStateChanged/);
  assert.match(provider, /signOut\(/);
  assert.match(guard, /status === 'signed-out'/);
  assert.match(guard, /status === 'denied'/);
  assert.match(app, /path=\{ROUTE_PATTERNS\.home\} element=\{<TrackHome \/>\}/);
  assert.match(app, /<Route element=\{<StaffRouteGuard \/>\}>/);
});
