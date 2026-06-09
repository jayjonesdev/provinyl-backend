/* ProVinyl — session cookies.
 *
 * The browser session lives in httpOnly cookies (tokens never touch JS or the
 * URL). The refresh cookie is scoped to the auth path so it's only sent to
 * refresh/logout. A separate, JS-readable CSRF cookie backs double-submit
 * protection (see middleware/csrfMiddleware.ts).
 */

import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import jwtService from './jwtService';

export const ACCESS_COOKIE = 'pv_access';
export const REFRESH_COOKIE = 'pv_refresh';
export const CSRF_COOKIE = 'pv_csrf';

// Refresh cookie is only sent to the auth routes (refresh / logout / me).
const REFRESH_PATH = '/api/v1/auth';
const secure = env.NODE_ENV === 'production';
// Prod: SPA and API may be on different sites (e.g. *.onrender.com subdomains,
// which the Public Suffix List treats as cross-site) — SameSite=None lets the
// session cookies flow on credentialed cross-site requests (requires Secure).
// Dev (http://localhost): None+Secure can't be set, so use Lax.
const sameSite: 'none' | 'lax' = secure ? 'none' : 'lax';
const httpOnlyBase = { httpOnly: true, secure, sameSite };

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const accessMaxAge = jwtService.parseExpiryToSeconds(env.JWT_ACCESS_EXPIRY) * 1000;
  const refreshMaxAge = jwtService.parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY) * 1000;
  res.cookie(ACCESS_COOKIE, accessToken, { ...httpOnlyBase, path: '/', maxAge: accessMaxAge });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...httpOnlyBase, path: REFRESH_PATH, maxAge: refreshMaxAge });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...httpOnlyBase, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...httpOnlyBase, path: REFRESH_PATH });
}

/** Ensure a CSRF cookie exists, returning its value (issuing one if missing). */
export function ensureCsrfCookie(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString('hex');
  // Readable by JS so the SPA can echo it in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure, sameSite, path: '/' });
  return token;
}
