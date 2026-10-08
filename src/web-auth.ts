import { AppError, GMAIL_SCOPE } from './types.ts';

const SESSION_KEY = 'webOAuth';
interface Credential { accessToken: string; expiresAt: number; clientId: string }

// Brave cannot reliably use Google's Chrome-profile getAuthToken flow. The
// identity API intercepts this HTTPS callback before any page can receive it.
export class WebAuth {
  private revision = 0;
  private pending: Promise<string> | undefined;
  private clientId: string;
  constructor(clientId: string) { this.clientId = clientId; }

  configured() { return Boolean(this.clientId); }

  async token(interactive = false): Promise<string> {
    if (!this.configured()) throw new AppError('setup', 'Add a Web Application OAuth client for Brave. See the project README.');
    if (!interactive) {
      const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Credential | undefined;
      if (stored?.clientId === this.clientId && typeof stored.accessToken === 'string' && stored.expiresAt > Date.now() + 30_000) {
        return stored.accessToken;
      }
      await chrome.storage.session.remove(SESSION_KEY);
      throw new AppError('auth', 'Your Brave Gmail session ended. Connect Gmail again.');
    }
    if (this.pending) return this.pending;
    const revision = this.revision;
    const pending = this.authorize(revision);
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }

  private async authorize(revision: number): Promise<string> {
    const redirect = chrome.identity.getRedirectURL();
    const state = crypto.randomUUID();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.clientId, redirect_uri: redirect, response_type: 'token',
      scope: GMAIL_SCOPE, state, prompt: 'select_account',
      // Do not fold other AlexWorks products' grants into CopyOTP's token.
      include_granted_scopes: 'false'
    }).toString();
    try {
      const response = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
      if (!response) throw new AppError('auth', 'Connection was not completed. Try connecting again.');
      const callback = new URL(response);
      const expected = new URL(redirect);
      const params = new URLSearchParams(callback.hash.slice(1));
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname ||
        callback.search || callback.username || callback.password ||
        params.getAll('state').length !== 1 || params.get('state') !== state) {
        throw new AppError('auth', 'Could not validate Google sign-in. Connect Gmail again.');
      }
      if (params.has('error')) throw new AppError('auth', 'Google access was not granted. Try connecting again.');
      const accessToken = params.get('access_token');
      const seconds = Number(params.get('expires_in'));
      if (!accessToken || params.getAll('access_token').length !== 1 ||
        ['expires_in', 'token_type', 'scope'].some((key) => params.getAll(key).length !== 1) ||
        params.get('token_type')?.toLowerCase() !== 'bearer' ||
        !Number.isInteger(seconds) || seconds <= 30 || seconds > 86_400 ||
        params.get('scope')?.trim() !== GMAIL_SCOPE) {
        throw new AppError('auth', 'Allow Gmail read-only access to connect.');
      }
      if (revision === this.revision) {
        await chrome.storage.session.set({ [SESSION_KEY]: {
          accessToken, expiresAt: Date.now() + seconds * 1000, clientId: this.clientId
        } });
      }
      return accessToken;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Never include a callback URL or provider error containing a token.
      throw new AppError('auth', 'Connection was not completed. Try connecting again.');
    }
  }

  async invalidate(value: string) {
    const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Credential | undefined;
    if (stored?.accessToken === value) await chrome.storage.session.remove(SESSION_KEY);
  }

  async clear() {
    this.revision++;
    this.pending = undefined;
    await chrome.storage.session.remove(SESSION_KEY);
  }
}
