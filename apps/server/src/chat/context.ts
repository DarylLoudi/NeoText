import { ATTACHMENT_TEXT_INLINE_MAX, attachmentKind, type MessagePublic } from '@neotext/shared';
import type { AttachmentLookup } from '../attachments/model-file';
import type { ChatContentPart, ChatMessage } from '../providers/types';
import { estimateMessageTokens } from './tokens';

export const DEFAULT_CONTEXT_TOKENS = 128_000;
export const DEFAULT_OUTPUT_TOKENS = 4_096;
export const CONTEXT_SAFETY_TOKENS = 1_024;

export function formatDateLine(now: number, timeZone: string): string {
  const date = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
  try {
    return `Current date: ${date(timeZone)} (${timeZone})`;
  } catch {
    return `Current date: ${date('UTC')} (UTC)`;
  }
}

export interface BuildContextInput {
  path: MessagePublic[];
  systemPrompt: string;
  includeDate: boolean;
  timeZone: string;
  now: number;
  contextLength: number | null;
  maxOutputTokens: number | null;
  strategy: 'trim-oldest' | 'none';
  /** The turn's preloaded files; without it attachments are left out of the request. */
  loadAttachment?: AttachmentLookup;
  /** What the model reads besides text; both default to true (an unknown model). */
  modelInput?: ModelInput;
}

export interface ModelInput {
  images: boolean;
  files: boolean;
}

/**
 * From the model's `inputModalities`. An unknown model (none cached, or an empty list from an
 * endpoint that does not say) is assumed to read both.
 */
export function modelInputFor(model: { inputModalities: string[] } | null): ModelInput {
  if (!model || model.inputModalities.length === 0) return { images: true, files: true };
  return {
    images: model.inputModalities.includes('image'),
    files: model.inputModalities.includes('file'),
  };
}

const notSent = (name: string) => `[Attachment "${name}" was not sent: this model can't read it.]`;

/** A fence longer than any backtick run inside, so file text cannot close it early. */
function fenced(name: string, text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${name}\n${text}\n${fence}`;
}

/** The user's text plus what each attachment becomes for this model. */
function userContent(
  m: MessagePublic,
  load: BuildContextInput['loadAttachment'],
  input: ModelInput,
): string | ChatContentPart[] {
  const texts = [textOf(m)];
  const media: ChatContentPart[] = [];
  for (const p of m.parts) {
    if (p.type !== 'attachment' || !load) continue;
    const file = load(p.attachmentId);
    if (file === 'over-budget') {
      texts.push(`[Attachment "${p.name}" was not sent: too much attached content in this chat.]`);
      continue;
    }
    if (!file) {
      texts.push(`[Attachment "${p.name}" is no longer available.]`);
      continue;
    }
    const kind = attachmentKind(file.mime);
    if (kind === 'image' && input.images) media.push({ type: 'image', dataUrl: file.dataUrl() });
    else if (kind === 'pdf' && input.files) {
      media.push({ type: 'file', filename: file.name, dataUrl: file.dataUrl() });
    } else if (kind === 'text') {
      const { text, cut } = file.text();
      texts.push(fenced(file.name, text));
      if (cut) {
        texts.push(
          `[Attachment "${file.name}" was cut to its first ${ATTACHMENT_TEXT_INLINE_MAX} characters.]`,
        );
      }
    } else texts.push(notSent(file.name));
  }
  const text = texts.filter((t) => t !== '').join('\n\n');
  return media.length === 0 ? text : [{ type: 'text', text }, ...media];
}

function textOf(m: MessagePublic): string {
  return m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n');
}

function toChatMessages(input: BuildContextInput): ChatMessage[] {
  const out: ChatMessage[] = [];
  const modelInput = input.modelInput ?? { images: true, files: true };
  for (const m of input.path) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContent(m, input.loadAttachment, modelInput) });
      continue;
    }
    const content = textOf(m);
    if (m.status !== 'error' && content !== '') out.push({ role: 'assistant', content });
  }
  return out;
}

function sum(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateMessageTokens(m), 0);
}

export function buildContext(input: BuildContextInput): {
  messages: ChatMessage[];
  trimmed: number;
  estimatedTokens: number;
} {
  const systemParts = [input.systemPrompt.trim()];
  if (input.includeDate) systemParts.push(formatDateLine(input.now, input.timeZone));
  const systemText = systemParts.filter((s) => s !== '').join('\n\n');
  const system: ChatMessage[] = systemText ? [{ role: 'system', content: systemText }] : [];

  let body = toChatMessages(input);
  let trimmed = 0;
  if (input.strategy === 'trim-oldest') {
    const budget =
      (input.contextLength ?? DEFAULT_CONTEXT_TOKENS) -
      (input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS) -
      CONTEXT_SAFETY_TOKENS;
    let total = sum(system) + sum(body);
    while (body.length > 1 && total > budget) {
      const [dropped, ...rest] = body;
      if (!dropped) break;
      total -= estimateMessageTokens(dropped);
      body = rest;
      trimmed += 1;
    }
    while (body.length > 1 && body[0]?.role === 'assistant') {
      body = body.slice(1);
      trimmed += 1;
    }
  }
  const messages = [...system, ...body];
  return { messages, trimmed, estimatedTokens: sum(messages) };
}
