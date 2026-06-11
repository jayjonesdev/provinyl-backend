import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock the Discogs-backed summary so the route + satori/sharp render run for
// real without network. (The render itself is exercised end-to-end.)
vi.mock('./services/publicProfileService', () => ({ getPublicProfile: vi.fn() }));
import { getPublicProfile } from './services/publicProfileService';
import { cacheClear } from './utils/cache';
import createApp from './app';

const app = createApp();
const profile = {
  username: 'jonesy',
  count: 312,
  topGenres: ['Jazz', 'Soul', 'Funk'],
  tiles: [
    { bg: '#16130f', accent: '#d8a24a' },
    { bg: '#1c4f96', accent: '#edc23c' },
  ],
};

beforeEach(() => vi.mocked(getPublicProfile).mockReset());

describe('public share routes', () => {
  it('serves /u/:username with per-user Open Graph tags (read-only, no cookies)', async () => {
    vi.mocked(getPublicProfile).mockResolvedValue(profile);
    const res = await request(app).get('/u/jonesy');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('property="og:image"');
    expect(res.text).toContain('/card/jonesy.png');
    expect(res.text).toContain('twitter:card');
    expect(res.text).toContain('312');
    expect(res.text).toContain('Jazz');
    // read-only landing — no edit/add/remove controls
    expect(res.text).not.toMatch(/<form|<button/i);
    // public, cacheable, cookie-free
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('injects per-user OG meta into the SPA shell so humans still boot the app', async () => {
    cacheClear();
    const shell =
      '<!doctype html><html><head><title>ProVinyl — Collection</title>' +
      '<meta name="description" content="default desc">' +
      '<meta property="og:title" content="DEFAULT OG">' +
      '<link rel="icon" href="/assets/logo.png">' +
      '<script type="module" crossorigin src="/assets/index-abc123.js"></script>' +
      '</head><body><div id="root"></div></body></html>';
    vi.mocked(getPublicProfile).mockResolvedValue(profile);
    const fetchMock = vi.fn(async () => new Response(shell, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await request(app).get('/u/jonesy');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">'); // SPA shell preserved → humans get the app
      expect(res.text).toMatch(/src="https?:\/\/[^"]+\/assets\/index-abc123\.js"/); // asset URL absolutized
      expect(res.text).toContain('property="og:image"'); // per-user OG injected
      expect(res.text).toContain('/card/jonesy.png');
      expect(res.text).toContain('312');
      expect(res.text).not.toContain('DEFAULT OG'); // default OG stripped
      expect(res.headers['content-security-policy']).toBeUndefined(); // app runs unrestricted
    } finally {
      vi.unstubAllGlobals();
      cacheClear();
    }
  });

  it('renders the OG card PNG, embeddable cross-site', async () => {
    vi.mocked(getPublicProfile).mockResolvedValue(profile);
    const res = await request(app).get('/card/jonesy.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.body.length).toBeGreaterThan(1000);
    // PNG magic number
    expect(res.body.slice(0, 4).toString('hex')).toBe('89504e47');
  });

  it('404s an unknown or private collection', async () => {
    vi.mocked(getPublicProfile).mockResolvedValue(null);
    const page = await request(app).get('/u/ghost');
    expect(page.status).toBe(404);
    expect(page.text).toContain("private or doesn't exist");
    const card = await request(app).get('/card/ghost.png');
    expect(card.status).toBe(404);
  });
});
