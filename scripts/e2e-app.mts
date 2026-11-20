// End-to-end against a running app (default http://localhost:3311) on REAL chipnet:
// lock -> keep via demo verifier (verifier-first; "wallet" = local key through the same WC request path),
// lock -> keep via demo verifier (staker-first, server broadcasts), lock -> /api/settle after deadline.
// Uses throwaway chipnet keys from .env.local. Usage: npx tsx scripts/e2e-app.mts [baseUrl]
import { readFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder, placeholderSignature } from 'cashscript';
import { decodePrivateKeyWif, secp256k1, binToHex, hexToBin } from '@bitauth/libauth';
import { createPledgeContract, buildKeep, stakerP2pkhAddress, newPledgeId } from '../src/lib/vouch.ts';
import { RestNetworkProvider } from '../src/lib/providers.ts';
import { toWcSignRequest, keepSignaturesFromTx, DUMMY_SIGNATURE } from '../src/lib/wc.ts';
import { mockWalletSign } from '../test/mock-wallet.ts';

const BASE = process.argv[2] ?? 'http://localhost:3311';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (n: string) => {
  const d = decodePrivateKeyWif(env[n]);
  if (typeof d === 'string') throw new Error(d);
  const pub = secp256k1.derivePublicKeyCompressed(d.privateKey) as Uint8Array;
  return { priv: d.privateKey, pub, address: stakerP2pkhAddress(pub, 'chipnet'), sig: new SignatureTemplate(d.privateKey) };
};
const staker = key('CHIPNET_STAKER_WIF');
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
// The app's own chain proxy, exactly as the browser uses it in REST mode
const provider = new RestNetworkProvider('chipnet', BASE);
const EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const STAKE = 5000n;
const out: string[] = [];

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}

async function newLockedPledge(verifierPub: Uint8Array, deadline: number) {
  const id = newPledgeId();
  const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifierPub, beneficiaryAddress: beneficiary.address, deadline, pledgeId: id }, provider);
  const utxos = await provider.getUtxos(staker.address);
  const tx = await new TransactionBuilder({ provider })
    .addInputs(utxos, staker.sig.unlockP2PKH())
    .addOutput({ to: contract.address, amount: STAKE })
    .addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 })
    .send();
  out.push(`lock ${tx.txid}`);
  const terms = { id, deadline, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(verifierPub), network: 'chipnet' };
  const utxo = { txid: tx.txid, vout: 0, satoshis: STAKE, lockingBytecode: contract.lockingBytecode };
  // wait until the REST indexer sees the contract UTXO
  for (let i = 0; i < 20 && (await contract.getUtxos()).length === 0; i++) await new Promise((r) => setTimeout(r, 1500));
  return { contract, terms, utxo };
}

const mode = process.argv[3] ?? 'all';
const v = await api<{ enabled: boolean; pubkey: string }>('/api/verifier');
console.log('demo verifier', v);
const height = (await api<{ height: number }>('/api/chain/height?network=chipnet')).height;
console.log('height', height);
const demoPub = hexToBin(v.pubkey);

if (mode === 'all' || mode === 'keep1') {
  // 1. verifier-first keep
  const a = await newLockedPledge(demoPub, height + 100);
  const r = await api<{ verifierSig: string; utxo: { txid: string; vout: number; satoshis: string } }>('/api/verifier', { action: 'keep', pledge: a.terms, confirm: true, note: 'e2e: ran 5k' });
  const builder = buildKeep({ contract: a.contract, provider, utxo: { ...r.utxo, satoshis: BigInt(r.utxo.satoshis), lockingBytecode: a.contract.lockingBytecode }, stakerSig: placeholderSignature(), verifierSig: hexToBin(r.verifierSig), stakerAddress: staker.address });
  const signed = mockWalletSign(toWcSignRequest(builder, [[0, 'receive', 0]], { broadcast: true, userPrompt: 'keep' }), { 'receive/0': staker.priv });
  const { txid } = await api<{ txid: string }>('/api/chain/broadcast?network=chipnet', { txHex: signed });
  out.push(`keep (demo verifier first, wallet-signed) ${txid}`);
}
if (mode === 'all' || mode === 'keep2') {
  // 2. staker-first keep, server assembles + broadcasts
  const b = await newLockedPledge(demoPub, height + 100);
  const pre = buildKeep({ contract: b.contract, provider, utxo: b.utxo, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress: staker.address });
  const { stakerSig } = keepSignaturesFromTx(mockWalletSign(toWcSignRequest(pre, [[0, 'receive', 0]], { broadcast: false, userPrompt: 'pre-sign' }), { 'receive/0': staker.priv }));
  const r2 = await api<{ txid: string }>('/api/verifier', { action: 'keep', pledge: b.terms, confirm: true, note: 'e2e via link', stakerSig: binToHex(stakerSig!) });
  out.push(`keep (staker pre-signed, demo verifier broadcast) ${r2.txid}`);
}
if (mode === 'all' || mode === 'settle') {
  // 3. expired pledge settled by /api/settle (deadline = current height)
  const c = await newLockedPledge(demoPub, height);
  const r3 = await api<{ txid: string }>('/api/settle', { pledge: c.terms });
  out.push(`settle expired -> beneficiary ${r3.txid}`);
}
for (const l of out) {
  const [label, txid] = [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)];
  console.log(`${label}: ${EXPLORER}${txid}`);
}
