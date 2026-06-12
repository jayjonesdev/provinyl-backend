import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from './rateLimitMiddleware';

// NODE_ENV=test would otherwise skip every limiter, so pass an explicit
// non-skipping predicate to exercise the throttle + 429 envelope.
function appWithLimit(limit: number) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createRateLimiter({ name: 'test', windowMs: 60_000, limit, skip: () => false }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('allows requests under the limit and 429s once it is exceeded', async () => {
    const app = appWithLimit(2);

    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(200);

    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
    // standard error envelope, not the library's plain-text default
    expect(blocked.body).toEqual({
      error: { code: 'rate_limited', message: expect.stringContaining('Too many requests') },
    });
  });

  it('emits standard RateLimit headers and drops legacy ones', async () => {
    const res = await request(appWithLimit(5)).get('/ping');
    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
  });
});
