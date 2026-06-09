/* ProVinyl — consistent error envelope.
 *
 * Every error response is shaped as:
 *   { "error": { "code": string, "message": string, "details"?: unknown } }
 *
 * Handlers either call `fail(res, ...)` directly or throw an `ApiError`, which
 * the error middleware renders in the same shape.
 */

import type { Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    error: { code, message, ...(details !== undefined && { details }) },
  });
}
