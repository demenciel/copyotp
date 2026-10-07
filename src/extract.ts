import { FRESHNESS_MS } from './types.ts';
import type { Candidate, NormalizedMessage } from './types.ts';

const codeLanguage = /(?:verification|security|authentication|confirmation|login|log[ -]?in|sign[ -]?in|one[ -]?time|access)\s+(?:pass)?code|(?:your|use|enter)\s+(?:the\s+)?(?:following\s+)?(?:verification\s+)?code|\bOTP\b|one[ -]?time\s+password/gi;
const unrelatedNumber = /(?:order|invoice|tracking|reference|ticket|account|phone|telephone|zip|postal|price|total|amount)\s*(?:number|id|no\.?|#)?\s*[:#=-]?\s*$/i;

export function extractCandidates(message: NormalizedMessage, now = Date.now()): Candidate[] {
  if (!Number.isFinite(message.receivedAt) || now - message.receivedAt > FRESHNESS_MS || message.receivedAt > now + 60_000) return [];
  const text = `${message.subject}\n${message.text}`;
  const cues = [...text.matchAll(codeLanguage)].map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
  if (!cues.length) return [];
  const found = new Map<string, Candidate>();
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])\d{4,8}(?![\p{L}\p{N}])/gu)) {
    const index = match.index!;
    const before = text.slice(Math.max(0, index - 55), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 25);
    if (unrelatedNumber.test(before) || /[$\u20ac\u00a3]\s*$/.test(before)) continue;
    if (/\d[\s().+/-]*$/.test(before) || /^[\s().+/-]*\d/.test(after)) continue;
    let distance = Infinity;
    for (const cue of cues) distance = Math.min(distance, Math.max(cue.start - (index + match[0].length), index - cue.end, 0));
    if (distance > 80) continue;
    const score = 100 - distance + (match[0].length === 6 ? 10 : 0);
    const candidate = { id: `${message.id}:${match[0]}`, code: match[0], subject: message.subject,
      sender: message.sender, receivedAt: message.receivedAt, score };
    if (!found.has(candidate.code) || found.get(candidate.code)!.score < score) found.set(candidate.code, candidate);
  }
  return [...found.values()];
}

export function rankCandidates(messages: NormalizedMessage[], now = Date.now()): Candidate[] {
  return messages.flatMap((message) => extractCandidates(message, now))
    .sort((a, b) => b.receivedAt - a.receivedAt || b.score - a.score);
}
