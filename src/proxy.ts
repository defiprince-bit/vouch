// Per-IP rate limit on /api/* (see src/server/rateLimit.ts for the caveats).
import { NextResponse, type NextRequest } from 'next/server';
import { RateLimiter, clientIp, limitFor } from './server/rateLimit';

const limiter = new RateLimiter();

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const group = path.startsWith('/api/chain') ? 'chain' : path.split('/').slice(0, 3).join('/');
  const r = limiter.hit(`${clientIp(req.headers)}|${group}`, limitFor(path));
  if (!r.ok) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429, headers: { 'retry-after': String(r.retryAfter) } });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
