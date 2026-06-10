import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { csrfMiddleware } from './csrfMiddleware';
import { CSRF_COOKIE } from '../auth/cookies';

function mockReq(opts: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string> }): Request {
  const headers = opts.headers ?? {};
  return {
    method: opts.method ?? 'GET',
    cookies: opts.cookies ?? {},
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: {} as Record<string, string>,
    cookie(name: string, val: string) { this.cookies[name] = val; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

describe('csrfMiddleware', () => {
  it('issues a CSRF cookie on safe requests and continues', () => {
    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(res.cookies[CSRF_COOKIE]).toBeTruthy();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not reissue when a CSRF cookie already exists', () => {
    const req = mockReq({ method: 'GET', cookies: { [CSRF_COOKIE]: 'existing' } });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(res.cookies[CSRF_COOKIE]).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows a mutation when cookie and header match', () => {
    const req = mockReq({ method: 'POST', cookies: { [CSRF_COOKIE]: 'tok123' }, headers: { 'x-csrf-token': 'tok123' } });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('rejects a mutation with a missing header', () => {
    const req = mockReq({ method: 'POST', cookies: { [CSRF_COOKIE]: 'tok123' } });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects a mutation when cookie and header differ', () => {
    const req = mockReq({ method: 'DELETE', cookies: { [CSRF_COOKIE]: 'tok123' }, headers: { 'x-csrf-token': 'nope' } });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('bypasses CSRF for cookieless Bearer clients (native apps)', () => {
    const req = mockReq({ method: 'POST', headers: { authorization: 'Bearer jwt.access.token' } });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('bypasses CSRF for a Bearer request even if a stray CSRF cookie is present', () => {
    // URLSession auto-stores the pv_csrf cookie from GET responses, so a native
    // client's mutation can carry it without an X-CSRF-Token header. Bearer auth
    // is token-based (not ambient-cookie), so it must still bypass.
    const req = mockReq({
      method: 'POST',
      cookies: { [CSRF_COOKIE]: 'tok123' },
      headers: { authorization: 'Bearer jwt.access.token' },
    });
    const res = mockRes();
    const next = vi.fn();
    csrfMiddleware(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
