import type { GmailMessage, MailPart, NormalizedMessage } from './types.ts';

export function decodeBody(data: string, contentType = ''): string {
  const bytes = Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

export function htmlToText(html: string): string {
  // A template is inert: images, frames and scripts cannot fetch or execute.
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,svg,blockquote,.gmail_quote').forEach((node) => node.remove());
  template.content.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  template.content.querySelectorAll('p,div,li,tr,h1,h2,h3,table').forEach((node) => node.append('\n'));
  return template.content.textContent || '';
}

export function stripQuotes(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:On .+wrote:|[-_]{2,}\s*(?:Original Message|Forwarded message)|Begin forwarded message:|From:.*@)/i.test(line)) break;
    if (!/^\s*>/.test(line)) kept.push(line);
  }
  return kept.join('\n');
}

export function normalizeMessage(message: GmailMessage, convertHtml = htmlToText): NormalizedMessage {
  const headers = message.payload?.headers || [];
  const header = (name: string) => headers.find((item) => item.name.toLowerCase() === name)?.value || '';
  const plain: string[] = [];
  const html: string[] = [];
  function visit(part: MailPart) {
    if (part.filename || part.mimeType === 'message/rfc822') return;
    const contentType = part.headers?.find((item) => item.name.toLowerCase() === 'content-type')?.value;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plain.push(decodeBody(part.body.data, contentType));
      if (part.mimeType === 'text/html') html.push(decodeBody(part.body.data, contentType));
    }
    part.parts?.forEach(visit);
  }
  if (message.payload) visit(message.payload);
  return {
    id: message.id,
    subject: header('subject'),
    sender: header('from'),
    receivedAt: Number(message.internalDate),
    text: stripQuotes(plain.some((text) => text.trim()) ? plain.join('\n') : html.map(convertHtml).join('\n'))
  };
}
