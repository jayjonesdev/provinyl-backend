import { Request, Response } from 'express';
import { env } from '../config/env';
import logger from '../utils/logger';
import jwtService from '../auth/jwtService';
import {
  getRequestToken,
  getAccessToken,
  storePendingTokenSecret,
  consumePendingTokenSecret,
} from '../auth/discogsOAuth';
import tokenService from '../services/tokenService';
import {
  setAuthCookies,
  clearAuthCookies,
  ensureCsrfCookie,
  REFRESH_COOKIE,
} from '../auth/cookies';
import { encrypt } from '../utils/crypto';
import { createUserClient } from '../services/discogsService';
import { fail } from '../utils/httpError';
import { User } from '../models/User';
import { AuthRequest } from '../types';
import type { CallbackQuery } from '../validators';

// ─── GET /api/v1/auth/login ───────────────────────────────────────────────────
export async function login(_req: Request, res: Response): Promise<void> {
  try {
    const { requestToken, requestTokenSecret, authorizeUrl } = await getRequestToken(
      env.DISCOGS_CALLBACK_URL,
    );
    storePendingTokenSecret(requestToken, requestTokenSecret);
    res.json({ authUrl: authorizeUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to get Discogs request token');
    fail(res, 502, 'discogs_error', 'Failed to initiate Discogs authentication');
  }
}

// ─── GET /api/v1/auth/callback ────────────────────────────────────────────────
export async function callback(req: Request, res: Response): Promise<void> {
  try {
    const { oauth_token, oauth_verifier } = req.valid!.query as CallbackQuery;

    const requestTokenSecret = consumePendingTokenSecret(oauth_token);
    if (!requestTokenSecret) {
      fail(res, 400, 'invalid_oauth_state', 'Invalid or expired OAuth state');
      return;
    }

    // Exchange for Discogs access token
    const { accessToken: discogsToken, accessTokenSecret: discogsTokenSecret } =
      await getAccessToken(oauth_token, requestTokenSecret, oauth_verifier);

    // Identity (username) + profile (avatar) via the authenticated Discogs client.
    const discogsClient = createUserClient(discogsToken, discogsTokenSecret);
    const identity = await discogsClient.getIdentity();
    const profile = await discogsClient.getProfile(identity.username);
    const username = identity.username;
    const avatar_url = profile.avatar_url ?? '';

    // Upsert user
    const user = await User.findOneAndUpdate(
      { username },
      {
        username,
        avatarUrl: avatar_url,
        // Encrypt Discogs OAuth tokens at rest (AES-256-GCM).
        discogsAccessToken: encrypt(discogsToken),
        discogsAccessTokenSecret: encrypt(discogsTokenSecret),
        isActive: true,
      },
      { upsert: true, new: true },
    );

    if (!user) {
      fail(res, 500, 'internal_error', 'Failed to create user');
      return;
    }

    // Issue JWT pair
    const tokens = jwtService.generateTokenPair(user);
    const expirySeconds = jwtService.parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);
    await tokenService.storeRefreshToken(user._id, tokens.refreshToken, extractFamily(tokens.refreshToken), expirySeconds);

    // Session lives in httpOnly cookies; redirect to a clean frontend URL.
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    ensureCsrfCookie(req, res);
    res.redirect(env.CLIENT_ORIGIN);
  } catch (err) {
    logger.error({ err }, 'OAuth callback failed');
    res.redirect(`${env.CLIENT_ORIGIN}/unauthorized`);
  }
}

// ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
export async function me(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      fail(res, 401, 'unauthorized', 'Unauthorized');
      return;
    }
    res.json({ username: user.username, avatar_url: user.avatarUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to get user info');
    fail(res, 500, 'internal_error', 'Internal server error');
  }
}

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (!token) {
      fail(res, 401, 'unauthorized', 'Refresh token required');
      return;
    }

    // Validate JWT
    const claims = jwtService.validateToken(token);
    if (claims.token_type !== 'refresh') {
      fail(res, 401, 'invalid_token', 'Invalid token type');
      return;
    }
    if (!claims.family) {
      fail(res, 401, 'invalid_token', 'Invalid token structure');
      return;
    }

    // Look up in DB
    const storedToken = await tokenService.findRefreshToken(token);
    if (!storedToken) {
      // Token reuse detected — revoke entire family
      logger.warn({ family: claims.family }, 'Refresh token reuse detected — revoking family');
      await tokenService.revokeFamilyTokens(claims.family);
      clearAuthCookies(res);
      fail(res, 401, 'token_reuse', 'Token reuse detected. All sessions revoked.');
      return;
    }

    // Rotate: delete used token
    await tokenService.deleteRefreshToken(token);

    // Get user
    const user = await User.findById(claims.user_id);
    if (!user) {
      clearAuthCookies(res);
      fail(res, 401, 'unauthorized', 'User not found');
      return;
    }

    // Issue new pair (same family)
    const tokens = jwtService.generateTokenPair(user, claims.family);
    const expirySeconds = jwtService.parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);
    await tokenService.storeRefreshToken(
      user._id,
      tokens.refreshToken,
      claims.family,
      expirySeconds,
      storedToken.deviceId,
      storedToken.deviceName,
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({
      user: { username: user.username, avatar_url: user.avatarUrl },
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    logger.error({ err }, 'Token refresh failed');
    clearAuthCookies(res);
    fail(res, 401, 'invalid_token', 'Invalid or expired refresh token');
  }
}

// ─── POST /api/v1/auth/logout ─────────────────────────────────────────────────
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) {
      await tokenService.deleteRefreshToken(token);
    }
    clearAuthCookies(res);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error({ err }, 'Logout error');
    clearAuthCookies(res);
    res.json({ message: 'Logged out successfully' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractFamily(refreshToken: string): string {
  try {
    const claims = jwtService.validateToken(refreshToken);
    return claims.family ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

