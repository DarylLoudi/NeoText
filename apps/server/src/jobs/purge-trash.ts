import type { ConversationsRepo } from '../chat/conversations-repo';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';

export const TRASH_RETENTION_MS = 30 * 86_400_000;
const RUN_EVERY_MS = 86_400_000;
/** Uploads never sent with a message are removed after this long. */
export const ORPHAN_UPLOAD_MS = 86_400_000;

/** Starts a repeating callback and returns how to cancel it. Tests swap this for a manual tick. */
export type Schedule = (fn: () => void, ms: number) => () => void;

const intervalSchedule: Schedule = (fn, ms) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

/**
 * Permanently removes chats that have sat in the trash for over 30 days, and uploads never sent
 * within a day, now and once a day.
 */
export function startPurgeJob(deps: {
  conversations: Pick<ConversationsRepo, 'purge'>;
  clock: Clock;
  log: Logger;
  /** Receives the purged ids so related data (attachments) can be cleaned up. */
  onPurged?: (ids: string[]) => void;
  /** Removes unsent uploads created before `olderThan`; returns how many. */
  purgeOrphans?: (olderThan: number) => number;
  schedule?: Schedule;
}): { stop(): void } {
  const { conversations, clock, log } = deps;
  const onPurged = deps.onPurged ?? (() => {});
  let stopped = false;

  function sweepOrphans() {
    if (!deps.purgeOrphans) return;
    try {
      deps.purgeOrphans(clock.now() - ORPHAN_UPLOAD_MS);
    } catch (err) {
      log.error({ err }, 'unsent upload cleanup failed');
    }
  }

  function run() {
    if (stopped) return;
    sweepOrphans();
    let ids: string[];
    try {
      ids = conversations.purge(null, clock.now() - TRASH_RETENTION_MS);
    } catch (err) {
      log.error({ err }, 'trash purge failed');
      return;
    }
    if (ids.length === 0) return;
    log.info({ purged: ids.length }, 'purged old chats from the trash');
    try {
      onPurged(ids);
    } catch (err) {
      log.error({ err, purged: ids.length }, 'purge hook failed');
    }
  }

  run();
  const cancel = (deps.schedule ?? intervalSchedule)(run, RUN_EVERY_MS);
  return {
    stop() {
      stopped = true;
      cancel();
    },
  };
}
