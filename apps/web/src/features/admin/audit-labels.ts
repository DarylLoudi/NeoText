import { translate } from '../../lib/i18n';

/** The locale key of the plain sentence for a kind; every kind in the shared list has one. */
export const auditLabelKey = (kind: string): string => `admin.audit.kinds.${kind}`;

/** The sentence for an event; a kind this build does not know shows as itself. */
export function auditLabel(kind: string): string {
  const key = auditLabelKey(kind);
  const text = translate(key);
  return text === key ? kind : text;
}
