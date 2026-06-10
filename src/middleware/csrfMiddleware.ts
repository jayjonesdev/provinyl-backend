/* ProVinyl — double-submit CSRF protection.
 *
 * Safe requests (GET/HEAD/OPTIONS) just ensure the JS-readable CSRF cookie
 * exists. State-changing requests must echo that cookie's value in the
 * X-CSRF-Token header; the two are compared in constant time. Pairs with the
 * httpOnly session cookies (a cross-site attacker can't read the CSRF cookie to
 * forge the header).
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CSRF_COOKIE, ensureCsrfCookie } from '../auth/cookies';
import { fail } from '../utils/httpError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    ensureCsrfCookie(req, res);
    next();
    return;
  }

  // Bearer-authenticated clients (native apps) aren't subject to CSRF: they use
  // token auth, not the ambient session cookie that CSRF defends against, and a
  // browser can't be tricked into attaching an Authorization header cross-site.
  // (A stray pv_csrf cookie may still be present — URLSession auto-stores it from
  // GET responses — so we must NOT gate this on the cookie's absence.) The web
  // app uses cookie auth + X-CSRF-Token and never sends a Bearer header, so it
  // stays protected by the double-submit check below.
  if (req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    fail(res, 403, 'csrf_invalid', 'Invalid CSRF token');
    return;
  }

  next();
}
