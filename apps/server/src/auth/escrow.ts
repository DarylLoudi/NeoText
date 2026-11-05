import { wrapForInstance } from '../crypto/vault';
import type { InstanceMetaRepo } from '../instance/meta';
import type { UsersRepo } from './users-repo';

export interface EscrowDeps {
  users: UsersRepo;
  instance: InstanceMetaRepo;
  instanceKey: Buffer;
}

/**
 * With escrow on, stores the DEK under the instance key when a user signs in without one, so an
 * admin can reset their password later. Synchronous, so turning escrow off cannot interleave.
 */
export function escrowOnSignIn(
  deps: EscrowDeps,
  user: { id: string; dekByInstance: Buffer | null },
  dek: Buffer,
): void {
  if (user.dekByInstance || deps.instance.get('escrow') !== true) return;
  deps.users.updateVault(user.id, {
    dekByInstance: wrapForInstance(user.id, dek, deps.instanceKey),
  });
}
