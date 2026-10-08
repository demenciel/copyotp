import { GmailClient, scanCutoff } from './gmail.ts';
import { AppError, GMAIL_SCOPE } from './types.ts';
import type { Request, Result } from './types.ts';
import { WebAuth } from './web-auth.ts';
import { webClientId } from './oauth-config.js';

const webAuth = new WebAuth(webClientId);

let authRevision = 0;
let retryAt = 0;
const scans = new Set<AbortController>();

const configured = (browser?: Request['browser']) => browser === 'brave' ? webAuth.configured() : Boolean(chrome.runtime.getManifest().oauth2?.client_id);
const connected = async () => Boolean((await chrome.storage.local.get('connected')).connected);

async function token(interactive = false, browser?: Request['browser']): Promise<string> {
  if (browser === 'brave') return webAuth.token(interactive);
  if (!configured()) throw new AppError('setup', 'Add a Chrome Extension OAuth client ID to finish setup.');
  try {
    const options = { interactive, scopes: [GMAIL_SCOPE], enableGranularPermissions: true };
    const result = await chrome.identity.getAuthToken(options);
    if (!result.token || (result.grantedScopes && !result.grantedScopes.includes(GMAIL_SCOPE))) {
      throw new AppError('auth', 'Allow Gmail read-only access to connect.');
    }
    return result.token;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('auth', interactive ? 'Connection was not completed. Try connecting again.' : 'Connect Gmail again to continue.');
  }
}

const invalidate = (value: string, browser?: Request['browser']) => browser === 'brave'
  ? webAuth.invalidate(value) : chrome.identity.removeCachedAuthToken({ token: value });

function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== 'object') return false;
  const request = value as Request;
  return Number.isSafeInteger(request.id) && request.id > 0 &&
    ['status', 'connect', 'scan', 'disconnect', 'cancel'].includes(request.action) &&
    (request.browser === undefined || ['chrome', 'brave'].includes(request.browser)) &&
    (request.pageToken === undefined || (typeof request.pageToken === 'string' && request.pageToken.length < 2048)) &&
    (request.scanId === undefined || typeof request.scanId === 'string');
}

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.session?.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'copyotp' || port.sender?.id !== chrome.runtime.id ||
    port.sender?.url !== chrome.runtime.getURL('popup.html')) {
    port.disconnect();
    return;
  }
  let closed = false;
  let controller: AbortController | undefined;
  let lastScan: { id: string; cutoff: number; nextPageToken?: string } | undefined;
  let email = '';
  const cancel = () => { controller?.abort(); lastScan = undefined; };
  port.onDisconnect.addListener(() => { closed = true; cancel(); email = ''; });

  async function handle(request: Request): Promise<Result> {
    switch (request.action) {
      case 'status':
        return { kind: 'status', configured: configured(request.browser), connected: await connected(), extensionId: chrome.runtime.id,
          ...(request.browser === 'brave' ? { setupMessage: 'Configure a Web Application OAuth client with the Brave redirect URL in the project README.' } : {}) };
      case 'connect': {
        const revision = authRevision;
        const value = await token(true, request.browser);
        // OAuth can finish after its initiating popup closes. A newer disconnect
        // takes precedence over the consent and Brave's in-memory session token.
        if (revision !== authRevision) {
          // WebAuth's generation check already prevents obsolete session writes.
          if (request.browser !== 'brave') await invalidate(value, request.browser);
          return { kind: 'disconnected' };
        }
        await chrome.storage.local.set({ connected: true });
        email = '';
        return { kind: 'connected' };
      }
      case 'disconnect':
        authRevision++;
        for (const scan of scans) scan.abort();
        cancel();
        email = '';
        await chrome.storage.local.set({ connected: false });
        await webAuth.clear();
        if (request.browser !== 'brave') await chrome.identity.clearAllCachedAuthTokens();
        return { kind: 'disconnected' };
      case 'cancel':
        cancel();
        return { kind: 'cancelled' };
      case 'scan': {
        if (!await connected()) throw new AppError('auth', 'Connect Gmail to check for a code.');
        if (retryAt > Date.now()) throw new AppError('rate-limit', 'Gmail is limiting requests. Please wait before refreshing.', retryAt);
        let cutoff = scanCutoff();
        let id: string = crypto.randomUUID();
        if (request.pageToken) {
          if (!lastScan || lastScan.id !== request.scanId || lastScan.nextPageToken !== request.pageToken) {
            throw new AppError('api', 'This scan has ended. Refresh to start again.');
          }
          cutoff = lastScan.cutoff;
          id = lastScan.id;
        }
        controller?.abort();
        const scan = new AbortController();
        controller = scan;
        scans.add(scan);
        const signal = AbortSignal.any([scan.signal, AbortSignal.timeout(25_000)]);
        const gmail = new GmailClient(() => token(false, request.browser), (value) => invalidate(value, request.browser));
        try {
          if (!email) email = (await gmail.profile(signal)).emailAddress;
          const result = await gmail.scan(signal, cutoff, request.pageToken);
          signal.throwIfAborted();
          lastScan = { id, cutoff, nextPageToken: result.nextPageToken };
          return { kind: 'scan', ...result, email, scannedAt: Date.now(), scanId: id };
        } finally {
          scan.abort();
          scans.delete(scan);
          if (controller === scan) controller = undefined;
        }
      }
    }
  }

  port.onMessage.addListener((request: unknown) => {
    if (!isRequest(request)) return;
    const requestAuthRevision = authRevision;
    void handle(request).catch(async (error: unknown): Promise<Result> => {
      const known = error instanceof AppError ? error : new AppError('api', 'The request could not finish. Please try again.');
      if (known.code === 'rate-limit') retryAt = known.retryAt || Date.now() + 30_000;
      if (known.code === 'auth' && requestAuthRevision === authRevision) await chrome.storage.local.set({ connected: false });
      if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancelled' };
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { kind: 'error', code: 'offline', message: 'The scan timed out. Please try again.' };
      }
      return { kind: 'error', code: known.code, message: known.message, retryAt: known.retryAt };
    }).then((result) => {
      if (!closed) port.postMessage({ id: request.id, result });
    }).catch(() => {
      if (!closed) port.postMessage({ id: request.id, result: { kind: 'error', code: 'api', message: 'Please reopen CopyOTP and try again.' } });
    });
  });
});
