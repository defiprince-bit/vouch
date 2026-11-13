// CommitCash demo verifier (operated by this app). Key: COMMITCASH_VERIFIER_WIF (server-only env).
import { NextResponse, connection, type NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { approveKeep, approveBreak, loadVerifierKey, verifierPubkeyHex, VerifierError } from '@/server/verifier';
import { jsonError, networkParam } from '@/server/http';

export async function GET() {
  await connection();
  const key = loadVerifierKey();
  return NextResponse.json({ enabled: !!key, pubkey: key ? verifierPubkeyHex(key) : null });
}

export async function POST(req: NextRequest) {
  try {
    const key = loadVerifierKey();
    if (!key) throw new VerifierError('Demo verifier is not configured on this deployment', 503);
    const body = (await req.json()) as { action?: string; pledge: { network?: string } };
    const provider = getProvider(networkParam(body.pledge?.network));
    if (body.action === 'keep') return NextResponse.json(await approveKeep(body, provider, key));
    if (body.action === 'break') return NextResponse.json(await approveBreak(body, provider, key));
    throw new VerifierError('action must be keep or break');
  } catch (e) {
    return jsonError(e);
  }
}
