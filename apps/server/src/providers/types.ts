import type {
  ModelInfo,
  ProviderKind,
  ProviderTestResult,
  ReasoningEffort,
  FinishReason as SharedFinishReason,
} from '@neotext/shared';
import type { HttpClient } from '../net/http-client';
import type { ProviderError } from './errors';

export interface ResolvedProvider {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string | null;
  headers: Record<string, string>;
  manualModels: string[];
  http: HttpClient;
  appUrl: string;
  /**
   * A member using a shared provider: errors reach them as a fixed text per code, never the
   * upstream message, which may name an internal host. The real message goes to the log.
   */
  redactErrors?: boolean;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string }
  | { type: 'file'; filename: string; dataUrl: string };

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface FunctionToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: ToolCallRequest[];
      reasoningDetails?: unknown[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

export type ServerToolSpec =
  | { type: 'openrouter:web_search'; parameters: Record<string, unknown> }
  | { type: 'openrouter:web_fetch'; parameters?: Record<string, unknown> }
  | { type: 'openrouter:datetime' };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: FunctionToolDef[];
  /** Makes the model call a tool (any, or the one named); sent only with `tools`. */
  toolChoice?: 'required' | { name: string };
  serverTools?: ServerToolSpec[];
  maxServerToolCalls?: number;
  reasoning?: { effort?: ReasoningEffort; maxTokens?: number; exclude?: boolean };
  temperature?: number;
  maxTokens?: number;
  endUserId?: string;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  costUsd: number | null;
  webSearchRequests: number;
}

export type FinishReason = SharedFinishReason;

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'reasoning_details'; details: unknown[] }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; args: string }
  | { type: 'citation'; url: string; title: string; content: string }
  | { type: 'processing' }
  | { type: 'meta'; upstreamProvider?: string; generationRef?: string }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'error'; error: ProviderError };

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  listModels(p: ResolvedProvider, signal?: AbortSignal): Promise<ModelInfo[]>;
  streamChat(
    p: ResolvedProvider,
    req: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderEvent>;
  test(p: ResolvedProvider, signal?: AbortSignal): Promise<ProviderTestResult>;
  warm(p: ResolvedProvider): Promise<void>;
}
