import { AppError, FRESHNESS_MS } from './types.ts';
import type { GmailMessage } from './types.ts';

export class GmailClient {
  private getToken: () => Promise<string>;
  private clearToken: (token: string) => Promise<void>;
  private fetcher: typeof fetch;
  constructor(getToken: () => Promise<string>, clearToken: (token: string) => Promise<void>, fetcher: typeof fetch = fetch) {
    this.getToken = getToken;
    this.clearToken = clearToken;
    this.fetcher = fetcher.bind(globalThis);
  }

  async request<T>(path: string, signal: AbortSignal, retried = false): Promise<T> {
    signal.throwIfAborted();
    const token = await this.getToken();
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch {
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw new AppError('cancelled', 'Scan cancelled.');
      throw new AppError('offline', 'Could not reach Gmail. Check your connection and try again.');
    }
    if (response.status === 401 && !retried) {
      await this.clearToken(token);
      return this.request<T>(path, signal, true);
    }
    if (response.status === 401) throw new AppError('auth', 'Gmail access has expired. Connect again.');
    if (response.status === 429 || response.status === 403) {
      const detail = await response.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } };
      const limited = response.status === 429 || detail.error?.errors?.some((item) => /rateLimit|quota/i.test(item.reason || ''));
      if (limited) {
        const retry = response.headers.get('Retry-After');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 30;
        const date = retry ? Date.parse(retry) : NaN;
        throw new AppError('rate-limit', 'Gmail is limiting requests. Please wait before refreshing.',
          Number.isFinite(date) && !/^\d+$/.test(retry!) ? Math.max(Date.now() + 5000, date) : Date.now() + Math.max(5, seconds) * 1000);
      }
      throw new AppError('api', 'Gmail access was denied. Check the read-only grant and that the Gmail API is enabled.');
    }
    if (!response.ok) throw new AppError('api', 'Gmail could not complete the request. Try again shortly.');
    return response.json() as Promise<T>;
  }

  async scan(signal: AbortSignal, cutoff: number, pageToken?: string) {
    const query = new URLSearchParams({ q: `after:${Math.floor(cutoff / 1000)} -in:spam -in:trash`, maxResults: '20' });
    if (pageToken) query.set('pageToken', pageToken);
    const list = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(`messages?${query}`, signal);
    const messages: GmailMessage[] = [];
    const ids = list.messages || [];
    let index = 0;
    // Bound concurrency and the entire scan, not just each individual request.
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (index < ids.length) {
        const id = ids[index++].id;
        const message = await this.request<GmailMessage>(`messages/${encodeURIComponent(id)}?format=full`, signal);
        if (Number(message.internalDate) >= cutoff) messages.push(message);
      }
    }));
    return { messages, nextPageToken: list.nextPageToken };
  }

  async profile(signal: AbortSignal) {
    return this.request<{ emailAddress: string }>('profile', signal);
  }
}

export function scanCutoff(now = Date.now()) { return now - FRESHNESS_MS; }
