/* ProVinyl — server-rendered share card (the OG-unfurl image).
 *
 * The client renders cards on a <canvas> (provinyl-web src/lib/shareCard.ts),
 * but a social-unfurl image needs a stable server URL. This is the server twin:
 * satori (flexbox/CSS → SVG, fonts embedded as vector paths) → sharp (SVG → PNG).
 * Fonts ship in src/assets/fonts so output is identical regardless of the host's
 * installed fonts. See docs/public-pages.md §3 & §6.
 *
 * One mode for now — Collection, at OG size (1200×630) — mirroring the dark
 * theme of the in-app card. Value is intentionally omitted (a public card must
 * not publish a user's estimated value; docs/public-pages.md §5). */

import fs from 'fs';
import path from 'path';
import satori from 'satori';
import sharp from 'sharp';

const ASSETS = path.join(__dirname, '../assets');
const FONT_DIR = path.join(ASSETS, 'fonts');
const read = (p: string) => fs.readFileSync(p);

// Loaded once at module init (the build copies src/assets → dist/assets).
const FONTS = [
  { name: 'Anton', data: read(path.join(FONT_DIR, 'Anton-Regular.ttf')), weight: 400 as const, style: 'normal' as const },
  { name: 'Poppins', data: read(path.join(FONT_DIR, 'Poppins-Medium.ttf')), weight: 500 as const, style: 'normal' as const },
  { name: 'Poppins', data: read(path.join(FONT_DIR, 'Poppins-SemiBold.ttf')), weight: 600 as const, style: 'normal' as const },
  { name: 'Poppins', data: read(path.join(FONT_DIR, 'Poppins-Bold.ttf')), weight: 700 as const, style: 'normal' as const },
  { name: 'Space Mono', data: read(path.join(FONT_DIR, 'SpaceMono-Regular.ttf')), weight: 400 as const, style: 'normal' as const },
];

const LOGO_DATA_URI = `data:image/png;base64,${read(path.join(ASSETS, 'logo-mark-white.png')).toString('base64')}`;

const COL = { gold: '#d3a14d', ink: '#ecebf2', dim: '#a4a1b3', faint: '#6f6c78' };

/** One cover in the strip: a real Discogs image (pre-fetched to a data URI) or a
 *  procedural swatch (palette bg + accent), mirroring the client's fallback. */
export interface CardTile {
  img?: string; // data URI
  bg: string;
  accent: string;
}

export interface CollectionCardData {
  username: string;
  count: number;
  topGenres: string[];
  tiles: CardTile[];
}

// Minimal React-element factory so we can describe the layout without JSX.
type El = { type: string; props: Record<string, unknown> };
function h(type: string, style: Record<string, unknown>, children?: unknown): El {
  return { type, props: { style, children } };
}

const OG_W = 1200;
const OG_H = 630;
const TILE = 140;
const TILES = 7;

/** A raw satori <img> element (src is a prop, not a style). */
function img(src: string, w: number, h_: number, style: Record<string, unknown> = {}): El {
  return { type: 'img', props: { src, width: w, height: h_, style: { width: w, height: h_, ...style } } };
}

function tileEl(t: CardTile): El {
  if (t.img) {
    return h(
      'div',
      { display: 'flex', width: TILE, height: TILE, borderRadius: 16, overflow: 'hidden' },
      [img(t.img, TILE, TILE, { objectFit: 'cover' })],
    );
  }
  // procedural swatch: palette bg with a centered "record" dot (client fallback)
  return h(
    'div',
    { display: 'flex', width: TILE, height: TILE, borderRadius: 16, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
    [
      h(
        'div',
        { display: 'flex', width: TILE * 0.42, height: TILE * 0.42, borderRadius: TILE, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
        [h('div', { display: 'flex', width: TILE * 0.1, height: TILE * 0.1, borderRadius: TILE, backgroundColor: t.bg }, undefined)],
      ),
    ],
  );
}

function layout(data: CollectionCardData): El {
  const handle = '@' + (data.username.length > 16 ? data.username.slice(0, 15) + '…' : data.username);
  const tiles = data.tiles.slice(0, TILES);

  return h(
    'div',
    {
      display: 'flex', flexDirection: 'column', width: OG_W, height: OG_H, padding: '56px 60px',
      backgroundColor: '#16141f',
      backgroundImage: 'linear-gradient(135deg, #262332 0%, #16141f 55%, #100e16 100%)',
      fontFamily: 'Poppins', color: COL.ink,
    },
    [
      // header
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
        h('div', { display: 'flex', alignItems: 'center' }, [
          { type: 'img', props: { src: LOGO_DATA_URI, width: 50, height: 50, style: { width: 50, height: 50, marginRight: 16 } } },
          h('div', { fontSize: 42, fontWeight: 700, letterSpacing: -1 }, 'ProVinyl'),
        ]),
        h('div', { fontSize: 28, fontWeight: 600, color: COL.gold }, handle),
      ]),
      // hero
      h('div', { display: 'flex', flexDirection: 'column', marginTop: 30 }, [
        h('div', { display: 'flex', fontFamily: 'Anton', fontSize: 150, lineHeight: 0.84, color: COL.ink }, String(data.count)),
        h('div', { display: 'flex', fontSize: 34, fontWeight: 500, color: COL.dim, marginTop: 14 }, 'records in the collection'),
        data.topGenres.length
          ? h('div', { display: 'flex', fontSize: 30, fontWeight: 600, color: COL.gold, marginTop: 16 }, data.topGenres.join('   ·   '))
          : h('div', {}, undefined),
      ]),
      // covers
      h('div', { display: 'flex', marginTop: 'auto', gap: 16 }, tiles.map(tileEl)),
      // footer
      h('div', { display: 'flex', justifyContent: 'space-between', marginTop: 22, fontFamily: 'Space Mono', fontSize: 20, color: COL.faint }, [
        h('div', { display: 'flex' }, 'provinyl.io'),
        h('div', { display: 'flex' }, 'Data provided by Discogs'),
      ]),
    ],
  );
}

/** Fetch one Discogs cover (server-side — no browser CORS limit) and inline it
 *  as a resized PNG data URI. Returns the swatch on any failure so a card never
 *  shows a blank tile. */
async function embedOne(tile: { url?: string; bg: string; accent: string }): Promise<CardTile> {
  if (!tile.url) return { bg: tile.bg, accent: tile.accent };
  try {
    const res = await fetch(tile.url, { headers: { 'User-Agent': 'ProVinyl/1.0 (+https://provinyl.io)' } });
    if (!res.ok) throw new Error(`cover ${res.status}`);
    const src = Buffer.from(await res.arrayBuffer());
    const png = await sharp(src).resize(TILE * 2, TILE * 2, { fit: 'cover' }).png().toBuffer();
    return { img: `data:image/png;base64,${png.toString('base64')}`, bg: tile.bg, accent: tile.accent };
  } catch {
    return { bg: tile.bg, accent: tile.accent };
  }
}

/** Resolve profile tiles (cover URL or swatch) into card tiles with inlined art. */
export function embedCovers(tiles: { url?: string; bg: string; accent: string }[]): Promise<CardTile[]> {
  return Promise.all(tiles.map(embedOne));
}

/** Render the OG collection card to a PNG buffer (1200×630). */
export async function renderCollectionCard(data: CollectionCardData): Promise<Buffer> {
  const svg = await satori(layout(data) as unknown as Parameters<typeof satori>[0], {
    width: OG_W,
    height: OG_H,
    fonts: FONTS,
  });
  return sharp(Buffer.from(svg)).png().toBuffer();
}
