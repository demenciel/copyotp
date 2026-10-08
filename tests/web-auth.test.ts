import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebAuth } from '../src/web-auth.ts';
import { AppError, GMAIL_SCOPE } from '../src/types.ts';

const clientId = '1234567890-brave.apps.googleusercontent.com';
const redirect = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
let session: Record<string, any> = {};
let calls: { url: string; interactive: boolean }[] = [];
let respond: (url: string) => Promise<string>;
const callback = (url: string, changes: Record<string, string> = {}) => {
  const state = new URL(url).searchParams.get('state')!;
  return redirect + '#' + new URLSearchParams({ state, access_token: 'synthetic-token',
    token_type: 'Bearer', expires_in: '3600', scope: GMAIL_SCOPE, ...changes });
};
Object.assign(globalThis, { chrome: {
  storage: { session: {
    get: async () => ({ ...session }),
    set: async (value: object) => { Object.assign(session, value); },
    remove: async (key: string) => { delete session[key]; }
  } },
  identity: {
    getRedirectURL: () => redirect,
    launchWebAuthFlow: async (details: { url: string; interactive: boolean }) => { calls.push(details); return respond(details.url); }
  }
} });
function setup() {
  session = {}; calls = [];
  respond = async (url) => callback(url);
  return new WebAuth(clientId);
}
const authError = (error: unknown) => error instanceof AppError && error.code === 'auth';

test('Brave needs its own client and never launches consent during scans', async () => {
  const auth = setup();
  await assert.rejects(new WebAuth('').token(true), (error: unknown) => error instanceof AppError && error.code === 'setup');
  await assert.rejects(auth.token(), authError);
  assert.equal(calls.length, 0);
});
test('Brave requests only Gmail, validates consent, and caches only in session memory', async () => {
  const auth = setup();
  assert.equal(await auth.token(true), 'synthetic-token');
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('redirect_uri'), redirect);
  assert.equal(url.searchParams.get('scope'), GMAIL_SCOPE);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.ok(url.searchParams.get('state')!.length >= 32);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(await auth.token(), 'synthetic-token');
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(session), ['webOAuth']);
  // A replacement service worker can read the browser's memory-only cache.
  assert.equal(await new WebAuth(clientId).token(), 'synthetic-token');
});
test('callbacks reject wrong state, redirect, missing scope, and invalid token metadata', async () => {
  const changes: Record<string, string>[] = [{ state: 'wrong' }, { scope: 'openid' }, { token_type: 'MAC' },
    { access_token: '' }, { expires_in: 'NaN' }, { expires_in: '0' }, { expires_in: '999999' }];
  for (const change of changes) {
    const auth = setup(); respond = async (url) => callback(url, change);
    await assert.rejects(auth.token(true), authError); assert.deepEqual(session, {});
  }
  for (const replace of [
    (value: string) => value.replace('chromiumapp.org', 'evil.example'),
    (value: string) => value.replace('/#', '/other#'),
    (value: string) => value.replace('/#', '/?code=bad#'),
    (value: string) => value + '&state=duplicate'
  ]) {
    const auth = setup(); respond = async (url) => replace(callback(url));
    await assert.rejects(auth.token(true), authError); assert.deepEqual(session, {});
  }
});
test('denial and browser errors never expose callback tokens', async () => {
  const auth = setup(); respond = async (url) => callback(url, { error: 'access_denied' });
  await assert.rejects(auth.token(true), authError);
  respond = async () => { throw new Error('secret-in-provider-error'); };
  await assert.rejects(auth.token(true), (error: unknown) => authError(error) && !(error as Error).message.includes('secret'));
  assert.deepEqual(session, {});
});
test('expired or mismatched-client cache requires explicit reconnect, without silent account switching', async () => {
  const auth = setup(); await auth.token(true);
  session.webOAuth.expiresAt = Date.now() + 1000;
  await assert.rejects(auth.token(), authError);
  assert.deepEqual(session, {}); assert.equal(calls.length, 1);
  await auth.token(true);
  await assert.rejects(new WebAuth('other-client').token(), authError);
  assert.deepEqual(session, {});
});
test('401 invalidation and disconnect remove the token', async () => {
  const auth = setup(); await auth.token(true);
  await auth.invalidate('different-token'); assert.ok(session.webOAuth);
  await auth.invalidate('synthetic-token'); assert.deepEqual(session, {});
  await auth.token(true); await auth.clear(); assert.deepEqual(session, {});
});
test('disconnect prevents an older unfinished consent from restoring a session', async () => {
  const auth = setup(); let finish!: () => void;
  respond = (url) => new Promise((resolve) => { finish = () => resolve(callback(url)); });
  const first = auth.token(true); const second = auth.token(true);
  await auth.clear(); finish();
  assert.equal(await first, 'synthetic-token'); assert.equal(await second, 'synthetic-token');
  assert.equal(calls.length, 1); assert.deepEqual(session, {});
});
