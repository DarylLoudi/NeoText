import type { ChatContentPart, ChatMessage, ChatRequest, ResolvedProvider } from '../types';

export type Dialect = 'openai' | 'openrouter';

function mapPart(part: ChatContentPart): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'image') return { type: 'image_url', image_url: { url: part.dataUrl } };
  return { type: 'file', file: { filename: part.filename, file_data: part.dataUrl } };
}

function mapMessage(m: ChatMessage, dialect: Dialect): Record<string, unknown> {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return {
        role: 'user',
        content: typeof m.content === 'string' ? m.content : m.content.map(mapPart),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    case 'assistant': {
      const out: Record<string, unknown> = { role: 'assistant', content: m.content };
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      if (dialect === 'openrouter' && m.reasoningDetails?.length) {
        out.reasoning_details = m.reasoningDetails;
      }
      return out;
    }
  }
}

/** Builds the streaming chat-completions request body for the given wire dialect. */
export function toRequestBody(req: ChatRequest, dialect: Dialect): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => mapMessage(m, dialect)),
    stream: true,
  };

  const tools: unknown[] = (req.tools ?? []).map((t) => ({ type: 'function', function: t }));
  const serverTools = dialect === 'openrouter' ? (req.serverTools ?? []) : [];
  tools.push(...serverTools);
  if (tools.length > 0) body.tools = tools;
  const choice = req.toolChoice;
  if (choice !== undefined && (req.tools?.length ?? 0) > 0) {
    body.tool_choice =
      choice === 'required' ? 'required' : { type: 'function', function: { name: choice.name } };
  }
  if (serverTools.length > 0 && req.maxServerToolCalls !== undefined) {
    body.max_tool_calls = req.maxServerToolCalls;
  }

  const r = req.reasoning;
  if (r) {
    if (dialect === 'openrouter') {
      const reasoning: Record<string, unknown> = {};
      if (r.effort !== undefined) reasoning.effort = r.effort;
      else if (r.maxTokens !== undefined) reasoning.max_tokens = r.maxTokens;
      if (r.exclude !== undefined) reasoning.exclude = r.exclude;
      if (Object.keys(reasoning).length > 0) body.reasoning = reasoning;
    } else if (r.effort !== undefined) {
      body.reasoning_effort = r.effort;
    }
  }

  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (dialect === 'openrouter' && req.endUserId !== undefined) body.user = req.endUserId;
  if (dialect === 'openai') body.stream_options = { include_usage: true };
  return body;
}

/** Authorization plus the provider's custom headers. */
export function providerHeaders(p: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {};
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  return { ...headers, ...p.headers };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}
