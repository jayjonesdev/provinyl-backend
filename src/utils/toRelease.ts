/* ProVinyl — Discogs → Release mappers.
 *
 * The backend owns the contract: every endpoint returns the frontend's `Release`
 * shape. List endpoints (collection/wantlist/search) can only fill what Discogs
 * returns in list data; rating/have/want/prices/tracklist/videos/credits are
 * populated from the release-detail endpoint (see `releaseToRelease`). Per-item
 * `value` and `condition` have no list-level Discogs source and default out.
 */

import type {
  DiscogsArtist,
  DiscogsCollectionFieldDef,
  DiscogsCollectionRelease,
  DiscogsFormat,
  DiscogsInstanceField,
  DiscogsLabel,
  DiscogsPagination,
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsWantlistItem,
} from '../types/discogs.types';
import type { Condition, Credit, Format, Label, ListKind, Release, Track, Video } from '../types/release';
import type { Pagination } from '../types/responses';
import { artForId } from './coverFallback';

const UNGRADED = '—';
const EMPTY_CONDITION = { media: UNGRADED, sleeve: UNGRADED };

/** The custom-field ids that hold Media/Sleeve grading for a user's collection. */
export interface GradeFieldIds {
  media?: number;
  sleeve?: number;
}

/** Map collection field definitions to the Media/Sleeve Condition field ids. */
export function gradeFieldIdsFrom(fields: DiscogsCollectionFieldDef[] | undefined): GradeFieldIds {
  const ids: GradeFieldIds = {};
  for (const f of fields ?? []) {
    const name = f.name.toLowerCase();
    if (name.includes('media')) ids.media = f.id;
    else if (name.includes('sleeve')) ids.sleeve = f.id;
  }
  return ids;
}

/** Read an instance's grade values from its custom-field notes. */
function readCondition(notes: DiscogsInstanceField[] | undefined, ids: GradeFieldIds | undefined): Condition {
  if (!notes || !ids) return { ...EMPTY_CONDITION };
  const valueOf = (fieldId?: number): string =>
    fieldId == null ? '' : (notes.find((n) => n.field_id === fieldId)?.value ?? '');
  return {
    media: valueOf(ids.media) || UNGRADED,
    sleeve: valueOf(ids.sleeve) || UNGRADED,
  };
}

/** Join Discogs artists into a single display string, honoring `join` connectors. */
export function joinArtists(artists: DiscogsArtist[] | undefined): string {
  if (!artists || artists.length === 0) return '';
  let out = '';
  artists.forEach((a, i) => {
    out += (a.anv && a.anv.trim()) || a.name;
    const last = i === artists.length - 1;
    if (last) return;
    const join = a.join && a.join.trim();
    out += join ? (join === ',' ? ', ' : ` ${join} `) : ', ';
  });
  return out.trim();
}

function mapFormats(formats: DiscogsFormat[] | undefined): Format[] {
  return (formats ?? []).map((f) => ({
    name: f.name,
    descriptions: f.descriptions ?? [],
    qty: f.qty,
  }));
}

function mapLabels(labels: DiscogsLabel[] | undefined): Label[] {
  return (labels ?? []).map((l) => ({ name: l.name, catno: l.catno }));
}

/** Extract an 11-char YouTube id from a Discogs video uri; '' if not YouTube. */
export function parseYouTubeId(uri: string): string {
  if (!uri) return '';
  const m = uri.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : '';
}

export function mapPagination(p: DiscogsPagination): Pagination {
  return { page: p.page, pages: p.pages, per_page: p.per_page, items: p.items };
}

/** Collection list item → Release (list-level fields only). Pass the user's grade
 * field ids to surface Media/Sleeve condition from the instance's custom fields. */
export function collectionItemToRelease(
  item: DiscogsCollectionRelease,
  gradeFieldIds?: GradeFieldIds,
): Release {
  const bi = item.basic_information;
  return {
    id: item.id,
    title: bi.title,
    artist: joinArtists(bi.artists),
    year: bi.year ?? 0,
    country: '',
    genres: bi.genres ?? [],
    styles: bi.styles ?? [],
    formatMain: bi.formats?.[0]?.name ?? '',
    formats: mapFormats(bi.formats),
    labels: mapLabels(bi.labels),
    // The collection item carries the OWNER's personal rating (0 when unrated).
    rating: { avg: item.rating ?? 0, count: 0 },
    have: 0,
    want: 0,
    lowestPrice: 0,
    numForSale: 0,
    tracklist: [],
    videos: [],
    credits: [],
    notes: '',
    art: artForId(item.id),
    value: 0,
    personalRating: 0,
    personalNote: '',
    condition: readCondition(item.notes, gradeFieldIds),
    dateAdded: (item.date_added ?? '').slice(0, 10),
    list: 'collection',
    coverImage: bi.cover_image ?? '',
    instanceId: item.instance_id,
  };
}

