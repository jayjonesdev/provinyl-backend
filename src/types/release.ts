/* ProVinyl — the Release contract.
 *
 * This MIRRORS the frontend's `Release` (provinyl-web/src/types.ts): the backend
 * owns the Discogs → Release mapping so the SPA's data layer stays a thin fetch.
 * Two backend-added fields:
 *   - coverImage: real Discogs art URL (the procedural `art` is the fallback)
 *   - instanceId: Discogs collection instance id (needed to remove a copy)
 *
 * Keep this in lockstep with the frontend type. (Later: extract a shared
 * @provinyl/contracts package consumed by both repos.)
 */

export type ListKind = 'collection' | 'wantlist' | 'catalog';

/** Procedural cover-art templates (frontend src/components/Cover.tsx). */
export type CoverTemplate =
  | 'bluenote'
  | 'portrait'
  | 'minimal'
  | 'display'
  | 'label'
  | 'classic'
  | 'split'
  | 'promo';

export interface CoverArt {
  tpl: CoverTemplate;
  /** Palette key from the frontend's src/data/palettes.ts. */
  pal: string;
}

export interface Format {
  name: string;
  descriptions: string[];
  qty: string;
}

export interface Label {
  name: string;
  catno: string;
}

export interface Rating {
  avg: number;
  count: number;
}

export interface Track {
  position: string;
  title: string;
  duration: string;
}

export interface Video {
  title: string;
  desc: string;
  /** YouTube video id, parsed from the Discogs video uri. */
  id: string;
}

export interface Credit {
  role: string;
  name: string;
}

export interface Condition {
  media: string;
  sleeve: string;
}

export interface Release {
  id: number;
  title: string;
  artist: string;
  year: number;
  country: string;
  genres: string[];
  styles: string[];
  formatMain: string;
  formats: Format[];
  labels: Label[];
  rating: Rating;
  have: number;
  want: number;
  lowestPrice: number;
  numForSale: number;
  tracklist: Track[];
  videos: Video[];
  credits: Credit[];
  notes: string;
  art: CoverArt;

  // owner fields
  value: number;
  condition: Condition;
  /** Owner's personal 1–5 star rating; 0 = unrated. */
  personalRating: number;
  /** ISO date (YYYY-MM-DD); "" when not applicable. */
  dateAdded: string;
  list: ListKind;

  // backend additions
  /** Real Discogs cover art URL; empty string when unavailable. */
  coverImage: string;
  /** Discogs collection instance id (collection items only). */
  instanceId?: number;
}
