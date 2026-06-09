import { describe, it, expect, beforeEach } from 'vitest';
import { cached, cacheClear } from './cache';

describe('cached', () => {
  beforeEach(() => cacheClear());

  it('computes once and returns the cached value within the TTL', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'value'; };
    expect(await cached('k', 60_000, fn)).toBe('value');
    expect(await cached('k', 60_000, fn)).toBe('value');
    expect(calls).toBe(1);
  });

  it('recomputes once the entry has expired', async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    await cached('k', 0, fn); // ttl 0 → already expired on next read
    await cached('k', 0, fn);
    expect(calls).toBe(2);
  });

  it('keeps distinct keys independent', async () => {
    expect(await cached('a', 60_000, async () => 'A')).toBe('A');
    expect(await cached('b', 60_000, async () => 'B')).toBe('B');
    expect(await cached('a', 60_000, async () => 'changed')).toBe('A');
  });

  it('cacheClear drops everything', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'v'; };
    await cached('k', 60_000, fn);
    cacheClear();
    await cached('k', 60_000, fn);
    expect(calls).toBe(2);
  });
});
