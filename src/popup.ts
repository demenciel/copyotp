import { createIcons, Copy, Mail, ShieldCheck, ExternalLink, RefreshCw, LogOut, Inbox, Search, Timer, Square, Check } from 'lucide';
import { normalizeMessage } from './normalize.ts';
import { rankCandidates } from './extract.ts';
import { FRESHNESS_MS } from './types.ts';
import type { Action, Candidate, NormalizedMessage, Reply, Request, Result } from './types.ts';

const icons = () => createIcons({ icons: { Copy, Mail, ShieldCheck, ExternalLink, RefreshCw, LogOut, Inbox, Search, Timer, Square, Check } });
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const port = chrome.runtime.connect({ name: 'copyotp' });
const browser = (async (): Promise<Request['browser']> => {
  try {
    const brave = (navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } }).brave;
    return await brave?.isBrave() ? 'brave' : 'chrome';
  } catch { return 'chrome'; }
})();
const pending = new Map<number, (result: Result) => void>();
let requestId = 0;
let revision = 0;
let isConnected = false;
let busy = false;
let candidates: Candidate[] = [];
let messages: NormalizedMessage[] = [];
let nextPageToken: string | undefined;
let scanId: string | undefined;
let waitingUntil = 0;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let waitDeadline: ReturnType<typeof setTimeout> | undefined;
let rateLimitedUntil = 0;
let closed = false;

async function request(action: Action, extra: Partial<Request> = {}): Promise<Result> {
  const browserName = await browser;
  if (closed) return Promise.resolve({ kind: 'error', code: 'api', message: 'Reopen CopyOTP to continue.' });
  return new Promise((resolve) => {
    const id = ++requestId;
    pending.set(id, resolve);
    port.postMessage({ ...extra, id, action, browser: browserName });
  });
}
port.onMessage.addListener((reply: Reply) => {
  pending.get(reply.id)?.(reply.result);
  pending.delete(reply.id);
});
port.onDisconnect.addListener(() => {
  closed = true;
  for (const resolve of pending.values()) resolve({ kind: 'error', code: 'api', message: 'Connection lost. Reopen CopyOTP to continue.' });
  pending.clear();
  stopWaiting();
  feedback('Connection lost. Reopen CopyOTP to continue.');
});

function feedback(message = '', success = false) {
  const box = element('feedback');
  box.textContent = message;
  box.hidden = !message;
  box.classList.toggle('success', success);
}

function controls() {
  document.body.classList.toggle('busy', busy);
  element<HTMLButtonElement>('refresh').disabled = busy || Date.now() < rateLimitedUntil || !isConnected;
  element<HTMLButtonElement>('more').disabled = busy || Date.now() < rateLimitedUntil || !isConnected;
  element<HTMLButtonElement>('wait').disabled = busy || Date.now() < rateLimitedUntil || !isConnected;
  element<HTMLButtonElement>('connect').disabled = busy;
  element('wait').hidden = Boolean(waitingUntil);
  element('stop').hidden = !waitingUntil;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.copy-button')) {
    const candidate = candidates.find((item) => item.id === button.dataset.id);
    const expired = !candidate || Date.now() - candidate.receivedAt > FRESHNESS_MS;
    button.disabled = busy || expired || !isConnected;
    button.closest('.candidate')?.classList.toggle('expired', expired);
    if (expired) { button.title = 'Code expired. Refresh to find a recent code'; }
  }
}

function showConnection(connected: boolean) {
  isConnected = connected;
  document.body.classList.toggle('connected', connected);
  element('configuration').hidden = true;
  element('setup').hidden = connected;
  element('workspace').hidden = !connected;
  if (!connected) {
    candidates = []; messages = []; nextPageToken = undefined; scanId = undefined;
    element('candidates').replaceChildren();
    stopWaiting();
  }
  controls();
}

function showEmpty(title: string, detail: string) {
  element('empty').hidden = candidates.length > 0;
  element('empty-title').textContent = title;
  element('empty-detail').textContent = detail;
}

function age(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60 ? 'Just now' : `${Math.floor(seconds / 60)}m ago`;
}

