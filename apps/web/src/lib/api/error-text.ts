import { formatCost } from '../format';
import { translate } from '../i18n';
import { ApiError } from './client';

const detail = (err: ApiError, key: string): unknown =>
  (err.details as Record<string, unknown> | undefined)?.[key];

/** The admin's limit on shared models, worded for `period`; used by the 402 and the composer notice. */
export function sharedQuotaText(period: 'daily' | 'monthly', amountUsd: number): string {
  return translate('chat.errors.sharedQuotaExceeded', {
    period: translate(`chat.errors.periods.${period}`),
    amount: formatCost(amountUsd),
    reset: translate(`chat.errors.resets.${period}`),
  });
}

/**
 * A server error in the user's language for the codes the web knows how to word; anything
 * else keeps the server's English message, and a non-API error gets `fallback`.
 */
export function errorText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === 'quota_exceeded') {
    const period = detail(err, 'period');
    const amount = detail(err, 'amountUsd');
    if ((period === 'daily' || period === 'monthly') && typeof amount === 'number') {
      return sharedQuotaText(period, amount);
    }
    const limit = detail(err, 'limitUsd');
    if ((period === 'daily' || period === 'monthly') && typeof limit === 'number') {
      return translate('chat.errors.quotaExceeded', {
        period: translate(`chat.errors.periods.${period}`),
        limit: formatCost(limit),
      });
    }
    return translate('chat.errors.quotaExceededPlain');
  }
  return err.message;
}

/** As `errorText`, for an attachment upload: its size and type refusals are worded here too. */
export function attachmentErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'payload_too_large') {
      const limit = detail(err, 'limitMb');
      return detail(err, 'reason') === 'attachment_quota' && typeof limit === 'number'
        ? translate('chat.attachments.quotaFull', { limit })
        : translate('chat.attachments.tooLarge');
    }
    if (err.code === 'unsupported_media_type') {
      return detail(err, 'reason') === 'content_mismatch'
        ? translate('chat.attachments.mismatch')
        : translate('chat.attachments.unsupported');
    }
  }
  return errorText(err, fallback);
}
