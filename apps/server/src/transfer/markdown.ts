import type { ConversationSummary, MessagePublic, Source } from '@neotext/shared';

export const UNTITLED = 'Untitled chat';
const NAME_MAX = 80;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const escapeLinkText = (s: string) => s.replace(/[\\[\]]/g, (c) => `\\${c}`);
const escapeLinkUrl = (s: string) => s.replace(/[\s()<>]/g, (c) => encodeURIComponent(c));

function sourcesBlock(sources: Source[]): string {
  const lines = sources.map(
    (s) => `${s.n}. [${escapeLinkText(s.title || s.url)}](${escapeLinkUrl(s.url)})`,
  );
  return `Sources:\n\n${lines.join('\n')}`;
}

/** One message's visible text: text parts, then its sources. Reasoning and tool calls stay out. */
function body(m: MessagePublic): string {
  const blocks: string[] = [];
  const text = m.parts
    .flatMap((p) => (p.type === 'text' && p.text.trim() !== '' ? [p.text.trim()] : []))
    .join('\n\n');
  if (text) blocks.push(text);
  const sources = m.parts.flatMap((p) => (p.type === 'sources' ? p.sources : []));
  if (sources.length > 0) blocks.push(sourcesBlock(sources));
  return blocks.join('\n\n');
}

/** The chat along `path` (root to leaf) as Markdown, one `##` heading per turn. */
export function conversationToMarkdown(c: ConversationSummary, path: MessagePublic[]): string {
  const sections = [`# ${c.title?.trim() || UNTITLED}`];
  for (const m of path) {
    const who = m.role === 'user' ? 'You' : (m.model?.modelId ?? 'Assistant');
    const text = body(m);
    sections.push(text ? `## ${who}\n\n${text}` : `## ${who}`);
  }
  return `${sections.join('\n\n')}\n`;
}

/**
 * A title made safe as a file name on every common OS, without the extension: no path or
 * reserved characters, no control or bidi characters, no leading dots, at most 80 characters.
 */
export function safeFileName(title: string | null): string {
  const cleaned = (title ?? '')
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, '')
    .replace(/^[\s.]+/, '');
  let name = [...cleaned]
    .slice(0, NAME_MAX)
    .join('')
    .replace(/[\s.]+$/, '');
  if (name === '') return UNTITLED;
  if (WINDOWS_RESERVED.test(name)) name = `${name}_`;
  return name;
}

/** Appends `ext` and numbers repeats (`name (2).md`), comparing without case. */
export function uniqueFileNames(names: string[], ext: string): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = `${name}${ext}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
