import { getDiscogsClient, getDiscogsClientAppLevel } from '../auth/discogsOAuth';
import {
  DiscogsCollectionResponse,
  DiscogsWantlistResponse,
  DiscogsRelease,
  DiscogsSearchResponse,
  DiscogsCollectionValue,
} from '../types/discogs.types';

function promisify<T>(fn: (cb: (err: Error | null, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export function createUserClient(accessToken: string, accessTokenSecret: string) {
  const client = getDiscogsClient(accessToken, accessTokenSecret);
  const db = client.database();
  const col = client.user().collection();
  const wl = client.user().wantlist();

  return {
    getCollection(username: string, page: number, perPage: number): Promise<DiscogsCollectionResponse> {
      return promisify<DiscogsCollectionResponse>((cb) =>
        col.getReleases(username, 0, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    getWantlist(username: string, page: number, perPage: number): Promise<DiscogsWantlistResponse> {
      return promisify<DiscogsWantlistResponse>((cb) =>
        wl.getReleases(username, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    getCollectionValue(username: string): Promise<DiscogsCollectionValue> {
      return promisify<DiscogsCollectionValue>((cb) =>
        client.get(`/users/${username}/collection/value`, cb),
      );
    },

    addToCollection(username: string, releaseId: number): Promise<unknown> {
      return promisify<unknown>((cb) =>
        col.addRelease(username, 1, releaseId, cb),
      );
    },

    removeFromCollection(username: string, releaseId: number, instanceId: number): Promise<unknown> {
      return promisify<unknown>((cb) =>
        col.removeRelease(username, 0, releaseId, instanceId, cb),
      );
    },

    addToWantlist(username: string, releaseId: number): Promise<unknown> {
      return promisify<unknown>((cb) =>
        wl.addRelease(username, releaseId, cb),
      );
    },

    removeFromWantlist(username: string, releaseId: number): Promise<unknown> {
      return promisify<unknown>((cb) =>
        wl.removeRelease(username, releaseId, cb),
      );
    },

    searchDatabase(query: string, params: Record<string, string | number>): Promise<DiscogsSearchResponse> {
      return promisify<DiscogsSearchResponse>((cb) =>
        db.search({ q: query, ...params, format: 'Vinyl' }, cb),
      );
    },

    getRelease(releaseId: number): Promise<DiscogsRelease> {
      return promisify<DiscogsRelease>((cb) =>
        db.getRelease(releaseId, cb),
      );
    },
  };
}

export function createAppClient() {
  const client = getDiscogsClientAppLevel();
  const db = client.database();
  const col = client.user().collection();

  return {
    getPublicCollection(username: string, page: number, perPage: number): Promise<DiscogsCollectionResponse> {
      return promisify<DiscogsCollectionResponse>((cb) =>
        col.getReleases(username, 0, { page, per_page: perPage, sort: 'artist', sort_order: 'asc' }, cb),
      );
    },

    searchDatabase(query: string, params: Record<string, string | number>): Promise<DiscogsSearchResponse> {
      return promisify<DiscogsSearchResponse>((cb) =>
        db.search({ q: query, ...params, format: 'Vinyl' }, cb),
      );
    },

    getRelease(releaseId: number): Promise<DiscogsRelease> {
      return promisify<DiscogsRelease>((cb) =>
        db.getRelease(releaseId, cb),
      );
    },
  };
}
