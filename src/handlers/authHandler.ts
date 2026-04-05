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
import { User } from '../models/User';
import { AuthRequest } from '../types';
import axios from 'axios';

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
    res.status(502).json({ error: 'Failed to initiate Discogs authentication' });
  }
}

// ─── GET /api/v1/auth/callback ────────────────────────────────────────────────
export async function callback(req: Request, res: Response): Promise<void> {
  try {
    const { oauth_token, oauth_verifier } = req.query as Record<string, string>;

    if (!oauth_token || !oauth_verifier) {
      res.status(400).json({ error: 'Missing OAuth parameters' });
      return;
    }

    const requestTokenSecret = consumePendingTokenSecret(oauth_token);
    if (!requestTokenSecret) {
      res.status(400).json({ error: 'Invalid or expired OAuth state' });
      return;
    }

    // Exchange for Discogs access token
    const { accessToken: discogsToken, accessTokenSecret: discogsTokenSecret } =
      await getAccessToken(oauth_token, requestTokenSecret, oauth_verifier);

    // Fetch Discogs identity to get username + avatar
    const identityRes = await axios.get<{ username: string; avatar_url: string }>(
      'https://api.discogs.com/oauth/identity',
      {
        headers: {
          Authorization: buildDiscogsAuthHeader(oauth_token, discogsToken, discogsTokenSecret),
          'User-Agent': 'ProVinyl/1.0',
        },
      },
    );

    const { username, avatar_url } = identityRes.data;

    // Upsert user
    const user = await User.findOneAndUpdate(
      { username },
      {
        username,
        avatarUrl: avatar_url,
        discogsAccessToken: discogsToken,
        discogsAccessTokenSecret: discogsTokenSecret,
        isActive: true,
      },
      { upsert: true, new: true },
    );

    if (!user) {
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }

    // Issue JWT pair
    const tokens = jwtService.generateTokenPair(user);
    const expirySeconds = jwtService.parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);
    await tokenService.storeRefreshToken(user._id, tokens.refreshToken, extractFamily(tokens.refreshToken), expirySeconds);

    // Redirect to frontend callback page with tokens in query params
    const redirectUrl = new URL(`${env.CLIENT_ORIGIN}/auth/callback`);
    redirectUrl.searchParams.set('accessToken', tokens.accessToken);
    redirectUrl.searchParams.set('refreshToken', tokens.refreshToken);
    redirectUrl.searchParams.set('expiresIn', String(tokens.expiresIn));

    res.redirect(redirectUrl.toString());
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ username: user.username, avatar_url: user.avatarUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to get user info');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken?: string };

    if (!token) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    // Validate JWT
    const claims = jwtService.validateToken(token);
    if (claims.token_type !== 'refresh') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }
    if (!claims.family) {
      res.status(401).json({ error: 'Invalid token structure' });
      return;
    }

    // Look up in DB
    const storedToken = await tokenService.findRefreshToken(token);
    if (!storedToken) {
      // Token reuse detected — revoke entire family
      logger.warn({ family: claims.family }, 'Refresh token reuse detected — revoking family');
      await tokenService.revokeFamilyTokens(claims.family);
      res.status(401).json({ error: 'Token reuse detected. All sessions revoked.' });
      return;
    }

    // Rotate: delete used token
    await tokenService.deleteRefreshToken(token);

    // Get user
    const user = await User.findById(claims.user_id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
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

    res.json({
      user: { username: user.username, avatar_url: user.avatarUrl },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    logger.error({ err }, 'Token refresh failed');
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}

// ─── POST /api/v1/auth/logout ─────────────────────────────────────────────────
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken?: string };
    if (token) {
      await tokenService.deleteRefreshToken(token);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error({ err }, 'Logout error');
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

function buildDiscogsAuthHeader(
  _requestToken: string,
  accessToken: string,
  accessTokenSecret: string,
): string {
  // Use the access token to build the OAuth Authorization header for identity call
  const key = `${env.DISCOGS_CONSUMER_KEY}`;
  const secret = `${env.DISCOGS_CONSUMER_SECRET}&${accessTokenSecret}`;
  const nonce = Math.random().toString(36).substring(2);
  const timestamp = Math.floor(Date.now() / 1000);
  return (
    `OAuth oauth_consumer_key="${key}",` +
    `oauth_token="${accessToken}",` +
    `oauth_signature_method="PLAINTEXT",` +
    `oauth_signature="${secret}",` +
    `oauth_timestamp="${timestamp}",` +
    `oauth_nonce="${nonce}"`
  );
}