function icon(name: string) {
  const node = document.createElement('i');
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function renderCandidates() {
  const nodes = candidates.map((candidate) => {
    const row = document.createElement('article'); row.className = 'candidate';
    const top = document.createElement('div'); top.className = 'candidate-top';
    const sender = document.createElement('span'); sender.className = 'sender';
    sender.textContent = candidate.sender || 'Unknown sender';
    const received = document.createElement('span'); received.className = 'age';
    received.dataset.receivedAt = String(candidate.receivedAt); received.textContent = age(candidate.receivedAt);
    top.append(sender, received);
    const subject = document.createElement('p'); subject.className = 'subject'; subject.textContent = candidate.subject || '(No subject)';
    const codeRow = document.createElement('div'); codeRow.className = 'code-row';
    const code = document.createElement('code'); code.className = 'otp'; code.textContent = candidate.code;
    code.tabIndex = 0; code.setAttribute('aria-label', `Code ${candidate.code}`);
    const copy = document.createElement('button'); copy.className = 'button copy-button'; copy.dataset.id = candidate.id;
    copy.setAttribute('aria-label', `Copy code ${candidate.code}`);
    copy.title = `Copy code ${candidate.code}`; copy.append(icon('copy'));
    copy.addEventListener('click', async () => {
      if (!isConnected || busy) return;
      if (Date.now() - candidate.receivedAt > FRESHNESS_MS) { controls(); feedback('This code is over five minutes old. Refresh for a recent message.'); return; }
      const copyRevision = revision;
      try {
        await navigator.clipboard.writeText(candidate.code);
        if (copyRevision !== revision) return;
        copy.replaceChildren(icon('check')); copy.title = 'Copied'; icons();
        feedback('Code copied.', true);
      } catch {
        feedback('Could not copy. Select the code and copy it manually.');
      }
    });
    codeRow.append(code, copy); row.append(top, subject, codeRow); return row;
  });
  element('candidates').replaceChildren(...nodes);
  element('count').hidden = !candidates.length;
  element('count').textContent = `${candidates.length} found`;
  element('result-title').textContent = candidates.length > 1 ? 'Choose a code' : 'Recent codes';
  element('more').hidden = !nextPageToken;
  showEmpty('No recent code', 'Request a login code, then refresh or wait.');
  icons(); controls();
}

function handleError(result: Extract<Result, { kind: 'error' }>) {
  if (result.code === 'rate-limit') rateLimitedUntil = result.retryAt || Date.now() + 30_000;
  if (result.code === 'auth') showConnection(false);
  stopWaiting();
  showEmpty('Could not check Gmail', 'Refresh to try again.');
  feedback(result.message);
}

async function scan(more = false) {
  if (busy || !isConnected || closed || Date.now() < rateLimitedUntil) return;
  const scanRevision = revision;
  busy = true; feedback(); controls();
  showEmpty(waitingUntil ? 'Waiting for your code' : 'Checking Gmail', 'Looking at the last five minutes.');
  const result = await request('scan', more ? { pageToken: nextPageToken, scanId } : {});
  if (scanRevision !== revision) return;
  busy = false;
  if (result.kind === 'scan') {
    let normalized: NormalizedMessage[];
    try { normalized = result.messages.map((message) => normalizeMessage(message)); }
    catch {
      handleError({ kind: 'error', code: 'api', message: 'Could not read an email in this scan. Please refresh.' });
      controls(); return;
    }
    const combined = more ? [...messages, ...normalized] : normalized;
    messages = [...new Map(combined.map((message) => [message.id, message])).values()];
    candidates = rankCandidates(messages);
    nextPageToken = result.nextPageToken; scanId = result.scanId;
    element('account').textContent = result.email;
    renderCandidates();
    if (candidates.length) stopWaiting();
    else if (waitingUntil) showEmpty('Waiting for your code', 'Checking Gmail every five seconds.');
  } else if (result.kind === 'error') handleError(result);
  controls();
  scheduleWait();
}

function stopWaiting() {
  waitingUntil = 0;
  clearTimeout(waitTimer);
  clearTimeout(waitDeadline);
  element('wait-time').textContent = '';
  controls();
}

function finishWait() {
  revision++;
  stopWaiting(); busy = false;
  void request('cancel');
  showEmpty('No code arrived yet', 'You can request another code and try again.'); controls();
}

function scheduleWait() {
  clearTimeout(waitTimer);
  if (!waitingUntil || busy) return;
  if (Date.now() >= waitingUntil) {
    finishWait(); return;
  }
  waitTimer = setTimeout(() => {
    if (Date.now() >= waitingUntil) { scheduleWait(); return; }
    void scan();
  }, Math.min(5000, waitingUntil - Date.now()));
}

element('connect').addEventListener('click', async () => {
  if (busy) return;
  const connectRevision = revision;
  busy = true; feedback(); controls();
  const result = await request('connect');
  if (connectRevision !== revision) return;
  busy = false;
  if (result.kind === 'connected') { showConnection(true); void scan(); }
  else if (result.kind === 'error') handleError(result);
  controls();
});
element('disconnect').addEventListener('click', async () => {
  revision++;
  busy = false;
  showConnection(false); feedback();
  const result = await request('disconnect');
  if (result.kind === 'error') feedback(result.message);
});
element('refresh').addEventListener('click', () => { stopWaiting(); void scan(); });
element('more').addEventListener('click', () => { stopWaiting(); void scan(true); });
element('wait').addEventListener('click', () => {
  waitingUntil = Date.now() + 60_000;
  waitDeadline = setTimeout(finishWait, 60_000);
  controls(); void scan();
});
element('stop').addEventListener('click', () => {
  revision++; stopWaiting(); busy = false; void request('cancel');
  showEmpty('Waiting stopped', 'Refresh whenever you are ready.'); controls();
});
element('copy-id').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(element('extension-id').textContent || ''); feedback('Extension ID copied.', true); }
  catch { feedback('Select the extension ID to copy it manually.'); }
});

const tick = setInterval(() => {
  document.querySelectorAll<HTMLElement>('[data-received-at]').forEach((node) => { node.textContent = age(Number(node.dataset.receivedAt)); });
  if (waitingUntil) element('wait-time').textContent = `${Math.max(0, Math.ceil((waitingUntil - Date.now()) / 1000))}s remaining`;
  controls();
}, 1000);
window.addEventListener('pagehide', () => {
  closed = true; clearInterval(tick); clearTimeout(waitTimer); clearTimeout(waitDeadline);
  candidates = []; messages = []; pending.clear(); port.disconnect();
});

icons();
void request('status').then((result) => {
  if (result.kind === 'status') {
    if (!result.configured) {
      element('configuration').hidden = false;
      if (result.setupMessage) element('configuration-detail').textContent = result.setupMessage;
      element('extension-id').textContent = result.extensionId;
    } else { showConnection(result.connected); if (result.connected) void scan(); }
  } else if (result.kind === 'error') { element('setup').hidden = false; handleError(result); }
});
