import type { AgentPublic, MessagePublic } from '@neotext/shared';
import { expect, test } from 'vitest';
import { msg } from '../../../test/chat-fixtures';
import { agentFor, modelFor } from './resend';

const agent = (id: string, enabled: boolean) => ({ id, data: { enabled } }) as AgentPublic;

const messages: MessagePublic[] = [
  msg({ id: 'u1', role: 'user', parentId: null }),
  msg({
    id: 'a1',
    role: 'assistant',
    parentId: 'u1',
    parts: [{ type: 'agent', agentId: 'agt_1', name: 'A' }],
  }),
];

test('agentFor keeps the agent only while it exists and is enabled', () => {
  expect(agentFor(messages, 'u1', [agent('agt_1', true)])).toBe('agt_1');
  expect(agentFor(messages, 'u1', [agent('agt_1', false)])).toBeNull();
  expect(agentFor(messages, 'u1', [agent('agt_2', true)])).toBeNull();
  expect(agentFor(messages, 'u1', undefined)).toBeNull();
});

// Two versions of one turn: a1 by alpha (with an agent), a2 by beta, written after it.
const versions: MessagePublic[] = [
  msg({ id: 'u1', role: 'user', parentId: null }),
  msg({
    id: 'a1',
    parentId: 'u1',
    model: { providerId: 'p', modelId: 'mock/alpha' },
    parts: [{ type: 'agent', agentId: 'agt_1', name: 'A' }],
  }),
  msg({ id: 'a2', parentId: 'u1', createdAt: 2, model: { providerId: 'p', modelId: 'mock/beta' } }),
];

test('a new answer reuses the model and agent of the version on screen, not the newest', () => {
  expect(modelFor(versions, 'u1', 'a1')?.modelId).toBe('mock/alpha');
  expect(agentFor(versions, 'u1', [agent('agt_1', true)], 'a1')).toBe('agt_1');
  expect(modelFor(versions, 'u1', 'a2')?.modelId).toBe('mock/beta');
  expect(agentFor(versions, 'u1', [agent('agt_1', true)], 'a2')).toBeNull();
  // No saved leaf: the chat shows its newest branch.
  expect(modelFor(versions, 'u1', null)?.modelId).toBe('mock/beta');
});
