// HTTPS chain proxy for the REST fallback provider (browser -> here -> mainnet.cash / explorers).
import { NextResponse, type NextRequest } from 'next/server';
import { restUpstream } from '@/lib/providers';
import { jsonError, networkParam } from '@/server/http';
import { VerifierError } from '@/server/verifier';

export async function GET(req: NextRequest, ctx: { params: Promise<{ op: string }> }) {
  try {
    const { op } = await ctx.params;
    const q = req.nextUrl.searchParams;
    const network = networkParam(q.get('network'));
    if (op === 'height') return NextResponse.json({ height: await restUpstream.height(network) });
    if (op === 'utxos') {
      const address = q.get('address') ?? '';
      const utxos = await restUpstream.utxos(network, address);
      return NextResponse.json({ utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString(), lockingBytecode: u.lockingBytecode })) });
    }
    if (op === 'tx') {
      const txid = q.get('txid') ?? '';
      if (!/^[0-9a-f]{64}$/i.test(txid)) throw new VerifierError('bad txid');
      return NextResponse.json({ txHex: await restUpstream.rawTx(network, txid) });
    }
    throw new VerifierError('unknown op', 404);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ op: string }> }) {
  try {
    const { op } = await ctx.params;
    if (op !== 'broadcast') throw new VerifierError('unknown op', 404);
    const network = networkParam(req.nextUrl.searchParams.get('network'));
    const { txHex } = (await req.json()) as { txHex?: string };
    if (!txHex || !/^[0-9a-f]+$/i.test(txHex) || txHex.length > 200_000) throw new VerifierError('bad txHex');
    const { RestNetworkProvider } = await import('@/lib/providers');
    const txid = await new RestNetworkProvider(network).sendRawTransaction(txHex);
    return NextResponse.json({ txid });
  } catch (e) {
    return jsonError(e);
  }
}
