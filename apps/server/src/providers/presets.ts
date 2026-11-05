import type { ProviderPreset } from '@neotext/shared';
import { BRAVE_BASE_URL, TAVILY_BASE_URL } from '../search/backends/urls';
import { OPENROUTER_BASE_URL } from './openrouter/adapter';

const compat = (id: string, name: string, baseUrl: string, keyRequired = true): ProviderPreset => ({
  id,
  name,
  kind: 'openai-compatible',
  baseUrl,
  keyRequired,
});

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    keyRequired: true,
  },
  compat('openai', 'OpenAI', 'https://api.openai.com/v1'),
  compat('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'),
  compat('groq', 'Groq', 'https://api.groq.com/openai/v1'),
  compat('mistral', 'Mistral', 'https://api.mistral.ai/v1'),
  compat('together', 'Together AI', 'https://api.together.xyz/v1'),
  compat('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  compat('anthropic', 'Anthropic', 'https://api.anthropic.com/v1'),
  compat('ollama', 'Ollama', 'http://localhost:11434/v1', false),
  compat('lmstudio', 'LM Studio', 'http://localhost:1234/v1', false),
  compat('custom', 'Custom endpoint', '', false),
  { id: 'searxng', name: 'SearXNG', kind: 'searxng', baseUrl: '', keyRequired: false },
  { id: 'brave', name: 'Brave Search', kind: 'brave', baseUrl: BRAVE_BASE_URL, keyRequired: true },
  { id: 'tavily', name: 'Tavily', kind: 'tavily', baseUrl: TAVILY_BASE_URL, keyRequired: true },
];
