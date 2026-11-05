import type { ToolCallPart, ToolInfo } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { toolsApi } from '../../../lib/api/tools';
import { translate } from '../../../lib/i18n';
import { qk } from '../../../lib/query';

/** The app's own tools, which have names in every language; other tools show their own name. */
export const APP_TOOLS = ['fetch_url', 'web_search', 'delegate_tasks', 'search_knowledge'] as const;
type AppTool = (typeof APP_TOOLS)[number];

const isAppTool = (name: string): name is AppTool =>
  (APP_TOOLS as readonly string[]).includes(name);

/** A decided call's arguments are cut past this length, like stored results. */
export const ARGS_SHOWN_MAX = 4000;

/**
 * Characters that change how text reads without being seen: controls other than newline and
 * tab, format and bidi characters, line separators, default-ignorable characters such as
 * zero-width spaces and tag characters, and lone surrogates.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

function escaped(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const hex = code.toString(16).toUpperCase();
  return code > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
}

/**
 * For display only: every unseen character becomes a visible escape such as `\u202E`, so a tool
 * name or argument cannot read differently from what will actually run or be sent.
 */
export function visibleText(text: string): string {
  return text.replace(UNSEEN, (ch) => (ch === '\n' || ch === '\t' ? ch : escaped(ch)));
}

/** Spaces other than the plain one, and the blank braille cell: they can pass for a gap. */
const LOOKALIKE_SPACE = /[\p{Zs}\u2800]/gu;
/** Names are short by design (the server keeps them to this); anything longer is cut here too. */
const NAME_MAX = 64;

/** A name as one bounded token. Arguments keep their whitespace; a name has no use for it. */
function visibleName(text: string): string {
  const cut = text.length > NAME_MAX ? `${text.slice(0, NAME_MAX)}\u2026` : text;
  return visibleText(cut).replace(LOOKALIKE_SPACE, (ch) => (ch === ' ' ? ch : escaped(ch)));
}

/**
 * What the tool is called: "Web page reader", an MCP tool after the server the user named
 * ("Filesystem: read_file"), or the full raw name when nothing else is known. An MCP tool never
 * loses its source, so a server named `web` with a tool `search` cannot read as the built-in
 * web search.
 */
export function toolName(name: string, mcp?: ToolInfo['mcp']): string {
  if (mcp) {
    return translate('chat.tools.mcpName', {
      tool: visibleName(mcp.tool),
      server: visibleName(mcp.server),
    });
  }
  return isAppTool(name) ? translate(`chat.tools.names.${name}`) : visibleName(name);
}

/** How long the tools list stays fresh: listing it can connect to tool servers. */
export const TOOLS_STALE_MS = 60_000;

/** The name of a call. An MCP call looks up its server in the tools list. */
export function useCallName(call: Pick<ToolCallPart, 'name' | 'source'>): string {
  const isMcp = call.source === 'mcp';
  const tools = useQuery({
    queryKey: qk.tools,
    queryFn: toolsApi.list,
    enabled: isMcp,
    staleTime: TOOLS_STALE_MS,
  });
  const mcp = isMcp ? tools.data?.tools.find((t) => t.name === call.name)?.mcp : undefined;
  return toolName(call.name, mcp);
}

/** One plain line about a call: "Read a web page" when done, "Reading a web page" while it runs. */
export function callLabel(rawName: string, shownName: string, running: boolean): string {
  const tense = running ? 'running' : 'done';
  if (isAppTool(rawName)) return translate(`chat.tools.labels.${rawName}.${tense}`);
  return translate(`chat.tools.labels.other.${tense}`, { tool: shownName });
}

/** The arguments as indented JSON, or as they came when they are not JSON. */
function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

export interface ShownArgs {
  text: string;
  /** More arguments exist than `text` shows. */
  truncated: boolean;
}

/** The arguments as they appear on screen: readable, capped at `max`, with nothing unseen. */
export function shownArgs(args: string, max: number = ARGS_SHOWN_MAX): ShownArgs {
  const pretty = prettyArgs(args);
  return { text: visibleText(pretty.slice(0, max)), truncated: pretty.length > max };
}

/** A short hint of what the call was about: the page's host, or the search words. */
export function callDetail(name: string, args: string): string | null {
  if (name !== 'web_search' && name !== 'fetch_url' && name !== 'search_knowledge') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = (parsed as Record<string, unknown>)[name === 'fetch_url' ? 'url' : 'query'];
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (name !== 'fetch_url') return visibleText(value.trim().slice(0, 120));
  try {
    return visibleText(new URL(value).hostname.replace(/^www\./, ''));
  } catch {
    return null;
  }
}
