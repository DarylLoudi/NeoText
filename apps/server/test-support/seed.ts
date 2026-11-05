import { newId } from '@neotext/shared';
import type { Container } from '../src/container';

const MINUTE = 60_000;

/** A paragraph with the markdown a real answer has: emphasis, a list, inline code. */
function answerText(n: number): string {
  return (
    `Answer **${n}**: here is what matters.\n\n` +
    `- the first point, with \`code\`\n- the second point\n\n` +
    `A closing line for message ${n}.`
  );
}

/**
 * Adds `count` chats to one account through the real repositories (sealed with `dek`), the
 * newest first in the list, each with `messagesEach` alternating messages. One transaction.
 * Returns the chat ids, newest first.
 */
export function seedConversations(
  c: Container,
  userId: string,
  dek: Buffer,
  opts: { count: number; messagesEach?: number; now?: number },
): string[] {
  const now = opts.now ?? c.clock.now();
  const ids: string[] = [];
  c.db.raw.transaction(() => {
    for (let i = 0; i < opts.count; i++) {
      // Newest first: chat 0 is the most recent; titles count up from the oldest.
      const at = now - (i + 1) * MINUTE;
      const id = newId('cnv');
      c.repos.conversations.insert(
        { id, userId, folderId: null, title: `Seeded chat ${opts.count - i}`, createdAt: at },
        dek,
      );
      if (opts.messagesEach) addThread(c, userId, dek, id, opts.messagesEach, at);
      ids.push(id);
    }
  })();
  return ids;
}

/** One chat titled `title` holding a thread of `messages` alternating turns. */
export function seedThread(
  c: Container,
  userId: string,
  dek: Buffer,
  opts: { title: string; messages: number; now?: number },
): string {
  const at = opts.now ?? c.clock.now();
  const id = newId('cnv');
  c.db.raw.transaction(() => {
    c.repos.conversations.insert(
      { id, userId, folderId: null, title: opts.title, createdAt: at },
      dek,
    );
    addThread(c, userId, dek, id, opts.messages, at);
  })();
  return id;
}

function addThread(
  c: Container,
  userId: string,
  dek: Buffer,
  conversationId: string,
  count: number,
  start: number,
): void {
  let parentId: string | null = null;
  for (let n = 0; n < count; n++) {
    const id = newId('msg');
    const user = n % 2 === 0;
    c.repos.messages.insert(
      {
        id,
        conversationId,
        userId,
        parentId,
        role: user ? 'user' : 'assistant',
        status: 'complete',
        parts: [{ type: 'text', text: user ? `Question ${n}?` : answerText(n) }],
        providerId: null,
        modelId: null,
        createdAt: start + n,
      },
      dek,
    );
    parentId = id;
  }
  if (parentId) {
    c.repos.conversations.recordTurn(conversationId, start, parentId, count, {
      providerId: 'seed',
      modelId: 'seed/model',
    });
  }
}
