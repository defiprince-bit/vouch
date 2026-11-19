// GET  /api/wall?network=chipnet|mainnet  -> cards + stats, derived from the chain (edge-cached)
// POST /api/wall {pledge, listSecret, listNonce, habit} -> list a pledge (proof: the creating browser's listSecret; see src/server/wall.ts)
import { NextResponse, connection, type NextRequest } from 'next/server';
import { jsonError, networkParam } from '@/server/http';
import { clientIp } from '@/server/rateLimit';
import { listPledge, readWall, restChain, wallStore } from '@/server/wall';

/** Shared cache at the edge: judges' traffic hits Vercel's cache, not the chain upstreams. */
const CACHE = 'public, max-age=0, s-maxage=45, stale-while-revalidate=300';

export async function GET(req: NextRequest) {
  await connection();
  try {
    const network = networkParam(req.nextUrl.searchParams.get('network') ?? 'chipnet');
    const wall = await readWall(network, { store: wallStore(), chain: restChain });
    return NextResponse.json(wall, { headers: { 'cache-control': CACHE } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { pledge?: unknown; listSecret?: unknown; listNonce?: unknown; habit?: unknown } | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const res = await listPledge(
      { pledge: body.pledge, listSecret: body.listSecret, listNonce: body.listNonce, habit: body.habit, ip: clientIp(req.headers) },
      { store: wallStore(), chain: restChain },
    );
    return NextResponse.json(res, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return jsonError(e);
  }
}
