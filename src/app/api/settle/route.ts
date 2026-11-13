// Settle an expired pledge to its beneficiary (no key needed: forfeit is signature-less).
import { NextResponse, type NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { settleExpired } from '@/server/verifier';
import { jsonError, networkParam } from '@/server/http';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pledge: { network?: string } };
    return NextResponse.json(await settleExpired(body, getProvider(networkParam(body.pledge?.network))));
  } catch (e) {
    return jsonError(e);
  }
}
