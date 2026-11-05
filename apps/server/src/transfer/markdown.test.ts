import type { ConversationSummary, MessagePart, MessagePublic } from '@neotext/shared';
import { describe, expect, test } from 'vitest';
import { conversationToMarkdown, safeFileName, uniqueFileNames } from './markdown';

const convo = (title: string | null): ConversationSummary => ({
  id: 'cnv_1',
  title,
  titleSource: 'user',
  folderId: null,
  pinned: false,
  pinPosition: null,
  archived: false,
  presetId: null,
  modelRef: null,
  activeLeafId: 'msg_4',
  messageCount: 4,
  createdAt: 1,
  updatedAt: 1,
  lastActivityAt: 1,
  deletedAt: null,
});

let seq = 0;
const msg = (
  role: 'user' | 'assistant',
  parts: MessagePart[],
  modelId: string | null = null,
): MessagePublic => {
  seq++;
  return {
    id: `msg_${seq}`,
    conversationId: 'cnv_1',
    parentId: seq === 1 ? null : `msg_${seq - 1}`,
    role,
    status: 'complete',
    parts,
    model: modelId ? { providerId: 'prv_1', modelId } : null,
    usage: null,
    finishReason: null,
    createdAt: seq,
    updatedAt: seq,
  };
};

describe('markdown', () => {
  test('markdown layout', () => {
    seq = 0;
    const path = [
      msg('user', [{ type: 'text', text: 'Apa itu RAG?' }]),
      msg(
        'assistant',
        [
          { type: 'reasoning', text: 'Pikirkan dulu.', durationMs: 900 },
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'web_search',
            source: 'app',
            args: '{"q":"rag"}',
            status: 'ok',
            result: 'hasil rahasia alat',
            startedAt: 1,
            finishedAt: 2,
          },
          { type: 'text', text: 'RAG menggabungkan pencarian dan model bahasa [1].' },
          {
            type: 'sources',
            sources: [
              {
                n: 1,
                url: 'https://example.com/rag',
                title: 'Apa itu RAG',
                domain: 'example.com',
                snippet: '',
              },
              {
                n: 2,
                url: 'https://id.wikipedia.org/wiki/RAG',
                title: 'RAG [wiki]',
                domain: 'id.wikipedia.org',
                snippet: '',
              },
            ],
          },
        ],
        'openai/gpt-5',
      ),
      msg('user', [{ type: 'text', text: 'Terima kasih' }]),
      msg('assistant', [{ type: 'text', text: 'Sama-sama!' }]),
    ];
    expect(conversationToMarkdown(convo('Belajar RAG'), path)).toBe(
      [
        '# Belajar RAG',
        '',
        '## You',
        '',
        'Apa itu RAG?',
        '',
        '## openai/gpt-5',
        '',
        'RAG menggabungkan pencarian dan model bahasa [1].',
        '',
        'Sources:',
        '',
        '1. [Apa itu RAG](https://example.com/rag)',
        '2. [RAG \\[wiki\\]](https://id.wikipedia.org/wiki/RAG)',
        '',
        '## You',
        '',
        'Terima kasih',
        '',
        '## Assistant',
        '',
        'Sama-sama!',
        '',
      ].join('\n'),
    );
  });

  test('an untitled, empty chat still has a heading', () => {
    expect(conversationToMarkdown(convo(null), [])).toBe('# Untitled chat\n');
  });

  test('safe file names', () => {
    expect(safeFileName('a/b: c')).toBe('ab c');
    expect(safeFileName('..hidden')).toBe('hidden');
    expect(safeFileName('x\\y*z?"<>|')).toBe('xyz');
    expect(safeFileName('tab\there\u0000\u007f')).toBe('tabhere');
    expect(safeFileName('dots and spaces. . ')).toBe('dots and spaces');
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('nul.notes')).toBe('nul.notes_');
    expect(safeFileName('Console')).toBe('Console');
    // Bidi controls could make `txt.exe` look like `exe.txt`.
    expect(safeFileName('a‮b‪‫‬‭c⁦⁧⁨⁩d')).toBe('abcd');
    expect(safeFileName('‮⁦')).toBe('Untitled chat');
    for (const empty of [null, '', '   ', '///', '...']) {
      expect(safeFileName(empty)).toBe('Untitled chat');
    }
    const long = safeFileName('😀'.repeat(200));
    expect([...long]).toHaveLength(80);
    expect(long).toBe('😀'.repeat(80));
  });

  test('duplicates are numbered', () => {
    expect(uniqueFileNames(['Notes', 'notes', 'Notes', 'Notes (2)', 'Other'], '.md')).toEqual([
      'Notes.md',
      'notes (2).md',
      'Notes (3).md',
      'Notes (2) (2).md',
      'Other.md',
    ]);
  });
});
