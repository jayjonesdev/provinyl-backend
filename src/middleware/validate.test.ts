import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { validate } from './validate';
import { releaseParams, releaseBody, searchQuery } from '../validators';

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

describe('validate', () => {
  it('passes and coerces valid params, populating req.valid', () => {
    const req = { params: { id: '305571' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    validate({ params: releaseParams })(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.valid?.params).toEqual({ id: 305571 });
  });

  it('rejects invalid params with the standard error envelope', () => {
    const req = { params: { id: 'not-a-number' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    validate({ params: releaseParams })(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details).toBeDefined();
  });

  it('applies query defaults', () => {
    const req = { query: { q: 'miles davis' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    validate({ query: searchQuery })(req, res as unknown as Response, next);
    expect(req.valid?.query).toMatchObject({ q: 'miles davis', type: 'title', page: 1, per_page: 25 });
  });

  it('rejects a missing required query field', () => {
    const req = { query: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    validate({ query: searchQuery })(req, res as unknown as Response, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('coerces a numeric body field', () => {
    const req = { body: { releaseId: '42' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    validate({ body: releaseBody })(req, res as unknown as Response, next);
    expect(req.valid?.body).toEqual({ releaseId: 42 });
  });
});
