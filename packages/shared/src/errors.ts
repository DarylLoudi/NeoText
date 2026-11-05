import { z } from 'zod';

export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'setup_required',
  'already_setup',
  'invalid_credentials',
  'account_disabled',
  'invalid_recovery_key',
  'provider_error',
  'quota_exceeded',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
};
