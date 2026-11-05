import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { mapOpenRouterModel } from './models';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../test-support/fixtures/openrouter-models.json', import.meta.url),
    'utf8',
  ),
) as { data: Record<string, unknown>[] };
const entry = (i: number) => fixture.data[i] as Record<string, unknown>;

describe('mapOpenRouterModel', () => {
  test('maps pricing to per-million numbers and capabilities', () => {
    const m = mapOpenRouterModel(entry(0), 'prv_x');
    expect(m).toMatchObject({
      id: 'deepseek/deepseek-v4.1-flash',
      providerId: 'prv_x',
      contextLength: 1048576,
      maxOutputTokens: 65536,
      pricing: { promptPerM: 0.045, completionPerM: 0.5, cacheReadPerM: 0.01 },
      supports: { tools: true, reasoning: true, structuredOutputs: true, webSearch: true },
      reasoning: { mandatory: false, efforts: ['high', 'low'], defaultEffort: 'high' },
      createdAt: 1793000000000,
      knowledgeCutoff: '2026-03-01',
    });
  });

  test('reads modalities and leaves capabilities off when not advertised', () => {
    const m = mapOpenRouterModel(entry(1), 'p');
    expect(m?.inputModalities).toEqual(['text', 'image']);
    expect(m?.supports).toEqual({
      tools: false,
      reasoning: false,
      structuredOutputs: false,
      webSearch: false,
    });
    expect(m?.reasoning).toBeNull();
    expect(m?.pricing.cacheReadPerM).toBeNull();
  });

  test('free models cost zero', () => {
    const m = mapOpenRouterModel(entry(2), 'p');
    expect(m?.pricing.promptPerM).toBe(0);
    expect(m?.pricing.completionPerM).toBe(0);
    expect(m?.maxOutputTokens).toBeNull();
  });

  test('garbage entries are skipped', () => {
    expect(mapOpenRouterModel({ id: 42 }, 'p')).toBeNull();
    expect(mapOpenRouterModel(null, 'p')).toBeNull();
    expect(mapOpenRouterModel('x', 'p')).toBeNull();
  });

  test('negative or unparsable prices are skipped', () => {
    const bad = (pricing: unknown) => mapOpenRouterModel({ ...entry(0), pricing }, 'p');
    expect(bad({ prompt: '-1', completion: '-1' })).toBeNull();
    expect(bad({ prompt: 'abc', completion: '0.1' })).toBeNull();
    expect(bad(undefined)).toBeNull();
  });

  test('cuts long descriptions to 300 characters', () => {
    const m = mapOpenRouterModel({ ...entry(0), description: 'x'.repeat(500) }, 'p');
    expect(m?.description).toHaveLength(300);
  });

  test('drops unknown reasoning efforts', () => {
    const m = mapOpenRouterModel(
      { ...entry(0), reasoning: { mandatory: true, supported_efforts: ['low', 'bogus'] } },
      'p',
    );
    expect(m?.reasoning).toEqual({ mandatory: true, efforts: ['low'], defaultEffort: null });
  });
});
