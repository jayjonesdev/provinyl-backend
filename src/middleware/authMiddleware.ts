import { Response, NextFunction } from 'express';
import jwtService from '../auth/jwtService';
import { ACCESS_COOKIE } from '../auth/cookies';
import { fail } from '../utils/httpError';
import { User } from '../models/User';
import { AuthRequest } from '../types';

/** Prefer the httpOnly access cookie; fall back to a Bearer header (non-browser clients). */
function extractAccessToken(req: AuthRequest): string | null {
  const cookieToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') return parts[1]!;
  }
  return null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      fail(res, 401, 'unauthorized', 'Authentication required');
      return;
    }

    const claims = jwtService.validateToken(token);

    if (claims.token_type !== 'access') {
      fail(res, 401, 'invalid_token', 'Invalid token type');
      return;
    }

    const user = await User.findById(claims.user_id);
    if (!user || !user.isActive) {
      fail(res, 401, 'unauthorized', 'User not found');
      return;
    }

    req.userId = claims.user_id;
    req.user = user;

    next();
  } catch {
    fail(res, 401, 'invalid_token', 'Invalid or expired token');
  }
}
