// Simple fixed-window per-IP rate limiter for /api/* (in memory, per server instance).
// Best effort: on Vercel each instance keeps its own counts, so a determined client spread across
// instances gets more. It stops casual hammering of the demo verifier and the chain proxy.

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

/** /api/chain is chatty (a balance check scans many HD addresses); signing endpoints are not. */
export function limitFor(pathname: string): Limit {
  if (pathname.startsWith('/api/chain')) return { max: 600, windowMs: 60_000 };
  return { max: 30, windowMs: 60_000 };
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private maxKeys = 10_000) {}

  /** Count one request. Returns ok=false (with seconds to wait) once `limit.max` is exceeded. */
  hit(key: string, limit: Limit, now = Date.now()): { ok: boolean; retryAfter: number; remaining: number } {
    let e = this.hits.get(key);
    if (!e || now >= e.resetAt) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      e = { count: 0, resetAt: now + limit.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    const retryAfter = Math.max(1, Math.ceil((e.resetAt - now) / 1000));
    return { ok: e.count <= limit.max, retryAfter, remaining: Math.max(0, limit.max - e.count) };
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

/** Client IP as Vercel reports it (first x-forwarded-for hop), else x-real-ip. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
}
