import type { AgentPublic, MessagePublic } from '@neotext/shared';
import { expect, test } from 'vitest';
import { msg } from '../../../test/chat-fixtures';
import { agentFor } from './resend';

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
