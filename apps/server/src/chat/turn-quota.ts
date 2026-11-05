import type { ModelRef } from '@neotext/shared';
import type { AuthContext } from '../http/env';
import type { ProviderService } from '../providers/service';
import type { QuotaService } from '../quotas/service';

/**
 * The admin's limit on shared providers: refuses a new turn once it is reached, only when a
 * target runs on a shared provider. Synchronous, like the budget check it sits beside. A
 * member's own providers are never limited, and a running generation always finishes.
 */
export function assertSharedQuota(
  deps: {
    providers: Pick<ProviderService, 'isShared'>;
    quotas: Pick<QuotaService, 'assertWithin'>;
  },
  auth: AuthContext,
  targets: ModelRef[],
): void {
  if (targets.some((ref) => deps.providers.isShared(auth, ref.providerId))) {
    deps.quotas.assertWithin(auth.userId);
  }
}
