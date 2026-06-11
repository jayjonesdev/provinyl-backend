/* ProVinyl — public share surfaces (root-level, no auth):
 *   GET /card/:username.png  → server-rendered OG card (the unfurl image)
 *   GET /u/:username         → read-only public collection page w/ OG meta
 *
 * These are the destination + preview image the share card points at. Both are
 * READ-ONLY — there is no add/edit/remove here, and the backend's mutation
 * endpoints stay owner-only (every mutation 403s a non-owner). A private/unknown
 * collection 404s. See docs/public-pages.md. */

import { Request, Response } from 'express';
import { env } from '../config/env';
import { getPublicProfile } from '../services/publicProfileService';
import { renderCollectionCard, embedCovers } from '../services/cardService';
import logger from '../utils/logger';

const SITE = env.CLIENT_ORIGIN.replace(/\/$/, ''); // https://provinyl.io

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** GET /card/:username.png — the OG-unfurl image. */
export async function getCard(req: Request, res: Response): Promise<void> {
  const username = String(req.params.username || '').replace(/\.png$/i, '');
  try {
    const profile = await getPublicProfile(username);
    if (!profile) {
      res.status(404).type('text/plain').send('Collection not found');
      return;
    }
    const tiles = await embedCovers(profile.tiles);
    const png = await renderCollectionCard({
      username: profile.username,
      count: profile.count,
      topGenres: profile.topGenres,
      tiles,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=21600'); // 6h (Discogs freshness)
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // embeddable cross-site
    res.send(png);
  } catch (err) {
    logger.error({ err, username }, 'Failed to render share card');
    res.status(500).type('text/plain').send('Could not render card');
  }
}

/** GET /u/:username — read-only public collection page with per-user OG tags. */
export async function getProfilePage(req: Request, res: Response): Promise<void> {
  const username = String(req.params.username || '');
  const profile = await getPublicProfile(username).catch(() => null);

  // Relax helmet's default CSP for this self-contained page (inline styles + the
  // same-site card image). Still locked to https/data sources.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; connect-src 'none'; base-uri 'none'",
  );
  res.setHeader('Cache-Control', 'public, max-age=21600');
  res.type('html');

  if (!profile) {
    res.status(404).send(notFoundPage(username));
    return;
  }

  // og:image points at THIS host (wherever the backend is actually served), so
  // it resolves whether provinyl.io/u/* is proxied or redirected here. og:url
  // stays the canonical provinyl.io link.
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const self = `${proto}://${req.get('host')}`.replace(/\/$/, '');
  const handle = '@' + esc(profile.username);
  const cardUrl = `${self}/card/${encodeURIComponent(profile.username)}.png`;
  const pageUrl = `${SITE}/u/${encodeURIComponent(profile.username)}`;
  const genres = profile.topGenres.length ? profile.topGenres.join(' · ') : 'vinyl';
  const title = `${handle}'s vinyl collection — ${profile.count.toLocaleString()} records · ProVinyl`;
  const desc = `${profile.count.toLocaleString()} records${profile.topGenres.length ? ` · ${esc(genres)}` : ''}. See the collection on ProVinyl.`;

  res.status(200).send(page({ handle, title, desc, cardUrl, pageUrl, count: profile.count, genres: esc(genres) }));
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function shell(head: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<style>
  :root{color-scheme:dark}
  *{margin:0;box-sizing:border-box}
  body{background:radial-gradient(120% 120% at 50% 20%,#262332 0%,#16141f 55%,#100e16 100%);
    color:#ecebf2;font-family:'Poppins',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
  .wrap{width:100%;max-width:760px;display:flex;flex-direction:column;gap:26px;align-items:center}
  .card{width:100%;border-radius:18px;display:block;box-shadow:0 24px 60px -20px rgba(0,0,0,.7)}
  h1{font-size:26px;font-weight:600;text-align:center}
  .sub{color:#a4a1b3;font-size:15px;text-align:center;margin-top:-14px}
  .cta{display:inline-flex;align-items:center;gap:10px;background:#d3a14d;color:#16141f;
    font-weight:700;font-size:16px;text-decoration:none;padding:14px 22px;border-radius:12px}
  .foot{color:#6f6c78;font-size:12px;font-family:'Space Mono',monospace;text-align:center;margin-top:8px}
  a.plain{color:#d3a14d;text-decoration:none}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function page(p: { handle: string; title: string; desc: string; cardUrl: string; pageUrl: string; count: number; genres: string }): string {
  const head = `<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ProVinyl">
<meta property="og:title" content="${esc(p.handle)}'s vinyl collection — ${p.count.toLocaleString()} records">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${esc(p.pageUrl)}">
<meta property="og:image" content="${esc(p.cardUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.handle)}'s vinyl collection">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${esc(p.cardUrl)}">`;
  const body = `
    <img class="card" src="${esc(p.cardUrl)}" alt="${esc(p.handle)}'s collection card" width="1200" height="630">
    <h1>${esc(p.handle)}'s vinyl collection</h1>
    <div class="sub">${p.count.toLocaleString()} records · ${p.genres}</div>
    <a class="cta" href="${SITE}">Make your own collection page →</a>
    <div class="foot">Data provided by Discogs · <a class="plain" href="${SITE}">provinyl.io</a></div>`;
  return shell(head, body);
}

function notFoundPage(username: string): string {
  const head = `<title>Collection not found · ProVinyl</title><meta name="robots" content="noindex">`;
  const body = `
    <h1 style="margin-top:60px">No public collection for @${esc(username)}</h1>
    <div class="sub">This collection is private or doesn't exist.</div>
    <a class="cta" href="${SITE}">Explore ProVinyl →</a>
    <div class="foot">Data provided by Discogs · <a class="plain" href="${SITE}">provinyl.io</a></div>`;
  return shell(head, body);
}
