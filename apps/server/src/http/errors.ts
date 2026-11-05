import type { ApiErrorBody, ErrorCode } from '@neotext/shared';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Container } from '../container';
import type { AppEnv } from './env';

export class AppError extends Error {
  code: ErrorCode;
  status: ContentfulStatusCode;
  details?: unknown;

  constructor(code: ErrorCode, message: string, status: ContentfulStatusCode, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function body(
  code: ErrorCode,
  message: string,
  requestId: string | undefined,
  details?: unknown,
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      ...(requestId === undefined ? {} : { requestId }),
    },
  };
}

const HTTP_EXCEPTION_CODES: Partial<Record<number, { code: ErrorCode; message: string }>> = {
  400: { code: 'bad_request', message: 'The request is not valid. Check it and try again.' },
  413: { code: 'payload_too_large', message: 'That request is too large.' },
};

export function errorHandler(c: Container): ErrorHandler<AppEnv> {
  return (err, ctx) => {
    const requestId = ctx.get('requestId');
    if (err instanceof AppError) {
      return ctx.json(body(err.code, err.message, requestId, err.details), err.status);
    }
    if (err instanceof HTTPException) {
      const known = HTTP_EXCEPTION_CODES[err.status];
      const code = known?.code ?? 'internal';
      const message = err.message || known?.message || 'Something went wrong on the server.';
      if (err.status >= 500) c.log.error({ err, requestId }, 'http exception');
      return ctx.json(body(code, message, requestId), err.status);
    }
    c.log.error({ err, requestId }, 'unhandled error');
    const details = c.config.env === 'production' ? undefined : { stack: err.stack };
    return ctx.json(
      body(
        'internal',
        `Something went wrong on the server. Check the server log for request ${requestId}.`,
        requestId,
        details,
      ),
      500,
    );
  };
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (ctx) =>
  ctx.json(body('not_found', 'No such endpoint.', ctx.get('requestId')), 404);
