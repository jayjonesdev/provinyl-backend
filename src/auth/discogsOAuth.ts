// eslint-disable-next-line @typescript-eslint/no-require-imports
const DiscogsClient = require('disconnect').Client;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DiscogsOAuth = require('disconnect/lib/oauth');
import { env } from '../config/env';

// Discogs asks every client to identify itself with a descriptive User-Agent.
export const USER_AGENT = 'ProVinyl/1.0 +https://github.com/jayjonesdev/provinyl-backend';

interface DiscogsAuth {
  method: string;
  level: number;
  consumerKey?: string;
  consumerSecret?: string;
  token?: string;
  tokenSecret?: string;
  authorizeUrl?: string;
}

interface RequestTokenResult {
  requestToken: string;
  requestTokenSecret: string;
  authorizeUrl: string;
}

interface AccessTokenResult {
  accessToken: string;
  accessTokenSecret: string;
}

// In-memory store for pending OAuth state: requestToken → { secret, mobile }.
// `mobile` records whether the flow began from the native (iOS) login, so the
// callback redirects to the deep link instead of CLIENT_ORIGIN.
// Entries expire after 10 minutes.
export interface PendingToken {
  secret: string;
  mobile: boolean;
}
const pendingTokenSecrets = new Map<string, { secret: string; mobile: boolean; expiresAt: number }>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function prunePendingTokens() {
  const now = Date.now();
  for (const [key, val] of pendingTokenSecrets.entries()) {
    if (val.expiresAt < now) pendingTokenSecrets.delete(key);
  }
}

export function storePendingTokenSecret(requestToken: string, secret: string, mobile = false): void {
  prunePendingTokens();
  pendingTokenSecrets.set(requestToken, { secret, mobile, expiresAt: Date.now() + PENDING_TTL_MS });
}

export function consumePendingTokenSecret(requestToken: string): PendingToken | null {
  prunePendingTokens();
  const entry = pendingTokenSecrets.get(requestToken);
  if (!entry) return null;
  pendingTokenSecrets.delete(requestToken);
  return { secret: entry.secret, mobile: entry.mobile };
}

export function getRequestToken(callbackUrl: string): Promise<RequestTokenResult> {
  return new Promise((resolve, reject) => {
    const oauth = new DiscogsOAuth();
    oauth.getRequestToken(
      env.DISCOGS_CONSUMER_KEY,
      env.DISCOGS_CONSUMER_SECRET,
      callbackUrl,
      (err: Error | null, auth: DiscogsAuth) => {
        if (err) return reject(err);
        if (!auth.token || !auth.tokenSecret || !auth.authorizeUrl) {
          return reject(new Error('Incomplete request token response from Discogs'));
        }
        resolve({
          requestToken: auth.token,
          requestTokenSecret: auth.tokenSecret,
          authorizeUrl: auth.authorizeUrl,
        });
      },
    );
  });
}

export function getAccessToken(
  requestToken: string,
  requestTokenSecret: string,
  verifier: string,
): Promise<AccessTokenResult> {
  return new Promise((resolve, reject) => {
    const oauth = new DiscogsOAuth({
      method: 'oauth',
      level: 1,
      consumerKey: env.DISCOGS_CONSUMER_KEY,
      consumerSecret: env.DISCOGS_CONSUMER_SECRET,
      token: requestToken,
      tokenSecret: requestTokenSecret,
    });
    oauth.getAccessToken(verifier, (err: Error | null, auth: DiscogsAuth) => {
      if (err) return reject(err);
      if (!auth.token || !auth.tokenSecret) {
        return reject(new Error('Incomplete access token response from Discogs'));
      }
      resolve({
        accessToken: auth.token,
        accessTokenSecret: auth.tokenSecret,
      });
    });
  });
}

export function getDiscogsClient(accessToken: string, accessTokenSecret: string) {
  return new DiscogsClient(USER_AGENT, {
    method: 'oauth',
    level: 2,
    consumerKey: env.DISCOGS_CONSUMER_KEY,
    consumerSecret: env.DISCOGS_CONSUMER_SECRET,
    token: accessToken,
    tokenSecret: accessTokenSecret,
  });
}

export function getDiscogsClientAppLevel() {
  return new DiscogsClient(USER_AGENT, {
    method: 'discogs',
    consumerKey: env.DISCOGS_CONSUMER_KEY,
    consumerSecret: env.DISCOGS_CONSUMER_SECRET,
  });
}
