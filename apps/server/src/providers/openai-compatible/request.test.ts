import { describe, expect, test } from 'vitest';
import type { ChatRequest } from '../types';
import { toRequestBody } from './request';

const details = [{ type: 'reasoning.text', text: 'hmm', format: 'unknown', index: 0 }];
const req: ChatRequest = {
  model: 'm',
  messages: [
    { role: 'system', content: 'be nice' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', dataUrl: 'data:image/png;base64,AA==' },
        { type: 'file', filename: 'a.pdf', dataUrl: 'data:application/pdf;base64,BB==' },
      ],
    },
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'get_weather', arguments: '{"city":"Jakarta"}' }],
      reasoningDetails: details,
    },
    { role: 'tool', toolCallId: 'c1', content: '31C' },
  ],
  tools: [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object' } }],
  serverTools: [
    { type: 'openrouter:web_search', parameters: { max_results: 5 } },
    { type: 'openrouter:datetime' },
  ],
  maxServerToolCalls: 3,
  reasoning: { effort: 'low', exclude: true },
  temperature: 0.5,
  maxTokens: 100,
  endUserId: 'u1',
};

describe('toRequestBody', () => {
  test('openai dialect', () => {
    const body = toRequestBody(req, 'openai');
    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'low',
      max_tokens: 100,
      temperature: 0.5,
    });
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('user');
    expect(body).not.toHaveProperty('max_tool_calls');
    const messages = body.messages as Record<string, unknown>[];
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Jakarta"}' },
        },
      ],
    });
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '31C' });
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
        {
          type: 'file',
          file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,BB==' },
        },
      ],
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object' } },
      },
    ]);
  });

  test('openrouter dialect keeps server tools and reasoning details', () => {
    const body = toRequestBody(req, 'openrouter');
    expect(body).toMatchObject({
      stream: true,
      max_tool_calls: 3,
      reasoning: { effort: 'low', exclude: true },
      user: 'u1',
    });
    expect(body).not.toHaveProperty('stream_options');
    expect(body).not.toHaveProperty('reasoning_effort');
    const tools = body.tools as unknown[];
    expect(tools).toHaveLength(3);
    expect(tools[1]).toBe(req.serverTools?.[0]);
    expect(tools[2]).toEqual({ type: 'openrouter:datetime' });
    const assistant = (body.messages as Record<string, unknown>[])[2];
    expect(assistant?.reasoning_details).toBe(details);
  });

  test('minimal request omits optional fields', () => {
    const body = toRequestBody(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      'openrouter',
    );
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
  });

  test('reasoning max_tokens is used when there is no effort', () => {
    const body = toRequestBody(
      { model: 'm', messages: [], reasoning: { maxTokens: 2000 } },
      'openrouter',
    );
    expect(body.reasoning).toEqual({ max_tokens: 2000 });
  });
});

describe('tool choice', () => {
  const base: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
  const tools = req.tools;

  test('is left out unless asked for, and needs tools', () => {
    expect(toRequestBody({ ...base, tools }, 'openrouter')).not.toHaveProperty('tool_choice');
    expect(toRequestBody({ ...base, toolChoice: 'required' }, 'openai')).not.toHaveProperty(
      'tool_choice',
    );
  });

  test('required, or one named function, in both dialects', () => {
    for (const dialect of ['openai', 'openrouter'] as const) {
      expect(toRequestBody({ ...base, tools, toolChoice: 'required' }, dialect).tool_choice).toBe(
        'required',
      );
      expect(
        toRequestBody({ ...base, tools, toolChoice: { name: 'get_weather' } }, dialect).tool_choice,
      ).toEqual({ type: 'function', function: { name: 'get_weather' } });
    }
  });
});