/** Wantlist item → Release (list-level fields only). */
export function wantlistItemToRelease(item: DiscogsWantlistItem): Release {
  const bi = item.basic_information;
  return {
    id: item.id,
    title: bi.title,
    artist: joinArtists(bi.artists),
    year: bi.year ?? 0,
    country: '',
    genres: bi.genres ?? [],
    styles: bi.styles ?? [],
    formatMain: bi.formats?.[0]?.name ?? '',
    formats: mapFormats(bi.formats),
    labels: mapLabels(bi.labels),
    rating: { avg: item.rating ?? 0, count: 0 },
    have: 0,
    want: 0,
    lowestPrice: 0,
    numForSale: 0,
    tracklist: [],
    videos: [],
    credits: [],
    notes: item.notes ?? '',
    art: artForId(item.id),
    value: 0,
    personalRating: 0,
    personalNote: '',
    condition: { ...EMPTY_CONDITION },
    dateAdded: (item.date_added ?? '').slice(0, 10),
    list: 'wantlist',
    coverImage: bi.cover_image ?? '',
  };
}

/** Full release detail → Release. `list` reflects which library the user opened it from. */
export function releaseToRelease(r: DiscogsRelease, list: ListKind): Release {
  return {
    id: r.id,
    title: r.title,
    artist: joinArtists(r.artists),
    year: r.year ?? 0,
    country: r.country ?? '',
    genres: r.genres ?? [],
    styles: r.styles ?? [],
    formatMain: r.formats?.[0]?.name ?? '',
    formats: mapFormats(r.formats),
    labels: mapLabels(r.labels),
    rating: {
      avg: r.community?.rating?.average ?? 0,
      count: r.community?.rating?.count ?? 0,
    },
    have: r.community?.have ?? 0,
    want: r.community?.want ?? 0,
    lowestPrice: r.lowest_price ?? 0,
    numForSale: r.num_for_sale ?? 0,
    tracklist: (r.tracklist ?? [])
      .filter((t) => !t.type_ || t.type_ === 'track')
      .map<Track>((t) => ({ position: t.position, title: t.title, duration: t.duration })),
    videos: (r.videos ?? [])
      .map<Video>((v) => ({ title: v.title, desc: v.description ?? '', id: parseYouTubeId(v.uri) }))
      .filter((v) => v.id),
    credits: (r.extraartists ?? []).map<Credit>((c) => ({
      role: c.role,
      name: (c.anv && c.anv.trim()) || c.name,
    })),
    notes: r.notes ?? '',
    art: artForId(r.id),
    value: 0,
    personalRating: 0,
    personalNote: '',
    condition: { ...EMPTY_CONDITION },
    dateAdded: '',
    list,
    coverImage: r.images?.[0]?.uri ?? '',
  };
}

/** Discogs search result → Release (catalog entry for the Add flow). */
export function searchResultToRelease(s: DiscogsSearchResult, inWantlist: boolean): Release {
  // Discogs search titles are "Artist - Title"; split on the first " - ".
  const dash = s.title.indexOf(' - ');
  const artist = dash >= 0 ? s.title.slice(0, dash) : '';
  const title = dash >= 0 ? s.title.slice(dash + 3) : s.title;
  const formats = s.format ?? [];
  return {
    id: s.id,
    title,
    artist,
    year: parseInt(s.year, 10) || 0,
    country: s.country ?? '',
    genres: s.genre ?? [],
    styles: s.style ?? [],
    formatMain: formats[0] ?? '',
    formats: formats.length ? [{ name: formats[0], descriptions: formats.slice(1), qty: '1' }] : [],
    labels: (s.label ?? []).map((name, i) => ({ name, catno: i === 0 ? (s.catno ?? '') : '' })),
    rating: { avg: 0, count: 0 },
    have: 0,
    want: 0,
    lowestPrice: 0,
    numForSale: 0,
    tracklist: [],
    videos: [],
    credits: [],
    notes: '',
    art: artForId(s.id),
    value: 0,
    personalRating: 0,
    personalNote: '',
    condition: { ...EMPTY_CONDITION },
    dateAdded: '',
    // Collection membership is determined client-side from the loaded lists;
    // we only know wantlist membership here.
    list: inWantlist ? 'wantlist' : 'catalog',
    coverImage: s.cover_image ?? '',
  };
}
