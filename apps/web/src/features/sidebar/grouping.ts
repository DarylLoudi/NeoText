import type { ConversationSummary } from '@neotext/shared';
import { dateBucket } from '../../lib/format';

export interface ConversationGroup {
  key: string;
  bucket: ReturnType<typeof dateBucket>;
  items: ConversationSummary[];
}

function bucketKey(bucket: ConversationGroup['bucket']): string {
  if (bucket.kind !== 'month') return bucket.kind;
  return `month-${bucket.year}-${String(bucket.month).padStart(2, '0')}`;
}

/**
 * Groups chats by their last activity: today, yesterday, previous 7 days, previous 30 days, then
 * one group per month. `items` arrive newest first (the server's order), so groups come out in
 * time order and items keep their order inside a group.
 */
export function groupConversations(items: ConversationSummary[], now: number): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  const byKey = new Map<string, ConversationGroup>();
  for (const item of items) {
    const bucket = dateBucket(item.lastActivityAt, now);
    const key = bucketKey(bucket);
    let group = byKey.get(key);
    if (!group) {
      group = { key, bucket, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
