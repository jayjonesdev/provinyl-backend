import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock the Discogs-backed summary so the route + satori/sharp render run for
// real without network. (The render itself is exercised end-to-end.)
vi.mock('./services/publicProfileService', () => ({ getPublicProfile: vi.fn() }));
import { getPublicProfile } from './services/publicProfileService';
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
