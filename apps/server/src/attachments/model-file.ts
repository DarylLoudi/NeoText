import { ATTACHMENT_TEXT_INLINE_MAX } from '@neotext/shared';

/** An attached file as one turn sends it; every target of the turn shares the same object. */
export interface LoadedAttachment {
  name: string;
  mime: string;
  /** Base64 data URL, built on first use only, then reused. */
  dataUrl(): string;
  /** For text files: at most `ATTACHMENT_TEXT_INLINE_MAX` UTF-16 units, never half a pair. */
  text(): { text: string; cut: boolean };
}

/** What a turn's lookup gives for an attachment id. */
export type AttachmentLookup = (id: string) => LoadedAttachment | 'over-budget' | null;

/** Each UTF-8 character is at most 4 bytes, so this many bytes always hold the capped text. */
export const TEXT_READ_BYTES = ATTACHMENT_TEXT_INLINE_MAX * 4;

/** Cuts at `max` units, stepping back over a high surrogate whose pair would be split. */
export function capText(full: string, max: number): { text: string; cut: boolean } {
  if (full.length <= max) return { text: full, cut: false };
  const code = full.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return { text: full.slice(0, end), cut: true };
}

export function toModelFile(name: string, mime: string, bytes: Buffer): LoadedAttachment {
  let url: string | null = null;
  let text: { text: string; cut: boolean } | null = null;
  return {
    name,
    mime,
    dataUrl: () => {
      url ??= `data:${mime};base64,${bytes.toString('base64')}`;
      return url;
    },
    text: () => {
      if (!text) {
        // Decoding only the head: a character cut at the byte edge lands past the cap.
        const head = bytes.subarray(0, TEXT_READ_BYTES).toString('utf8');
        const capped = capText(head, ATTACHMENT_TEXT_INLINE_MAX);
        text = { text: capped.text, cut: capped.cut || bytes.length > TEXT_READ_BYTES };
      }
      return text;
    },
  };
}
