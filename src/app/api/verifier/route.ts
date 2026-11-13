// CommitCash demo verifier (operated by this app). Key: COMMITCASH_VERIFIER_WIF (server-only env).
import { NextResponse, connection, type NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { demoVerifierAction, loadVerifierKey, verifierPubkeyHex, VerifierError } from '@/server/verifier';
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
    const body = (await req.json()) as Parameters<typeof demoVerifierAction>[0] & { pledge: { network?: string } };
    const provider = getProvider(networkParam(body.pledge?.network));
    // keep only: the demo verifier refuses break (see demoVerifierAction)
    return NextResponse.json(await demoVerifierAction(body, provider, key));
  } catch (e) {
    return jsonError(e);
  }
}
