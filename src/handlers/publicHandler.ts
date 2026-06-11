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
import { cached } from '../utils/cache';
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

/**
 * GET /u/:username — the public collection page. Serves the SPA shell with
 * per-user Open Graph tags injected (so crawlers unfurl THIS user's card) while
 * humans boot the full in-app read-only page (provinyl-web PublicCollectionPage).
 * This is the meta-injection approach from docs/public-pages.md §3.1. Falls back
 * to a self-contained card page if the SPA shell can't be fetched.
 */
export async function getProfilePage(req: Request, res: Response): Promise<void> {
  const username = String(req.params.username || '');
  const profile = await getPublicProfile(username).catch(() => null);

  // og:image points at THIS host (wherever the backend is reached), so it
  // resolves after the provinyl.io/u/* → backend redirect. og:url is canonical.
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const self = `${proto}://${req.get('host')}`.replace(/\/$/, '');
  const head = profile ? ogHead(profile, self) : notFoundHead(username);

  res.setHeader('Cache-Control', 'public, max-age=21600'); // 6h (Discogs freshness)

  // Inject the per-user meta into the live SPA shell so humans get the full app.
  try {
    const shell = await fetchAppShell();
    res.removeHeader('Content-Security-Policy'); // the app runs as it does on the static site
    res.type('html').status(200).send(injectHead(shell, head));
    return;
  } catch (err) {
    logger.warn({ err }, 'App shell fetch failed; serving standalone card page');
  }

  // Fallback: a self-contained card page (still unfurls + converts).
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; base-uri 'none'",
  );
  res.type('html').status(profile ? 200 : 404).send(
    profile ? standalonePage(profile, self) : notFoundPage(username),
  );
}

// ── SPA shell meta-injection ──────────────────────────────────────────────────

/** Cached fetch of the static site's index.html (the SPA shell). */
function fetchAppShell(): Promise<string> {
  return cached('app-shell', 5 * 60 * 1000, async () => {
    const res = await fetch(`${SITE}/`, { headers: { 'User-Agent': 'ProVinyl-OG/1.0' } });
    if (!res.ok) throw new Error(`shell ${res.status}`);
    return res.text();
  });
}

/** Replace the shell's default <title>/description/OG tags with per-user ones and
 *  absolutize the root-relative asset URLs to the canonical site (the page is
 *  served from the backend host after the redirect). */
function injectHead(shell: string, head: string): string {
  return shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, '')
    .replace(/(src|href)="\/(?!\/)/gi, `$1="${SITE}/`)
    .replace(/<\/head>/i, `${head}</head>`);
}

/** The per-user OG/Twitter <meta> block (shared by injection + the fallback). */
function ogHead(profile: { username: string; count: number; topGenres: string[] }, self: string): string {
  const handle = '@' + esc(profile.username);
  const cardUrl = `${self}/card/${encodeURIComponent(profile.username)}.png`;
  const pageUrl = `${SITE}/u/${encodeURIComponent(profile.username)}`;
  const genres = profile.topGenres.length ? esc(profile.topGenres.join(' · ')) : 'vinyl';
  const title = `${handle}'s vinyl collection — ${profile.count.toLocaleString()} records · ProVinyl`;
  const desc = `${profile.count.toLocaleString()} records${profile.topGenres.length ? ` · ${genres}` : ''}. See the collection on ProVinyl.`;
  return `<title>${esc(title)}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ProVinyl">
<meta property="og:title" content="${esc(handle)}'s vinyl collection — ${profile.count.toLocaleString()} records">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(cardUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(handle)}'s vinyl collection">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(cardUrl)}">`;
}

function notFoundHead(username: string): string {
  return `<title>Collection not found · ProVinyl</title><meta name="robots" content="noindex"><meta name="description" content="No public collection for @${esc(username)} on ProVinyl.">`;
}

// ── standalone fallback HTML (used only if the SPA shell can't be fetched) ─────

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

function standalonePage(profile: { username: string; count: number; topGenres: string[] }, self: string): string {
  const handle = '@' + esc(profile.username);
  const cardUrl = `${self}/card/${encodeURIComponent(profile.username)}.png`;
  const genres = profile.topGenres.length ? esc(profile.topGenres.join(' · ')) : 'vinyl';
  const body = `
    <img class="card" src="${esc(cardUrl)}" alt="${handle}'s collection card" width="1200" height="630">
    <h1>${handle}'s vinyl collection</h1>
    <div class="sub">${profile.count.toLocaleString()} records · ${genres}</div>
    <a class="cta" href="${SITE}">Make your own collection page →</a>
    <div class="foot">Data provided by Discogs · <a class="plain" href="${SITE}">provinyl.io</a></div>`;
  return shell(ogHead(profile, self), body);
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
