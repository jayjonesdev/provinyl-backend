import { describe, it, expect } from 'vitest';
import {
  joinArtists,
  parseYouTubeId,
  collectionItemToRelease,
  wantlistItemToRelease,
  releaseToRelease,
  searchResultToRelease,
} from './toRelease';
import type {
  DiscogsArtist,
  DiscogsBasicInformation,
  DiscogsCollectionRelease,
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsWantlistItem,
} from '../types/discogs.types';

// ── fixtures ──────────────────────────────────────────────────────────────
function artist(p: Partial<DiscogsArtist> = {}): DiscogsArtist {
  return { name: 'Artist', anv: '', join: '', role: '', tracks: '', id: 1, resource_url: '', ...p };
}

function basicInfo(p: Partial<DiscogsBasicInformation> = {}): DiscogsBasicInformation {
  return {
    id: 305571,
    title: 'Blue Train',
    year: 1957,
    resource_url: '',
    thumb: 'thumb.jpg',
    cover_image: 'cover.jpg',
    formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] }],
    labels: [{ name: 'Blue Note', catno: 'BLP 1577', entity_type: '', entity_type_name: '', id: 1, resource_url: '' }],
    artists: [artist({ name: 'John Coltrane' })],
    genres: ['Jazz'],
    styles: ['Hard Bop'],
    ...p,
  };
}

// ── joinArtists ───────────────────────────────────────────────────────────
describe('joinArtists', () => {
  it('returns a single artist name', () => {
    expect(joinArtists([artist({ name: 'John Coltrane' })])).toBe('John Coltrane');
  });
  it('prefers the name variation (anv) when present', () => {
    expect(joinArtists([artist({ name: 'Miles Davis (2)', anv: 'Miles Davis' })])).toBe('Miles Davis');
  });
  it('honors join connectors between artists', () => {
    const out = joinArtists([artist({ name: 'Jay-Z', join: '&' }), artist({ name: 'Kanye West' })]);
    expect(out).toBe('Jay-Z & Kanye West');
  });
  it('defaults to a comma when no join is given', () => {
    expect(joinArtists([artist({ name: 'A' }), artist({ name: 'B' })])).toBe('A, B');
  });
  it('handles empty / undefined', () => {
    expect(joinArtists([])).toBe('');
    expect(joinArtists(undefined)).toBe('');
  });
});

// ── parseYouTubeId ────────────────────────────────────────────────────────
describe('parseYouTubeId', () => {
  it('parses watch URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=ar5g8Ftt-bo')).toBe('ar5g8Ftt-bo');
  });
  it('parses youtu.be URLs', () => {
    expect(parseYouTubeId('https://youtu.be/te2jJncBVG4')).toBe('te2jJncBVG4');
  });
  it('parses embed URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/SK-2gC93s7Y')).toBe('SK-2gC93s7Y');
  });
  it('returns empty string for non-YouTube or empty uris', () => {
    expect(parseYouTubeId('https://vimeo.com/12345')).toBe('');
    expect(parseYouTubeId('')).toBe('');
  });
});

// ── collectionItemToRelease ───────────────────────────────────────────────
describe('collectionItemToRelease', () => {
  const item: DiscogsCollectionRelease = {
    id: 305571,
    instance_id: 99,
    date_added: '2024-05-12T10:30:00-07:00',
    folder_id: 1,
    rating: 5,
    basic_information: basicInfo(),
  };

  it('maps list-level fields', () => {
    const r = collectionItemToRelease(item);
    expect(r.id).toBe(305571);
    expect(r.title).toBe('Blue Train');
    expect(r.artist).toBe('John Coltrane');
    expect(r.year).toBe(1957);
    expect(r.formatMain).toBe('Vinyl');
    expect(r.formats[0].descriptions).toEqual(['LP', 'Album']);
    expect(r.labels[0]).toEqual({ name: 'Blue Note', catno: 'BLP 1577' });
    expect(r.coverImage).toBe('cover.jpg');
    expect(r.list).toBe('collection');
    expect(r.instanceId).toBe(99);
  });

  it('uses the owner rating and truncates date_added to YYYY-MM-DD', () => {
    const r = collectionItemToRelease(item);
    expect(r.rating).toEqual({ avg: 5, count: 0 });
    expect(r.dateAdded).toBe('2024-05-12');
  });

  it('defaults detail-only and owner fields that list data lacks', () => {
    const r = collectionItemToRelease(item);
    expect(r.have).toBe(0);
    expect(r.lowestPrice).toBe(0);
    expect(r.tracklist).toEqual([]);
    expect(r.videos).toEqual([]);
    expect(r.value).toBe(0);
    expect(r.condition).toEqual({ media: '—', sleeve: '—' });
  });

  it('assigns a deterministic procedural cover', () => {
    expect(collectionItemToRelease(item).art).toEqual(collectionItemToRelease(item).art);
  });
});

