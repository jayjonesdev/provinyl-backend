/* ProVinyl — symmetric encryption for secrets at rest (Discogs OAuth tokens).
 *
 * AES-256-GCM with a per-value random IV. Output format:
 *   v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 * `decrypt` returns any value that isn't in that format unchanged, so existing
 * plaintext rows keep working during the transition.
 */

import crypto from 'node:crypto';
import { env } from '../config/env';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';
const KEY = Buffer.from(env.TOKEN_ENC_KEY, 'hex'); // 32 bytes

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decrypt(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return value; // legacy plaintext
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const ciphertext = Buffer.from(ctB64!, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
