/* ProVinyl — inbound HTTP request rate limiting.
 *
 * Throttles requests *to* our endpoints (distinct from the outbound Discogs
 * throttling in services/discogsResilience.ts). Layered, IP-keyed limiters:
 *   - apiLimiter    generous safety net over the whole /api/v1 surface
 *   - publicLimiter tight anti-scrape guard for unauthenticated share surfaces
 *   - authLimiter   strict anti-bruteforce guard for the OAuth/token endpoints
 *
 * Stores are in-memory (express-rate-limit's default MemoryStore) and therefore
 * per-instance — correct for a single Render instance. Before scaling out, move
 * the counters to a shared store (Redis) or limits become per-instance and a
 * client can multiply its budget by the instance count. See docs/RATE-LIMITING.md.
 *
 * Requires `app.set('trust proxy', …)` so req.ip reflects the real client behind
 * Render's edge proxy rather than the proxy hop itself (wired in app.ts).
 */

import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';

const MINUTE = 60_000;

// Don't throttle the in-process test suite — supertest hammers the app and the
// MemoryStore counter would bleed across tests. Overridable so the limiter's own
// test can exercise the 429 path.
const skipInTest = () => env.NODE_ENV === 'test';

interface LimiterConfig {
  /** Sliding window length in ms. */
  windowMs: number;
  /** Max requests allowed per key (IP) per window. */
  limit: number;
  /** Label for logs / debugging. */
  name: string;
  /** Predicate to bypass the limiter; defaults to skipping in NODE_ENV=test. */
  skip?: (req: Request) => boolean;
}

export function createRateLimiter({ windowMs, limit, name, skip }: LimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true, // emit RateLimit-* (IETF) headers + Retry-After
    legacyHeaders: false, // drop the deprecated X-RateLimit-* set
    skip: skip ?? skipInTest,
    // Render our standard { error: { code, message } } envelope instead of the
    // library's plain-text default, so clients parse 429s like any other error.
    handler: (req: Request, res: Response) => {
      logger.warn({ ip: req.ip, path: req.originalUrl, limiter: name }, 'rate limit exceeded');
      fail(res, 429, 'rate_limited', 'Too many requests — please slow down and try again shortly.');
    },
  });
}

// Baseline net over the whole authenticated app surface. Generous on purpose:
// one share-card render fans out many /images/proxy calls (one per cover), so a
// tight cap here would break legitimate large-collection views.
//
// Health probes are exempt: Render's load balancer polls /api/v1/health on a
// short interval, and behind the edge proxy all probes can share one client IP,
// so counting them would let infra traffic erode the budget for real clients.
// (req.url is stripped of the /api/v1 mount prefix here, so match on '/health'.)
export const apiLimiter = createRateLimiter({
  name: 'api',
  windowMs: 15 * MINUTE,
  limit: 3000,
  skip: (req) => skipInTest() || req.path === '/health',
});

// Unauthenticated, crawler-facing surfaces (/u/:username, /card/:username.png,
// /public/:username/collection). Low enough to stop bulk scraping of public
// collections and CPU-heavy card renders, ample for real humans + link unfurls.
export const publicLimiter = createRateLimiter({ name: 'public', windowMs: 15 * MINUTE, limit: 100 });

// OAuth login/callback + token refresh/logout. Tight: these are low-volume for
// real users, so a strict cap throttles credential-stuffing / token churn.
export const authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * MINUTE, limit: 30 });
