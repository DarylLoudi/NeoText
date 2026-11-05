import { createHash } from 'node:crypto';

const MAX_NAME = 64;
const HASH_CHARS = 4;

/** Characters outside `[a-zA-Z0-9_-]` become `_`; two servers may not share the result. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * The tool's own name as shown to the user: the same characters and limit as `mcpToolName`, since
 * a remote server chooses it and could otherwise put a long sentence in an approval prompt.
 */
export function mcpToolLabel(toolName: string): string {
  const name = safeName(toolName);
  if (name.length <= MAX_NAME) return name;
  const hash = createHash('sha256').update(toolName).digest('hex').slice(0, HASH_CHARS);
  return `${name.slice(0, MAX_NAME - HASH_CHARS - 1)}_${hash}`;
}

/**
 * The name the model sees for an MCP tool: `mcp_<server>_<tool>`, with characters outside
 * `[a-zA-Z0-9_-]` replaced by `_`. Names over 64 characters are cut and end in `_` plus a
 * short hash of the full original pair, so tools that differ only past the cut stay distinct.
 */
export function mcpToolName(serverName: string, toolName: string): string {
  const name = safeName(`mcp_${serverName}_${toolName}`);
  if (name.length <= MAX_NAME) return name;
  const hash = createHash('sha256')
    .update(`${serverName}\u0000${toolName}`)
    .digest('hex')
    .slice(0, HASH_CHARS);
  return `${name.slice(0, MAX_NAME - HASH_CHARS - 1)}_${hash}`;
}
