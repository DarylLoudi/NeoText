import type { ToolPolicy as SharedToolPolicy, SubagentRun } from '@neotext/shared';
import type { Logger } from '../lib/logger';
import type { Semaphore } from '../lib/semaphore';
import type { HttpClient } from '../net/http-client';
import type { FunctionToolDef } from '../providers/types';

export type ToolPolicy = SharedToolPolicy;

export interface ToolContext {
  userId: string;
  timeZone: string;
  /** Aborts when the generation stops or the tool runs out of time. */
  signal: AbortSignal;
  http: HttpClient;
  log: Logger;
  /** Shared by one generation's `fetch_url` calls, so only a few pages load at once. */
  fetchSlots: Semaphore;
  /** Live sub-agent rows of this call (`delegate_tasks`); shown on the tool call part. */
  progress?: (agents: SubagentRun[]) => void;
}

export type ToolResult =
  | { ok: true; content: string; sources?: { url: string; title: string; content: string }[] }
  | { ok: false; error: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
  source: 'app' | 'mcp';
  /** For an MCP tool: which server it is from and its own name, shown to the user. */
  mcp?: { server: string; tool: string };
  defaultPolicy: ToolPolicy;
  timeoutMs?: number;
  /** Returns the result as untrusted text; may throw, which becomes an error result. */
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** The tools offered in one turn, with the user's policies applied. */
export interface ToolSet {
  defs: FunctionToolDef[];
  /** The tool, unless it is unknown or turned off. */
  get(name: string): ToolDefinition | undefined;
  policy(name: string): ToolPolicy;
}
