import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { env } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorMiddleware(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const message = err.message || 'Internal server error';

  logger.error({ err, statusCode }, 'Request error');

  res.status(statusCode).json({
    error: message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found' });
}
