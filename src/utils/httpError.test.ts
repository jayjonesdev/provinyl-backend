import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { fail, ApiError } from './httpError';

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

describe('fail', () => {
  it('writes the status and { error: { code, message } } envelope', () => {
    const res = mockRes();
    fail(res as unknown as Response, 403, 'forbidden', 'Forbidden');
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
  });

  it('includes details only when provided', () => {
    const res = mockRes();
    fail(res as unknown as Response, 400, 'validation_error', 'Validation failed', { field: 'id' });
    expect(res.body).toEqual({
      error: { code: 'validation_error', message: 'Validation failed', details: { field: 'id' } },
    });
  });
});

describe('ApiError', () => {
  it('carries statusCode, code, message and details', () => {
    const err = new ApiError(404, 'not_found', 'Nope', { a: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('Nope');
    expect(err.details).toEqual({ a: 1 });
  });
});
