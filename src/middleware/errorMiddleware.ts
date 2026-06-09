import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { env } from '../config/env';
import { ApiError, fail } from '../utils/httpError';

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) logger.error({ err }, 'Request error');
    fail(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  const error = err as Error;
  logger.error({ err: error }, 'Unhandled request error');
  fail(
    res,
    500,
    'internal_error',
    error?.message || 'Internal server error',
    env.NODE_ENV !== 'production' && error?.stack ? { stack: error.stack } : undefined,
  );
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  fail(res, 404, 'not_found', 'Route not found');
}
