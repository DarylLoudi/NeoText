import { type ModelInfo, ReasoningEffortSchema } from '@neotext/shared';

const DESCRIPTION_MAX = 300;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** USD per token (string) to USD per million tokens; null for missing, negative or invalid. */
function perMillion(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const perToken = Number(v);
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  // Six significant digits removes float noise: 0.000000045 * 1e6 is 0.04499999999999999.
  return Number((perToken * 1_000_000).toPrecision(6));
}

function mapReasoning(raw: unknown): ModelInfo['reasoning'] {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const efforts = strings(r.supported_efforts).flatMap((e) => {
    const parsed = ReasoningEffortSchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
  const def = ReasoningEffortSchema.safeParse(r.default_effort);
  return {
    mandatory: r.mandatory === true,
    efforts,
    defaultEffort: def.success ? def.data : null,
  };
}

/** Maps one `/models` catalog entry; returns null when it is unusable. */
export function mapOpenRouterModel(raw: unknown, providerId: string): ModelInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (id === null || id === '') return null;

  const pricing = (m.pricing ?? null) as Record<string, unknown> | null;
  const promptPerM = perMillion(pricing?.prompt);
  const completionPerM = perMillion(pricing?.completion);
  if (promptPerM === null || completionPerM === null) return null;

  const params = Array.isArray(m.supported_parameters) ? strings(m.supported_parameters) : null;
  const has = (name: string) => (params === null ? null : params.includes(name));
  const tools = has('tools');
  const arch = (m.architecture ?? {}) as Record<string, unknown>;
  const top = (m.top_provider ?? {}) as Record<string, unknown>;
  const description = str(m.description);
  const created = num(m.created);

  return {
    id,
    providerId,
    name: str(m.name) || id,
    description: description === null ? null : description.slice(0, DESCRIPTION_MAX),
    contextLength: num(m.context_length),
    maxOutputTokens: num(top.max_completion_tokens),
    inputModalities: strings(arch.input_modalities),
    outputModalities: strings(arch.output_modalities),
    pricing: { promptPerM, completionPerM, cacheReadPerM: perMillion(pricing?.input_cache_read) },
    supports: {
      tools,
      reasoning: has('reasoning'),
      structuredOutputs: has('structured_outputs'),
      webSearch: tools === true,
    },
    reasoning: mapReasoning(m.reasoning),
    knowledgeCutoff: str(m.knowledge_cutoff),
    expiresAt: str(m.expiration_date),
    createdAt: created === null ? null : created * 1000,
  };
}
