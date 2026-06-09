import { getDiscogsClient, getDiscogsClientAppLevel } from '../auth/discogsOAuth';
import { runDiscogs } from './discogsResilience';
import { cached } from '../utils/cache';
import { decrypt } from '../utils/crypto';
import logger from '../utils/logger';
import {
  DiscogsCollectionResponse,
  DiscogsCollectionRelease,
  DiscogsWantlistResponse,
  DiscogsWantlistItem,
  DiscogsRelease,
  DiscogsSearchResponse,
  DiscogsCollectionValue,
  DiscogsIdentity,
  DiscogsProfile,
  DiscogsReleaseInstancesResponse,
} from '../types/discogs.types';
import type { IUser } from '../types';

// Cache TTLs: release details are effectively immutable; searches change rarely.
const RELEASE_TTL_MS = 60 * 60 * 1000; // 1h
const SEARCH_TTL_MS = 5 * 60 * 1000; // 5m

// All-pages aggregation bounds.
const PER_PAGE = 100;
const MAX_PAGES = 100; // 10k items — log and stop beyond this.

function promisify<T>(fn: (cb: (err: Error | null, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/** Promisify a disconnect call and run it under the resilience layer (cap + 429 retry). */
function call<T>(fn: (cb: (err: Error | null, data: T) => void) => void): Promise<T> {
  return runDiscogs(() => promisify<T>(fn));
}

/** Fetch page 1, then the remaining pages in parallel, concatenating all items. */
async function aggregate<T>(
  pageFn: (page: number) => Promise<{ items: T[]; pages: number }>,
): Promise<T[]> {
  const first = await pageFn(1);
  const items = [...first.items];
  const pages = Math.min(first.pages, MAX_PAGES);
  if (first.pages > MAX_PAGES) {
    logger.warn({ totalPages: first.pages, cap: MAX_PAGES }, 'Discogs list truncated at page cap');
  }
  const rest: Promise<{ items: T[]; pages: number }>[] = [];
  for (let p = 2; p <= pages; p++) rest.push(pageFn(p));
  for (const r of await Promise.all(rest)) items.push(...r.items);
  return items;
}

function searchKey(query: string, params: Record<string, string | number>): string {
  return 'search:' + JSON.stringify({ query, ...params });
}

/** Build a per-user Discogs client from a stored user, decrypting their OAuth tokens. */
export function createUserClientFor(user: IUser) {
  return createUserClient(decrypt(user.discogsAccessToken), decrypt(user.discogsAccessTokenSecret));
}

export function createUserClient(accessToken: string, accessTokenSecret: string) {
  const client = getDiscogsClient(accessToken, accessTokenSecret);
  const db = client.database();
  const col = client.user().collection();
  const wl = client.user().wantlist();

  const api = {
    getCollection(username: string, page: number, perPage: number): Promise<DiscogsCollectionResponse> {
      return call<DiscogsCollectionResponse>((cb) =>
        col.getReleases(username, 0, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    /** Every page of the collection, aggregated. */
    getAllCollection(username: string): Promise<DiscogsCollectionRelease[]> {
      return aggregate((page) =>
        api.getCollection(username, page, PER_PAGE).then((d) => ({
          items: d.releases ?? [],
          pages: d.pagination.pages,
        })),
      );
    },

    getWantlist(username: string, page: number, perPage: number): Promise<DiscogsWantlistResponse> {
      return call<DiscogsWantlistResponse>((cb) =>
        wl.getReleases(username, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    /** Every page of the wantlist, aggregated. */
    getAllWantlist(username: string): Promise<DiscogsWantlistItem[]> {
      return aggregate((page) =>
        api.getWantlist(username, page, PER_PAGE).then((d) => ({
          items: d.wants ?? [],
          pages: d.pagination.pages,
        })),
      );
    },

    getCollectionValue(username: string): Promise<DiscogsCollectionValue> {
      return call<DiscogsCollectionValue>((cb) => client.get(`/users/${username}/collection/value`, cb));
    },

    /** All copies of a release the user owns (instance + folder ids). */
    getReleaseInstances(username: string, releaseId: number): Promise<DiscogsReleaseInstancesResponse> {
      return call<DiscogsReleaseInstancesResponse>((cb) =>
        client.get(`/users/${username}/collection/releases/${releaseId}`, cb),
      );
    },

    addToCollection(username: string, releaseId: number): Promise<unknown> {
      return call<unknown>((cb) => col.addRelease(username, 1, releaseId, cb));
    },

    removeFromCollection(
      username: string,
      releaseId: number,
      instanceId: number,
      folderId: number,
    ): Promise<unknown> {
      return call<unknown>((cb) => col.removeRelease(username, folderId, releaseId, instanceId, cb));
    },

    addToWantlist(username: string, releaseId: number): Promise<unknown> {
      return call<unknown>((cb) => wl.addRelease(username, releaseId, cb));
    },

    removeFromWantlist(username: string, releaseId: number): Promise<unknown> {
      return call<unknown>((cb) => wl.removeRelease(username, releaseId, cb));
    },

    searchDatabase(query: string, params: Record<string, string | number>): Promise<DiscogsSearchResponse> {
      return cached(searchKey(query, params), SEARCH_TTL_MS, () =>
        call<DiscogsSearchResponse>((cb) => db.search({ q: query, ...params, format: 'Vinyl' }, cb)),
      );
    },

    getRelease(releaseId: number): Promise<DiscogsRelease> {
      return cached(`release:${releaseId}`, RELEASE_TTL_MS, () =>
        call<DiscogsRelease>((cb) => db.getRelease(releaseId, cb)),
      );
    },

    getIdentity(): Promise<DiscogsIdentity> {
      return call<DiscogsIdentity>((cb) => client.getIdentity(cb));
    },

    getProfile(username: string): Promise<DiscogsProfile> {
      return call<DiscogsProfile>((cb) => client.user().getProfile(username, cb));
    },
  };

  return api;
}

export function createAppClient() {
  const client = getDiscogsClientAppLevel();
  const db = client.database();
  const col = client.user().collection();

  const api = {
    getPublicCollection(username: string, page: number, perPage: number): Promise<DiscogsCollectionResponse> {
      return call<DiscogsCollectionResponse>((cb) =>
        col.getReleases(username, 0, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    getAllPublicCollection(username: string): Promise<DiscogsCollectionRelease[]> {
      return aggregate((page) =>
        api.getPublicCollection(username, page, PER_PAGE).then((d) => ({
          items: d.releases ?? [],
          pages: d.pagination.pages,
        })),
      );
    },

    searchDatabase(query: string, params: Record<string, string | number>): Promise<DiscogsSearchResponse> {
      return cached(searchKey(query, params), SEARCH_TTL_MS, () =>
        call<DiscogsSearchResponse>((cb) => db.search({ q: query, ...params, format: 'Vinyl' }, cb)),
      );
    },

    getRelease(releaseId: number): Promise<DiscogsRelease> {
      return cached(`release:${releaseId}`, RELEASE_TTL_MS, () =>
        call<DiscogsRelease>((cb) => db.getRelease(releaseId, cb)),
      );
    },
  };

  return api;
}