// ── wantlistItemToRelease ─────────────────────────────────────────────────
describe('wantlistItemToRelease', () => {
  const item: DiscogsWantlistItem = {
    id: 177008,
    date_added: '2024-01-30T00:00:00-08:00',
    rating: 0,
    notes: 'Grail. Any original Saturn pressing.',
    basic_information: basicInfo({ id: 177008, title: 'Sound-Ways Of The Future', artists: [artist({ name: 'Sun Ra' })] }),
  };

  it('maps to a wantlist Release with no instanceId', () => {
    const r = wantlistItemToRelease(item);
    expect(r.id).toBe(177008);
    expect(r.artist).toBe('Sun Ra');
    expect(r.list).toBe('wantlist');
    expect(r.notes).toBe('Grail. Any original Saturn pressing.');
    expect(r.instanceId).toBeUndefined();
    expect(r.dateAdded).toBe('2024-01-30');
  });
});

// ── releaseToRelease (detail) ─────────────────────────────────────────────
describe('releaseToRelease', () => {
  const detail: DiscogsRelease = {
    id: 305571,
    title: 'Blue Train',
    artists: [artist({ name: 'John Coltrane' })],
    labels: [{ name: 'Blue Note', catno: 'BLP 1577', entity_type: '', entity_type_name: '', id: 1, resource_url: '' }],
    formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album', 'Reissue'] }],
    genres: ['Jazz'],
    styles: ['Hard Bop'],
    year: 1957,
    country: 'US',
    notes: '180g reissue.',
    images: [{ type: 'primary', uri: 'big.jpg', resource_url: '', uri150: 'small.jpg', width: 600, height: 600 }],
    tracklist: [
      { position: '', type_: 'heading', title: 'Side A', duration: '' },
      { position: 'A1', type_: 'track', title: 'Blue Train', duration: '10:43' },
      { position: 'B1', type_: 'track', title: 'Locomotion', duration: '7:13' },
    ],
    videos: [
      { uri: 'https://www.youtube.com/watch?v=ar5g8Ftt-bo', title: 'Blue Train', description: '1957', duration: 643, embed: true },
      { uri: 'https://example.com/not-youtube', title: 'Bad', description: '', duration: 0, embed: true },
    ],
    uri: '/release/305571',
    extraartists: [artist({ name: 'John Coltrane', role: 'Tenor Saxophone' })],
    community: { have: 14000, want: 6800, rating: { count: 2100, average: 4.8 } },
    lowest_price: 20,
    num_for_sale: 300,
  };

  it('maps community rating, have/want and prices', () => {
    const r = releaseToRelease(detail, 'collection');
    expect(r.rating).toEqual({ avg: 4.8, count: 2100 });
    expect(r.have).toBe(14000);
    expect(r.want).toBe(6800);
    expect(r.lowestPrice).toBe(20);
    expect(r.numForSale).toBe(300);
    expect(r.country).toBe('US');
    expect(r.list).toBe('collection');
  });

  it('drops heading rows from the tracklist', () => {
    const r = releaseToRelease(detail, 'catalog');
    expect(r.tracklist).toHaveLength(2);
    expect(r.tracklist[0]).toEqual({ position: 'A1', title: 'Blue Train', duration: '10:43' });
  });

  it('keeps only YouTube videos, with parsed ids and desc', () => {
    const r = releaseToRelease(detail, 'catalog');
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]).toEqual({ title: 'Blue Train', desc: '1957', id: 'ar5g8Ftt-bo' });
  });

  it('maps credits from extraartists and cover from images[0]', () => {
    const r = releaseToRelease(detail, 'catalog');
    expect(r.credits).toEqual([{ role: 'Tenor Saxophone', name: 'John Coltrane' }]);
    expect(r.coverImage).toBe('big.jpg');
  });

  it('defaults gracefully when detail-only fields are absent', () => {
    const bare: DiscogsRelease = { ...detail, community: undefined, lowest_price: null, num_for_sale: undefined, extraartists: undefined };
    const r = releaseToRelease(bare, 'catalog');
    expect(r.rating).toEqual({ avg: 0, count: 0 });
    expect(r.lowestPrice).toBe(0);
    expect(r.credits).toEqual([]);
  });
});

// ── searchResultToRelease ─────────────────────────────────────────────────
describe('searchResultToRelease', () => {
  const result: DiscogsSearchResult = {
    id: 310104,
    title: 'Madvillain - Madvillainy',
    year: '2004',
    label: ['Stones Throw'],
    catno: 'STH2065',
    genre: ['Hip Hop'],
    style: ['Instrumental', 'Boom Bap'],
    cover_image: 'cover.jpg',
    thumb: 'thumb.jpg',
    format: ['Vinyl', '2×LP', 'Album'],
    country: 'US',
    resource_url: '',
    type: 'release',
  };

  it('splits "Artist - Title" and maps fields', () => {
    const r = searchResultToRelease(result, false);
    expect(r.artist).toBe('Madvillain');
    expect(r.title).toBe('Madvillainy');
    expect(r.year).toBe(2004);
    expect(r.formatMain).toBe('Vinyl');
    expect(r.formats[0]).toEqual({ name: 'Vinyl', descriptions: ['2×LP', 'Album'], qty: '1' });
    expect(r.labels[0]).toEqual({ name: 'Stones Throw', catno: 'STH2065' });
    expect(r.list).toBe('catalog');
  });

  it('flags wantlist membership via list', () => {
    expect(searchResultToRelease(result, true).list).toBe('wantlist');
  });

  it('falls back to the whole title when there is no " - "', () => {
    const r = searchResultToRelease({ ...result, title: 'Compilation' }, false);
    expect(r.artist).toBe('');
    expect(r.title).toBe('Compilation');
  });
});
