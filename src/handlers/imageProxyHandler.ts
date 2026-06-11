import { Request, Response } from 'express';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import { USER_AGENT } from '../auth/discogsOAuth';
import type { ImageProxyQuery } from '../validators';

// Only Discogs-hosted images may be proxied (prevents an open relay/SSRF vector).
const ALLOWED_HOST = /(^|\.)discogs\.com$/;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024;

function allowedTarget(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_HOST.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

// GET /api/v1/images/proxy?url=<discogs image url> — public, no auth.
//
// Streams a Discogs cover image back through our own origin so the SPA can draw
// it onto a <canvas> for share cards. Discogs' image CDN (i.discogs.com) sends
// no Access-Control-Allow-Origin header, so a `crossOrigin` canvas read of the
// raw URL taints the canvas and blocks PNG export. Serving the bytes from our
// API (which has CORS configured for the client origin) makes them canvas-clean.
export async function proxyImage(req: Request, res: Response): Promise<void> {
  const { url } = req.valid!.query as ImageProxyQuery;
  const target = allowedTarget(url);
  if (!target) {
    fail(res, 400, 'invalid_url', 'Only Discogs image URLs may be proxied');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
    });
    if (!upstream.ok) {
      fail(res, 502, 'upstream_error', `Image fetch failed (${upstream.status})`);
      return;
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      fail(res, 415, 'not_an_image', 'Proxied URL is not an image');
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      fail(res, 413, 'too_large', 'Image exceeds size limit');
      return;
    }
    res.setHeader('Content-Type', contentType);
    // Let the SPA (a different origin) read these pixels onto a <canvas>.
    // Overrides helmet's default Cross-Origin-Resource-Policy: same-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    logger.error({ err }, 'Image proxy failed');
    if (!res.headersSent) fail(res, 502, 'proxy_error', 'Failed to proxy image');
  } finally {
    clearTimeout(timer);
  }
}
