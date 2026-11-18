import { describe, it, expect } from 'vitest';
import { RateLimiter, clientIp, limitFor } from '@/server/rateLimit';

describe('per-IP rate limit', () => {
  it('allows max requests per window, then 429s until the window resets', () => {
    const l = new RateLimiter();
    const lim = { max: 3, windowMs: 1000 };
    expect([1, 2, 3].map(() => l.hit('a', lim, 0).ok)).toEqual([true, true, true]);
    const blocked = l.hit('a', lim, 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(1);
    expect(l.hit('b', lim, 10).ok).toBe(true); // other IPs unaffected
    expect(l.hit('a', lim, 1000).ok).toBe(true); // new window
  });

  it('chain proxy gets a bigger budget than the signing endpoints', () => {
    expect(limitFor('/api/chain/utxos').max).toBeGreaterThan(limitFor('/api/verifier').max);
  });

  it('reads the first x-forwarded-for hop', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
