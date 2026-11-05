import type { MessagePublic } from '@neotext/shared';
import { expect, test } from 'vitest';
import type { BundleV1 } from '../bundle';
import { readNeoText } from './neotext';

const bundle = (messages: MessagePublic[]): BundleV1 => ({
  version: 1,
  exportedAt: 0,
  app: 'NeoText test',
  settings: {},
  folders: [],
  conversations: [
    {
      id: 'cnv_1',
      title: 'Lebar',
      titleSource: 'user',
      folderId: null,
      pinned: false,
      pinPosition: null,
      archived: false,
      presetId: null,
      modelRef: null,
      activeLeafId: null,
      messageCount: messages.length,
      createdAt: 0,
      updatedAt: 0,
      lastActivityAt: 0,
      deletedAt: null,
    },
  ],
  messages,
  presets: [],
});

const msg = (id: string, parentId: string | null): MessagePublic => ({
  id,
  conversationId: 'cnv_1',
  parentId,
  role: parentId === null ? 'user' : 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'x' }],
  model: null,
  usage: null,
  finishReason: null,
  createdAt: 0,
  updatedAt: 0,
});

test('a very wide message tree is checked without overflowing the stack', () => {
  const width = 200_000;
  const messages = [msg('root', null)];
  for (let i = 0; i < width; i++) messages.push(msg(`m${i}`, 'root'));
  const [c] = readNeoText(bundle(messages)).conversations;
  expect(c?.ok).toBe(true);
});

test('files that do not name a settings version are read as version 1', () => {
  expect(readNeoText(bundle([msg('root', null)])).settingsSchemaVersion).toBe(1);
  const named = { ...bundle([msg('root', null)]), settingsSchemaVersion: 3 };
  expect(readNeoText(named).settingsSchemaVersion).toBe(3);
});
