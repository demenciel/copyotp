import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates, rankCandidates } from '../src/extract.ts';
import { decodeBody, normalizeMessage, stripQuotes } from '../src/normalize.ts';
import type { NormalizedMessage } from '../src/types.ts';

const now = 1_800_000_000_000;
const message = (text: string, subject = 'Your sign-in code'): NormalizedMessage => ({
  id: 'test', sender: 'Example <login@example.com>', receivedAt: now - 10_000, subject, text
});
const codes = (text: string, subject?: string) => extractCandidates(message(text, subject), now).map((item) => item.code);

test('preserves leading zeros and sentence punctuation', () => {
  assert.deepEqual(codes('Your verification code is 001234. It expires shortly.'), ['001234']);
});
test('supports four to eight digit codes', () => {
  for (const code of ['0123', '12345', '123456', '1234567', '12345678']) {
    assert.deepEqual(codes(`Use the code: ${code}`), [code]);
  }
});
test('rejects long numbers, alphanumeric fragments and unrelated messages', () => {
  assert.deepEqual(codes('Your code is 123456789.'), []);
  assert.deepEqual(codes('Your code is X123456Y.'), []);
  assert.deepEqual(codes('A receipt for order 123456.', 'Thanks for shopping'), []);
});
test('rejects labelled order IDs, phone numbers, dates and prices near a code', () => {
  assert.deepEqual(codes('Your verification code is 543210. Order number: 987654.'), ['543210']);
  assert.deepEqual(codes('Your code is 543210. Phone: +1 (800) 555-1234.'), ['543210']);
  assert.deepEqual(codes('Your code is 543210. Date: 2026-10-07.'), ['543210']);
  assert.deepEqual(codes('Your code is 543210. Total: $1234.'), ['543210']);
});
test('deduplicates repeated codes but preserves ambiguous choices', () => {
  assert.deepEqual(codes('Your code is 123456. Use the code 123456.'), ['123456']);
  assert.deepEqual(codes('Your code is 123456. Your security code is 654321.'), ['123456', '654321']);
});
test('requires nearby code context rather than any number in a login email', () => {
  assert.deepEqual(codes(`${'Welcome '.repeat(40)}Invoice 123456.`), []);
});
test('rejects stale, invalid and future timestamps', () => {
  for (const receivedAt of [now - 300_001, NaN, now + 120_000]) {
    assert.deepEqual(extractCandidates({ ...message('Your code is 123456.'), receivedAt }, now), []);
  }
});
test('ranks messages by receipt time and retains choices from different senders', () => {
  const older = { ...message('Your code is 123456.'), id: 'older', receivedAt: now - 60_000 };
  const newer = { ...message('Your code is 654321.'), id: 'newer' };
  assert.deepEqual(rankCandidates([older, newer], now).map((item) => item.code), ['654321', '123456']);
});
test('strips quoted and forwarded historical text', () => {
  assert.equal(stripQuotes('Your code is 123456.\n\nOn Monday, Bob wrote:\nYour code is 654321.'), 'Your code is 123456.\n');
  assert.equal(stripQuotes('Your code is 123456.\n> Your code is 654321.'), 'Your code is 123456.');
});
test('decodes base64url and non-ASCII UTF-8 text', () => {
  const original = 'V\u00e9rification: 001234';
  assert.equal(decodeBody(Buffer.from(original).toString('base64url')), original);
  assert.equal(decodeBody(Buffer.from([0xe9]).toString('base64url'), 'text/plain; charset=iso-8859-1'), '\u00e9');
});
test('traverses multipart payloads, preferring plain text and excluding attachments', () => {
  const result = normalizeMessage({ id: 'mime', internalDate: String(now), payload: {
    headers: [{ name: 'Subject', value: 'Your code' }, { name: 'From', value: 'sender@example.com' }],
    mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('Your code is 001234.').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from('<p>Your code is 654321.</p>').toString('base64url') } }
      ] },
      { mimeType: 'text/plain', filename: 'attachment.txt', body: { data: Buffer.from('Your code is 999999.').toString('base64url') } }
    ]
  } }, () => { throw new Error('HTML should not be used'); });
  assert.equal(result.text, 'Your code is 001234.');
  assert.equal(result.sender, 'sender@example.com');
  assert.deepEqual(extractCandidates(result, now).map((item) => item.code), ['001234']);
});
test('uses HTML fallback when no usable plain-text body exists', () => {
  const result = normalizeMessage({ id: 'html', internalDate: String(now), payload: {
    mimeType: 'text/html', body: { data: Buffer.from('<p>Your code is <b>001234</b>.</p>').toString('base64url') }
  } }, () => 'Your code is 001234.');
  assert.equal(result.text, 'Your code is 001234.');
});
