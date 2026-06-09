/* ProVinyl — deterministic procedural-cover fallback.
 *
 * Discogs gives us a `coverImage` URL, but the frontend also renders a procedural
 * cover (8-template system) as the loading/empty fallback. We assign that
 * fallback here, keyed off the release id so a given release ALWAYS gets the same
 * art (stable across requests and pagination).
 *
 * Only the templates the frontend's Cover renderer actually draws are used
 * ('promo' has no renderer and is intentionally omitted).
 */

import type { CoverArt, CoverTemplate } from '../types/release';

const TEMPLATES: CoverTemplate[] = [
  'bluenote',
  'portrait',
  'minimal',
  'display',
  'label',
  'classic',
  'split',
];

// Palette keys from the frontend's src/data/palettes.ts.
const PALETTE_KEYS = [
  'noir',
  'bluenote',
  'crimson',
  'forest',
  'plum',
  'rust',
  'teal',
  'cream',
  'mono',
  'electric',
  'peach',
  'gold',
  'sky',
  'ink',
];

/** Stable 32-bit integer hash (avalanche mix), deterministic for a given id. */
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/** Pick a stable template + palette for a release id. */
export function artForId(id: number): CoverArt {
  const h = hash(id);
  const tpl = TEMPLATES[h % TEMPLATES.length];
  const pal = PALETTE_KEYS[Math.floor(h / TEMPLATES.length) % PALETTE_KEYS.length];
  return { tpl, pal };
}
