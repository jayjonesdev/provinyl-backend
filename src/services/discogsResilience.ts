/* ProVinyl — Discogs request resilience.
 *
 * Wraps every Discogs call so the service respects the API's rate limit
 * (60 req/min authenticated) and survives transient 429s:
 *   - a concurrency cap bounds in-flight requests (smooths bursts),
 *   - 429s are retried with Retry-After / exponential backoff + jitter.
 *
 * The semaphore is process-local; before running more than one instance, move
 * throttling to a shared store (Redis) — see the plan's scaling note.
 */

import logger from '../utils/logger';

const MAX_CONCURRENT = 5;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 15000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT);

interface RateLimitedError {
  statusCode?: number;
  message?: string;
  headers?: Record<string, string>;
}

export function isRateLimited(err: unknown): boolean {
  const e = err as RateLimitedError;
  return e?.statusCode === 429 || /\b429\b|rate limit/i.test(e?.message ?? '');
}

function backoffMs(err: unknown, attempt: number, baseDelayMs: number): number {
  const retryAfter = (err as RateLimitedError)?.headers?.['retry-after'];
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  if (retryAfterMs > 0) return retryAfterMs;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(baseDelayMs * 2 ** attempt, MAX_DELAY_MS) + jitter;
}

export interface ResilienceOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/** Run a Discogs call under the concurrency cap, retrying on 429. */
export async function runDiscogs<T>(fn: () => Promise<T>, opts: ResilienceOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? BASE_DELAY_MS;
  const release = await semaphore.acquire();
  try {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (isRateLimited(err) && attempt < maxRetries) {
          const wait = backoffMs(err, attempt, baseDelayMs);
          logger.warn({ attempt: attempt + 1, wait }, 'Discogs rate-limited; backing off');
          attempt++;
          await delay(wait);
          continue;
        }
        throw err;
      }
    }
  } finally {
    release();
  }
}
