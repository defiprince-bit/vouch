// Vouch demo verifier (operated by this app). Key: COMMITCASH_VERIFIER_WIF (server-only env).
import { NextResponse, connection, type NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { demoVerifierAction, demoVerifierAllowed, loadVerifierKey, verifierPubkeyHex, VerifierError, DEMO_MAINNET_REFUSED } from '@/server/verifier';
import { jsonError, networkParam } from '@/server/http';

// A private key is network-agnostic (only its WIF/address encoding differs), so the same
// COMMITCASH_VERIFIER_WIF verifies on chipnet and mainnet. ?network= is optional and validated.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const q = req.nextUrl.searchParams.get('network');
    const network = q === null ? null : networkParam(q);
    const key = loadVerifierKey();
    // Mainnet is off unless DEMO_VERIFIER_MAINNET=1. The pubkey is still returned (it's public) so
    // pages can recognise the demo verifier on existing pledges.
    const networks = (['chipnet', 'mainnet'] as const).filter(demoVerifierAllowed);
    const enabled = !!key && (network ? demoVerifierAllowed(network) : true);
    return NextResponse.json({ enabled, pubkey: key ? verifierPubkeyHex(key) : null, networks, ...(network ? { network } : {}) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const key = loadVerifierKey();
    if (!key) throw new VerifierError('Demo verifier is not configured on this deployment', 503);
    const body = (await req.json()) as Parameters<typeof demoVerifierAction>[0] & { pledge: { network?: string } };
    const network = networkParam(body.pledge?.network);
    if (!demoVerifierAllowed(network)) throw new VerifierError(DEMO_MAINNET_REFUSED, 403);
    const provider = getProvider(network);
    // keep only: the demo verifier refuses break (see demoVerifierAction)
    return NextResponse.json(await demoVerifierAction(body, provider, key));
  } catch (e) {
    return jsonError(e);
  }
}
