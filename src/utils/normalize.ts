import {
  DiscogsCollectionRelease,
  DiscogsWantlistItem,
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsPagination,
} from '../types/discogs.types';
import {
  ApiCollectionItem,
  ApiWantlistItem,
  ApiReleaseDetail,
  ApiSearchResult,
  ApiPagination,
  ApiArtist,
  ApiLabel,
  ApiFormat,
} from '../types/api.types';

function normalizeArtists(artists: { name: string; anv: string; role: string }[]): ApiArtist[] {
  return (artists ?? []).map((a) => ({ name: a.anv || a.name, anv: a.anv, role: a.role }));
}

function normalizeLabels(labels: { name: string; catno: string }[]): ApiLabel[] {
  return (labels ?? []).map((l) => ({ name: l.name, catno: l.catno }));
}

function normalizeFormats(formats: { name: string; qty: string; descriptions: string[] }[]): ApiFormat[] {
  return (formats ?? []).map((f) => ({ name: f.name, qty: f.qty, descriptions: f.descriptions ?? [] }));
}

export function normalizePagination(p: DiscogsPagination): ApiPagination {
  return { page: p.page, pages: p.pages, per_page: p.per_page, items: p.items };
}

export function normalizeCollectionItem(r: DiscogsCollectionRelease): ApiCollectionItem {
  const bi = r.basic_information;
  return {
    instance_id: r.instance_id,
    release_id: r.id,
    date_added: r.date_added,
    folder_id: r.folder_id,
    basic_information: {
      title: bi.title,
      artists: normalizeArtists(bi.artists ?? []),
      labels: normalizeLabels(bi.labels ?? []),
      genres: bi.genres ?? [],
      styles: bi.styles ?? [],
      formats: normalizeFormats(bi.formats ?? []),
      cover_image: bi.cover_image ?? '',
      thumb: bi.thumb ?? '',
      year: bi.year ?? 0,
    },
  };
}

export function normalizeWantlistItem(w: DiscogsWantlistItem): ApiWantlistItem {
  const bi = w.basic_information;
  return {
    release_id: w.id,
    date_added: w.date_added,
    basic_information: {
      title: bi.title,
      artists: normalizeArtists(bi.artists ?? []),
      labels: normalizeLabels(bi.labels ?? []),
      genres: bi.genres ?? [],
      styles: bi.styles ?? [],
      formats: normalizeFormats(bi.formats ?? []),
      cover_image: bi.cover_image ?? '',
      thumb: bi.thumb ?? '',
      year: bi.year ?? 0,
    },
  };
}

export function normalizeRelease(r: DiscogsRelease): ApiReleaseDetail {
  return {
    id: r.id,
    title: r.title,
    artists: normalizeArtists(r.artists ?? []),
    labels: normalizeLabels(r.labels ?? []),
    formats: normalizeFormats(r.formats ?? []),
    genres: r.genres ?? [],
    styles: r.styles ?? [],
    year: r.year ?? 0,
    country: r.country ?? '',
    notes: r.notes ?? '',
    cover_image: r.images?.[0]?.uri ?? '',
    tracklist: (r.tracklist ?? []).map((t) => ({
      position: t.position,
      type_: t.type_,
      title: t.title,
      duration: t.duration,
      extraartists: normalizeArtists(t.extraartists ?? []),
    })),
    videos: (r.videos ?? [])
      .filter((v) => v.embed)
      .map((v) => ({ uri: v.uri, title: v.title, embed: v.embed })),
    discogs_url: `https://www.discogs.com/release/${r.id}`,
  };
}

export function normalizeSearchResult(s: DiscogsSearchResult, inWantlist: boolean): ApiSearchResult {
  return {
    id: s.id,
    title: s.title,
    year: s.year ?? '',
    label: s.label ?? [],
    catno: s.catno ?? '',
    genre: s.genre ?? [],
    style: s.style ?? [],
    cover_image: s.cover_image ?? '',
    thumb: s.thumb ?? '',
    format: s.format ?? [],
    country: s.country ?? '',
    in_wantlist: inWantlist,
  };
}
