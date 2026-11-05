import { ApiError } from '../../lib/api/client';
import { translate } from '../../lib/i18n';

export interface MappedError<F extends string> {
  fields: Partial<Record<F, string>>;
  form?: string;
}

/**
 * Server validation issues name a body field in `path`; those land on that field. Anything else
 * becomes one message under the form.
 */
export function mapError<F extends string>(err: unknown, known: readonly F[]): MappedError<F> {
  if (!(err instanceof ApiError)) return { fields: {}, form: translate('common.genericError') };
  const fields: Partial<Record<F, string>> = {};
  if (Array.isArray(err.details)) {
    for (const issue of err.details as { path?: unknown[]; message?: unknown }[]) {
      const name = issue.path?.[0];
      if (typeof name === 'string' && typeof issue.message === 'string') {
        const field = known.find((f) => f === name);
        if (field && !fields[field]) fields[field] = issue.message;
      }
    }
  }
  if (Object.keys(fields).length > 0) return { fields };
  return { fields, form: err.message };
}
