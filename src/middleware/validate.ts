/* ProVinyl — request validation middleware.
 *
 * Validates (and coerces) req.params/query/body against zod schemas, stashing
 * the typed result on `req.valid` for handlers. Express 5's req.query is a
 * getter, so we never mutate it — handlers read from req.valid instead. Invalid
 * input returns the standard 400 error envelope.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { fail } from '../utils/httpError';

export interface RequestSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

export interface ValidatedData {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const valid: ValidatedData = {};
      if (schemas.params) valid.params = schemas.params.parse(req.params);
      if (schemas.query) valid.query = schemas.query.parse(req.query);
      if (schemas.body) valid.body = schemas.body.parse(req.body);
      req.valid = valid;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        fail(res, 400, 'validation_error', 'Validation failed', err.flatten());
        return;
      }
      next(err);
    }
  };
}
