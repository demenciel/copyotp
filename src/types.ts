export const FRESHNESS_MS = 5 * 60 * 1000;
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface MailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MailPart[];
}

export interface GmailMessage {
  id: string;
  internalDate: string;
  payload?: MailPart;
}

export interface NormalizedMessage {
  id: string;
  subject: string;
  sender: string;
  receivedAt: number;
  text: string;
}

export interface Candidate {
  id: string;
  code: string;
  subject: string;
  sender: string;
  receivedAt: number;
  score: number;
}

export type Action = 'status' | 'connect' | 'scan' | 'disconnect' | 'cancel';
export interface Request {
  id: number;
  action: Action;
  pageToken?: string;
  scanId?: string;
  browser?: 'chrome' | 'brave';
}

export type ErrorCode = 'setup' | 'auth' | 'offline' | 'rate-limit' | 'api' | 'cancelled';
export type Result =
  | { kind: 'status'; configured: boolean; connected: boolean; extensionId: string; setupMessage?: string }
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'cancelled' }
  | { kind: 'scan'; messages: GmailMessage[]; email: string; scannedAt: number; scanId: string; nextPageToken?: string }
  | { kind: 'error'; code: ErrorCode; message: string; retryAt?: number };
export interface Reply { id: number; result: Result }

export class AppError extends Error {
  code: ErrorCode;
  retryAt?: number;
  constructor(code: ErrorCode, message: string, retryAt?: number) {
    super(message);
    this.code = code;
    this.retryAt = retryAt;
  }
}
