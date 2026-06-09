/* ProVinyl — tiny in-memory TTL cache.
 *
 * Cuts repeat Discogs calls for hot reads (release detail, search). Process-local
 * — move to Redis/Mongo-TTL before scaling horizontally (plan §7).
 */

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

/** Return the cached value for `key`, or compute + store it for `ttlMs`. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClear(): void {
  store.clear();
}
