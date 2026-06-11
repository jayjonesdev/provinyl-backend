/* ProVinyl — public collection summary for share-card OG unfurls.
 *
 * Fetches a user's PUBLIC Discogs collection (app-level creds, no user token —
 * Discogs returns 401/404 for private collections, which we surface as "not
 * found") and derives the small summary the OG card + /u page need: record
 * count, top genres, and a sampled set of covers. Cached to respect Discogs'
 * freshness window and keep unfurls fast. No value is exposed (a public card
 * must not publish a user's estimated value — docs/public-pages.md §5).
 *
 * Read-only: there is no write path here. Mutations stay owner-only and
 * authenticated (handlers/*; every mutation 403s a non-owner). */

import { createAppClient } from './discogsService';
import { collectionItemToRelease } from '../utils/toRelease';
import { cached } from '../utils/cache';
import logger from '../utils/logger';

/** bg/accent per palette key (mirrors the frontend src/data/palettes.ts) for the
 *  procedural swatch fallback when a release has no cover art. */
const PALETTE: Record<string, { bg: string; accent: string }> = {
  noir: { bg: '#16130f', accent: '#d8a24a' },
  bluenote: { bg: '#1c4f96', accent: '#edc23c' },
  crimson: { bg: '#7c2026', accent: '#e3a73f' },
  forest: { bg: '#1d3e34', accent: '#dd9150' },
  plum: { bg: '#3a2348', accent: '#d98ca6' },
  rust: { bg: '#9d4a23', accent: '#f1c34d' },
  teal: { bg: '#0f5f63', accent: '#f0ba4c' },
  cream: { bg: '#e9dec9', accent: '#b5462f' },
  mono: { bg: '#e6e4df', accent: '#7a7a7a' },
  electric: { bg: '#1f232c', accent: '#6cc6d8' },
  peach: { bg: '#e7a079', accent: '#f5ddc7' },
  gold: { bg: '#c39a3f', accent: '#f6eccf' },
  sky: { bg: '#3f7fb3', accent: '#f2c84f' },
  ink: { bg: '#222732', accent: '#c98b5a' },
};

export interface ProfileTile {
  /** Real Discogs cover URL, or undefined → render the swatch. */
  url?: string;
  bg: string;
  accent: string;
}

export interface PublicProfile {
  username: string;
  count: number;
  topGenres: string[];
  tiles: ProfileTile[];
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — Discogs freshness window
const TILE_SAMPLE = 7;

function tallyTop(values: string[], n: number): string[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** Evenly sample up to `n` items across the array (deterministic). */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

/**
 * Public collection summary, or `null` when the collection is private / the user
 * doesn't exist (Discogs errors on the fetch). Cached for 6h per username.
 */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  return cached(`public-profile:${username.toLowerCase()}`, TTL_MS, async () => {
    try {
      const raw = await createAppClient().getAllPublicCollection(username);
      const releases = raw.map((r) => collectionItemToRelease(r));
      if (releases.length === 0) return null;

      const withCover = releases.filter((r) => r.coverImage);
      const pool = withCover.length ? withCover : releases;
      const tiles: ProfileTile[] = sample(pool, TILE_SAMPLE).map((r) => {
        const pal = PALETTE[r.art?.pal] ?? PALETTE.noir;
        return { url: r.coverImage || undefined, bg: pal.bg, accent: pal.accent };
      });

      return {
        username,
        count: releases.length,
        topGenres: tallyTop(releases.flatMap((r) => r.genres), 3),
        tiles,
      };
    } catch (err) {
      logger.warn({ err, username }, 'Public profile fetch failed (private or unknown user)');
      return null;
    }
  });
}
