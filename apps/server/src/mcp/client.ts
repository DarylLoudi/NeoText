import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  JsonSchemaValidator,
  jsonSchemaValidator,
} from '@modelcontextprotocol/sdk/validation/types.js';
import { TOOL_TIMEOUT_MS } from '../chat/generation/tool-loop';
import type { HttpClient } from '../net/http-client';
import type { ToolResult } from '../tools/types';

/** How long connecting and listing tools may take. */
export const MCP_REQUEST_TIMEOUT_MS = 10_000;
/** Largest single HTTP response read from an MCP server. */
export const MCP_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
/** Tools kept from one server, and pages of `tools/list` read to find them. */
export const MCP_MAX_TOOLS = 100;
const MAX_LIST_PAGES = 10;
export const MCP_DESCRIPTION_MAX = 1_000;
export const NON_TEXT_NOTE = '[non-text content omitted]';
const NO_ERROR_MESSAGE = 'The MCP tool reported an error without a message.';
const NOT_AN_OBJECT = 'The tool arguments must be a JSON object.';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnection {
  /** `signal` aborts the whole listing, every page included. */
  listTools(signal?: AbortSignal): Promise<McpToolInfo[]>;
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>;
  close(): Promise<void>;
}

/** Errors the response body once it passes `MCP_RESPONSE_MAX_BYTES`. */
function capBody(res: Response): Response {
  if (!res.body) return res;
  let size = 0;
  const capped = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MCP_RESPONSE_MAX_BYTES) {
          controller.error(new Error('The MCP server sent too much data.'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(capped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

const MAX_REDIRECTS = 5;

/**
 * Every request, redirects included, goes through the SSRF-guarded client. Redirects are
 * followed by hand and only within the server's origin: a cross-origin `Location` would carry
 * the user's custom headers (an API key, say) to another site, so it is refused.
 */
export function guardedFetch(http: HttpClient): FetchLike {
  return async (input, init) => {
    let url = typeof input === 'string' ? input : input.href;
    let request: RequestInit = { ...init, redirect: 'manual' };
    for (let hops = 0; ; hops++) {
      const res = await http.fetch(url, request);
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || location === null) return capBody(res);
      await res.body?.cancel().catch(() => {});
      if (hops >= MAX_REDIRECTS) throw new Error('The MCP server redirected too many times.');
      const next = new URL(location, url);
      if (next.origin !== new URL(url).origin) {
        throw new Error('The MCP server redirected to another site, which is not allowed.');
      }
      // As fetch does: 303, and 301 or 302 after a POST, go on as a GET without a body.
      const method = (request.method ?? 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        const { body: _body, ...rest } = request;
        request = { ...rest, method: 'GET' };
      }
      url = next.href;
    }
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Text blocks joined; anything else becomes a short note. `isError` becomes a failed result. */
export function toToolResult(result: unknown): ToolResult {
  if (!isRecord(result)) return { ok: false, error: "The MCP tool's answer was malformed." };
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .map((b) =>
      isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : NON_TEXT_NOTE,
    )
    .join('\n');
  if (result.isError === true)
    return { ok: false, error: text.trim() === '' ? NO_ERROR_MESSAGE : text };
  return { ok: true, content: text };
}

function toToolInfo(tool: {
  name: string;
  description?: string;
  inputSchema: object;
}): McpToolInfo {
  return {
    name: tool.name,
    description: (tool.description ?? '').slice(0, MCP_DESCRIPTION_MAX),
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}

/**
 * Server-supplied output schemas are never compiled or run: a hostile `pattern` could block
 * the event loop for hours, and only text content reaches the model anyway.
 */
const NO_SCHEMA_VALIDATION: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

/**
 * Opens a Streamable HTTP MCP session. `http` decides which networks are reachable; the
 * caller picks it by `endpointPolicy`. `signal` aborts a connect that hangs.
 */
export async function connectMcp(
  url: string,
  headers: Record<string, string>,
  http: HttpClient,
  opts: { signal?: AbortSignal } = {},
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: guardedFetch(http),
    requestInit: { headers },
  });
  const client = new Client(
    { name: 'neotext', version: '0.1.0' },
    { capabilities: {}, jsonSchemaValidator: NO_SCHEMA_VALIDATION },
  );
  // Errors also reject the request that hit them; the stream-level ones are not actionable.
  client.onerror = () => {};
  try {
    await client.connect(transport, { timeout: MCP_REQUEST_TIMEOUT_MS, signal: opts.signal });
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }

  return {
    async listTools(signal) {
      const tools: McpToolInfo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES && tools.length < MCP_MAX_TOOLS; page++) {
        const res = await client.listTools(cursor === undefined ? {} : { cursor }, {
          timeout: MCP_REQUEST_TIMEOUT_MS,
          signal,
        });
        tools.push(...res.tools.map(toToolInfo));
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return tools.slice(0, MCP_MAX_TOOLS);
    },

    async callTool(name, args, signal) {
      if (!isRecord(args)) return { ok: false, error: NOT_AN_OBJECT };
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: TOOL_TIMEOUT_MS,
      });
      return toToolResult(result);
    },

    close: () => client.close(),
  };
}
