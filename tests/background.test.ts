import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Reply, Request } from '../src/types.ts';

class Event<T extends (...args: any[]) => void> {
  listeners: T[] = [];
  addListener(listener: T) { this.listeners.push(listener); }
  emit(...args: Parameters<T>) { this.listeners.forEach((listener) => listener(...args)); }
}
class Port {
  name = 'copyotp';
  sender = { id: 'extension', url: 'chrome-extension://extension/popup.html' };
  onMessage = new Event<(request: Request) => void>();
  onDisconnect = new Event<() => void>();
  replies: Reply[] = [];
  disconnected = false;
  nextId = 0;
  postMessage(reply: Reply) { this.replies.push(reply); }
  disconnect() { this.disconnected = true; this.onDisconnect.emit(); }
  send(action: Request['action'], extra: Partial<Request> = {}) {
    const id = ++this.nextId; this.onMessage.emit({ ...extra, id, action }); return id;
  }
  async reply(id: number) {
    for (let i = 0; i < 100; i++) {
      const found = this.replies.find((reply) => reply.id === id);
      if (found) return found.result;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error('No worker reply');
  }
}

const onConnect = new Event<(port: Port) => void>();
let state = false;
const writes: Record<string, unknown>[] = [];
let configured = true;
let auth: (interactive: boolean) => Promise<{ token: string; grantedScopes: string[] }> = async () => ({ token: 'test-token', grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
const tokenCalls: boolean[] = [];
const cleared: string[] = [];
const urls: string[] = [];
let handler: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith('/profile')) return new Response(JSON.stringify({ emailAddress: 'test@example.com' }));
  if (new URL(url).pathname.endsWith('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'one' }] }));
  return new Response(JSON.stringify({ id: 'one', internalDate: String(Date.now()), payload: { mimeType: 'text/plain', body: { data: btoa('Your code is 123456.') } } }));
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => { urls.push(String(input)); return handler(input, options); };
Object.assign(globalThis, { chrome: {
  runtime: { id: 'extension', onConnect, getURL: (path: string) => `chrome-extension://extension/${path}`,
    getManifest: () => configured ? { oauth2: { client_id: '123-client.apps.googleusercontent.com' } } : {} },
  storage: { local: {
    setAccessLevel: async () => {}, get: async () => ({ connected: state }),
    set: async (value: Record<string, unknown>) => { writes.push(value); state = Boolean(value.connected); }
  } },
  identity: {
    getAuthToken: async (details: { interactive: boolean }) => { tokenCalls.push(details.interactive); return auth(details.interactive); },
    removeCachedAuthToken: async (details: { token: string }) => { cleared.push(details.token); },
    clearAllCachedAuthTokens: async () => { cleared.push('all'); }
  }
} });
await import('../src/background.ts');
const open = () => { const port = new Port(); onConnect.emit(port); return port; };
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

test('rejects connections from non-popup pages', () => {
  const port = new Port(); port.sender.url = 'https://untrusted.example'; onConnect.emit(port);
  assert.equal(port.disconnected, true);
});
test('status never prompts for authorization', async () => {
  const port = open(); const before = tokenCalls.length;
  assert.equal((await port.reply(port.send('status'))).kind, 'status');
  assert.equal(tokenCalls.length, before); port.disconnect();
});
test('setup state prevents OAuth before a client is configured', async () => {
  configured = false;
  const port = open(); const result = await port.reply(port.send('connect'));
  assert.equal(result.kind, 'error'); if (result.kind === 'error') assert.equal(result.code, 'setup');
  configured = true; port.disconnect();
});
test('explicit connection stores only the connection preference; scans remain read-only', async () => {
  const port = open();
  assert.equal((await port.reply(port.send('connect'))).kind, 'connected');
  assert.equal(tokenCalls.at(-1), true);
  const result = await port.reply(port.send('scan'));
  assert.equal(result.kind, 'scan');
  if (result.kind === 'scan') { assert.equal(result.messages.length, 1); assert.equal(result.email, 'test@example.com'); }
  assert.equal(tokenCalls.at(-1), false);
  assert.ok(urls.every((url) => url.startsWith('https://gmail.googleapis.com/')));
  assert.ok(writes.every((value) => Object.keys(value).length === 1 && typeof value.connected === 'boolean'));
  port.disconnect();
});
test('closing the popup aborts mail requests and suppresses replies', async () => {
  const originalHandler = handler;
  let aborted = false;
  handler = async (_input, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => {
    aborted = true; reject(new DOMException('Aborted', 'AbortError'));
  }));
  const port = open(); const id = port.send('scan'); await pause(); port.disconnect(); await pause();
  assert.equal(aborted, true); assert.equal(port.replies.some((reply) => reply.id === id), false);
  handler = originalHandler;
});
test('successful consent can finish after the initiating popup closes', async () => {
  state = false;
  let finish!: (value: { token: string; grantedScopes: string[] }) => void;
  const originalAuth = auth;
  auth = () => new Promise((resolve) => { finish = resolve; });
  const port = open(); port.send('connect'); await pause(); port.disconnect();
  finish({ token: 'late-token', grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] }); await pause();
  assert.equal(state, true); auth = originalAuth;
});
test('a disconnect takes precedence over an older unfinished consent', async () => {
  let finish!: (value: { token: string; grantedScopes: string[] }) => void;
  const originalAuth = auth;
  auth = () => new Promise((resolve) => { finish = resolve; });
  const first = open(); const connectId = first.send('connect'); await pause();
  const second = open(); assert.equal((await second.reply(second.send('disconnect'))).kind, 'disconnected');
  finish({ token: 'obsolete-token', grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
  assert.equal((await first.reply(connectId)).kind, 'disconnected'); assert.equal(state, false);
  assert.ok(cleared.includes('obsolete-token'));
  auth = originalAuth; first.disconnect(); second.disconnect();
});
test('disconnected status never resumes scans through a cached Google grant', async () => {
  const port = open(); const before = urls.length;
  const result = await port.reply(port.send('scan'));
  assert.equal(result.kind, 'error'); if (result.kind === 'error') assert.equal(result.code, 'auth');
  assert.equal(urls.length, before); port.disconnect();
});
test('all worker preference writes exclude emails, bodies, codes and tokens', () => {
  assert.ok(writes.length > 0);
  assert.ok(writes.every((value) => Object.keys(value).join(',') === 'connected'));
  globalThis.fetch = originalFetch;
});
