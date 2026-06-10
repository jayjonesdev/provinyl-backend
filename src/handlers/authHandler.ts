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
import { AuthRequest, IUserPreferences } from '../types';
import type { CallbackQuery, PreferencesBody, LoginQuery } from '../validators';

/** Read a refresh token from a cookieless (native) client: Bearer header or body. */
function nativeRefreshToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth) {
    const parts = auth.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') return parts[1];
  }
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  return typeof fromBody === 'string' ? fromBody : undefined;
}

// ─── GET /api/v1/auth/login ───────────────────────────────────────────────────
// Web (default): returns { authUrl } for the SPA to navigate to.
// Native (?platform=ios): 302-redirects to Discogs so ASWebAuthenticationSession
// can follow it; the callback then redirects to the app's deep link with tokens.
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { platform } = (req.valid?.query as LoginQuery | undefined) ?? { platform: 'web' };
    const mobile = platform === 'ios';

    const { requestToken, requestTokenSecret, authorizeUrl } = await getRequestToken(
      env.DISCOGS_CALLBACK_URL,
    );
    storePendingTokenSecret(requestToken, requestTokenSecret, mobile);

    if (mobile) {
      res.redirect(authorizeUrl);
      return;
    }
    res.json({ authUrl: authorizeUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to get Discogs request token');
    fail(res, 502, 'discogs_error', 'Failed to initiate Discogs authentication');
  }
}

// ─── GET /api/v1/auth/callback ────────────────────────────────────────────────
export async function callback(req: Request, res: Response): Promise<void> {
  let mobile = false;
  try {
    const { oauth_token, oauth_verifier } = req.valid!.query as CallbackQuery;

    const pending = consumePendingTokenSecret(oauth_token);
    if (!pending) {
      fail(res, 400, 'invalid_oauth_state', 'Invalid or expired OAuth state');
      return;
    }
    mobile = pending.mobile;
    const requestTokenSecret = pending.secret;

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

    // Native: hand the JWT pair back via the app deep link (tokens in the URL
    // fragment so they don't land in server access logs). No cookies.
    if (mobile) {
      const frag = `access=${encodeURIComponent(tokens.accessToken)}&refresh=${encodeURIComponent(tokens.refreshToken)}`;
      res.redirect(`${env.IOS_CALLBACK_URL}#${frag}`);
      return;
    }

    // Web: session lives in httpOnly cookies; redirect to a clean frontend URL.
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    ensureCsrfCookie(req, res);
    res.redirect(env.CLIENT_ORIGIN);
  } catch (err) {
    logger.error({ err }, 'OAuth callback failed');
    if (mobile) {
      res.redirect(`${env.IOS_CALLBACK_URL}#error=auth_failed`);
      return;
    }
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
    res.json({
      username: user.username,
      avatar_url: user.avatarUrl,
      preferences: user.preferences ?? null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get user info');
    fail(res, 500, 'internal_error', 'Internal server error');
  }
}

// ─── POST /api/v1/auth/me/preferences ─────────────────────────────────────────
// Merges the posted (validated, partial) display prefs into the user's stored
// preferences and returns the merged result. The SPA syncs usePrefs here.
export async function updatePreferences(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      fail(res, 401, 'unauthorized', 'Unauthorized');
      return;
    }
    const patch = req.valid!.body as PreferencesBody;
    const merged: IUserPreferences = { ...(user.preferences ?? {}), ...patch };
    user.preferences = merged;
    await user.save();
    res.json({ preferences: merged });
  } catch (err) {
    logger.error({ err }, 'Failed to update preferences');
    fail(res, 500, 'internal_error', 'Internal server error');
  }
}

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const cookieToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    // Native clients have no cookie — they send the refresh token via Bearer/body.
    const isNative = !cookieToken;
    const token = cookieToken ?? nativeRefreshToken(req);

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

    // Native gets tokens in the body (it stores them in the Keychain). Web keeps
    // them httpOnly — never expose tokens to browser JS.
    if (isNative) {
      res.json({
        user: { username: user.username, avatar_url: user.avatarUrl },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });
      return;
    }

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
    // Web sends the refresh cookie; native sends it via Bearer/body.
    const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? nativeRefreshToken(req);
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

