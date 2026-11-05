import type { InstanceMode, Quota, RegistrationPolicy } from '@neotext/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { instanceMeta } from '../db/schema';
import type { Clock } from '../lib/clock';

export type InstanceMetaValues = {
  mode: InstanceMode;
  registration: RegistrationPolicy;
  escrow: boolean;
  /** What a member may spend on shared providers unless they have their own limit. */
  default_quota: Quota | null;
  setup_completed_at: number;
};

export interface InstanceMetaRepo {
  get<K extends keyof InstanceMetaValues>(key: K): InstanceMetaValues[K] | null;
  set<K extends keyof InstanceMetaValues>(key: K, value: InstanceMetaValues[K]): void;
}

export function createInstanceMetaRepo(db: DbHandle, clock: Clock): InstanceMetaRepo {
  return {
    get(key) {
      const row = db.orm.select().from(instanceMeta).where(eq(instanceMeta.key, key)).get();
      return row ? (row.value as never) : null;
    },
    set(key, value) {
      const updatedAt = clock.now();
      db.orm
        .insert(instanceMeta)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: instanceMeta.key, set: { value, updatedAt } })
        .run();
    },
  };
}

/** The sign-up policy in force: a personal instance never takes sign-ups, whatever is stored. */
export function effectiveRegistration(instance: InstanceMetaRepo): RegistrationPolicy | null {
  const registration = instance.get('registration');
  if (registration === null) return null;
  return instance.get('mode') === 'personal' ? 'closed' : registration;
}
