import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailClient, scanCutoff } from '../src/gmail.ts';
import { AppError } from '../src/types.ts';

const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const signal = () => new AbortController().signal;

test('calls browser fetch with its global receiver', async () => {
  const fetcher: typeof fetch = async function (this: typeof globalThis) {
    assert.equal(this, globalThis);
    return json({ emailAddress: 'test@example.com' });
  };
  const client = new GmailClient(async () => 'token', async () => {}, fetcher);
  assert.equal((await client.profile(signal())).emailAddress, 'test@example.com');
});

test('scans the recent mailbox without an unread or inbox restriction and follows a bounded page', async () => {
  const urls: URL[] = [];
  const now = Date.now();
  const client = new GmailClient(async () => 'token', async () => {}, async (input, options) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.cache, 'no-store');
    assert.deepEqual(options?.headers, { Authorization: 'Bearer token' });
    if (url.pathname.endsWith('/messages')) return json({ messages: [{ id: 'fresh' }, { id: 'old' }], nextPageToken: 'next' });
    return json({ id: url.pathname.split('/').at(-1), internalDate: String(url.pathname.endsWith('/old') ? now - 600_000 : now) });
  });
  const result = await client.scan(signal(), scanCutoff(now), 'page2');
  assert.equal(urls[0].origin, 'https://gmail.googleapis.com');
  assert.equal(urls[0].searchParams.get('maxResults'), '20');
  assert.equal(urls[0].searchParams.get('pageToken'), 'page2');
  assert.match(urls[0].searchParams.get('q')!, /^after:\d+ -in:spam -in:trash$/);
  assert.deepEqual(result.messages.map((item) => item.id), ['fresh']);
  assert.equal(result.nextPageToken, 'next');
});
test('refreshes an expired token once without an interactive sign-in', async () => {
  let calls = 0;
  const cleared: string[] = [];
  const client = new GmailClient(async () => `token${calls}`, async (value) => { cleared.push(value); }, async () => ++calls === 1 ? json({}, 401) : json({ emailAddress: 'test@example.com' }));
  assert.equal((await client.profile(signal())).emailAddress, 'test@example.com');
  assert.deepEqual(cleared, ['token0']); assert.equal(calls, 2);
});
test('does not loop when access remains unauthorized', async () => {
  let calls = 0;
  const client = new GmailClient(async () => 'token', async () => {}, async () => { calls++; return json({}, 401); });
  await assert.rejects(client.profile(signal()), (error: AppError) => error.code === 'auth');
  assert.equal(calls, 2);
});
test('honors rate limits and distinguishes missing API access', async () => {
  const before = Date.now();
  const limited = new GmailClient(async () => 'token', async () => {}, async () => json({}, 429, { 'Retry-After': '60' }));
  await assert.rejects(limited.profile(signal()), (error: AppError) => error.code === 'rate-limit' && error.retryAt! >= before + 60_000);
  const denied = new GmailClient(async () => 'token', async () => {}, async () => json({}, 403));
  await assert.rejects(denied.profile(signal()), (error: AppError) => error.code === 'api');
});
test('stops before making a request when the popup scan is cancelled', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const client = new GmailClient(async () => 'token', async () => {}, async () => { calls++; return json({}); });
  await assert.rejects(client.profile(controller.signal)); assert.equal(calls, 0);
});
test('limits simultaneous message reads to four', async () => {
  let active = 0; let maxActive = 0;
  const client = new GmailClient(async () => 'token', async () => {}, async (input) => {
    if (new URL(String(input)).pathname.endsWith('/messages')) return json({ messages: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })) });
    active++; maxActive = Math.max(active, maxActive);
    await new Promise((resolve) => setTimeout(resolve, 2)); active--;
    return json({ id: String(input), internalDate: String(Date.now()) });
  });
  assert.equal((await client.scan(signal(), scanCutoff())).messages.length, 20);
  assert.equal(maxActive, 4);
});
