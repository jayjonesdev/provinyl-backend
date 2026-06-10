import { describe, it, expect } from 'vitest';
import { runDiscogs, isRateLimited } from './discogsResilience';

const rateLimitError = (msg = 'rate limited') => Object.assign(new Error(msg), { statusCode: 429 });

describe('isRateLimited', () => {
  it('detects 429 by statusCode and message, ignores others', () => {
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
    expect(isRateLimited({ message: 'You are being rate limited' })).toBe(true);
    expect(isRateLimited({ message: 'HTTP 429' })).toBe(true);
    expect(isRateLimited({ statusCode: 500 })).toBe(false);
    expect(isRateLimited(new Error('boom'))).toBe(false);
  });
});

describe('runDiscogs', () => {
  it('returns the value without retrying on success', async () => {
    let calls = 0;
    const out = await runDiscogs(async () => { calls++; return 'ok'; });
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const out = await runDiscogs(
      async () => { calls++; if (calls < 3) throw rateLimitError(); return 'ok'; },
      { baseDelayMs: 1, maxRetries: 5 },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries on persistent 429', async () => {
    let calls = 0;
    await expect(
      runDiscogs(async () => { calls++; throw rateLimitError(); }, { baseDelayMs: 1, maxRetries: 2 }),
    ).rejects.toThrow();
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('times out a call that never settles, then frees its slot', async () => {
    // Mirrors the disconnect-client crash: a call whose promise never settles.
    // The timeout must reject so the semaphore slot is released.
    await expect(
      runDiscogs(() => new Promise(() => {}), { timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/);

    // A subsequent call still runs — proves the slot wasn't leaked.
    expect(await runDiscogs(async () => 'ok', { timeoutMs: 20 })).toBe('ok');
  });

  it('passes non-429 errors through immediately', async () => {
    let calls = 0;
    await expect(
      runDiscogs(async () => { calls++; throw new Error('boom'); }, { baseDelayMs: 1, maxRetries: 3 }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('caps concurrency', async () => {
    let current = 0;
    let peak = 0;
    const task = () =>
      runDiscogs(async () => {
        current++;
        peak = Math.max(peak, current);
        await new Promise((r) => setTimeout(r, 5));
        current--;
        return 1;
      });
    await Promise.all(Array.from({ length: 12 }, task));
    expect(peak).toBeGreaterThan(1); // genuinely concurrent
    expect(peak).toBeLessThanOrEqual(5); // but bounded
  });
});
