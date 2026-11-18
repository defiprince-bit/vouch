// End-to-end of a VouchQuorum 2-of-3 keep against a running app on REAL chipnet, through the same
// code paths the browser uses: the staker's and verifier's "wallets" are local keys answering the
// app's WizardConnect sign requests (test/mock-wallet), the demo verifier is the app's /api/verifier.
//   verifiers = [Vouch demo verifier, CHIPNET_VERIFIER2, CHIPNET_VERIFIER3], threshold 2
// Usage: npx tsx scripts/e2e-quorum-app.mts [baseUrl]   (default http://localhost:3311)
import { readFileSync } from 'node:fs';
import { TransactionBuilder, SignatureTemplate, placeholderSignature } from 'cashscript';
import { binToHex, decodePrivateKeyWif, hexToBin, secp256k1 } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { RestNetworkProvider } from '../src/lib/providers.ts';
import { stakerP2pkhAddress, newPledgeId } from '../src/lib/vouch.ts';
import { toWcSignRequest, type WcSignRequest } from '../src/lib/wc.ts';
import { buildQuorumKeep, quorumSigsFromTx, QUORUM_FEE } from '../src/lib/quorum.ts';
import { quorumContract, requestSpends, checkRequestSigs, encodeQuorumRequest, decodeAnyVerifyRequest, type QuorumVerifyRequest } from '../src/lib/quorumShare.ts';
import { signQuorumSlot } from '../src/lib/quorumActions.ts';
import { mockWalletSign } from '../test/mock-wallet.ts';

const BASE = process.argv[2] ?? 'http://localhost:3311';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const key = (n: string) => {
  const d = decodePrivateKeyWif(env[n]);
  if (typeof d === 'string') throw new Error(d);
  const pub = secp256k1.derivePublicKeyCompressed(d.privateKey) as Uint8Array;
  return { priv: d.privateKey, pub, address: stakerP2pkhAddress(pub, 'chipnet'), sig: new SignatureTemplate(d.privateKey) };
};
const wallet = (priv: Uint8Array) =>
  ({ signTransaction: async (req: WcSignRequest) => ({ signedTransaction: mockWalletSign(req, { 'receive/0': priv }) }) }) as unknown as DappConnectionManager;
const EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const provider = new RestNetworkProvider('chipnet');
const staker = key('CHIPNET_STAKER_WIF');
const v2 = key('CHIPNET_VERIFIER2_WIF');
const v3 = key('CHIPNET_VERIFIER3_WIF');
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
const STAKE = 5_000n;

async function main() {
  const demo = (await (await fetch(`${BASE}/api/verifier?network=chipnet`)).json()) as { pubkey: string; enabled: boolean };
  if (!demo.enabled) throw new Error('demo verifier not enabled on chipnet at ' + BASE);
  const height = await provider.getBlockHeight();
  const terms0 = {
    id: newPledgeId(),
    promise: 'Quorum e2e: run 5k',
    stakeSats: STAKE.toString(),
    deadline: height + 144,
    beneficiaryAddress: beneficiary.address,
    stakerPubkey: binToHex(staker.pub),
    network: 'chipnet' as const,
    verifiers: [{ pubkey: demo.pubkey, name: 'Vouch demo' }, { pubkey: binToHex(v2.pub), name: 'V2' }, { pubkey: binToHex(v3.pub), name: 'V3' }],
    threshold: 2,
    contractAddress: '',
  };
  const contract = quorumContract(terms0, provider);
  const terms = { ...terms0, contractAddress: contract.address };
  console.log('pledge', terms.id, 'contract', contract.address);

  const utxos = (await provider.getUtxos(staker.address)).filter((u) => !u.token);
  const lock = await new TransactionBuilder({ provider }).addInputs(utxos, staker.sig.unlockP2PKH()).addOutput({ to: contract.address, amount: STAKE }).addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 }).send();
  console.log(`lock: ${lock.txid}  ${EXPLORER}${lock.txid}`);

  let r: QuorumVerifyRequest = {
    v: 2, pledge: terms, utxo: { txid: lock.txid, vout: 0, satoshis: STAKE.toString() }, fee: QUORUM_FEE.toString(), stakerSig: '', keepSigs: [null, null, null], breakSigs: [null, null, null],
  };
  // staker pre-signs through the WizardConnect request path
  const s = requestSpends(r, provider);
  const pre = toWcSignRequest(buildQuorumKeep({ ...s, stakerSig: placeholderSignature(), verifierSigs: [] }), [[0, 'receive', 0]], { broadcast: false, userPrompt: 'pre-sign' });
  r = { ...r, stakerSig: binToHex(quorumSigsFromTx(mockWalletSign(pre, { 'receive/0': staker.priv }), 'keep').stakerSig!) };
  await new Promise((res) => setTimeout(res, 3000)); // let the lock propagate before the server reads it
  // the app's demo verifier signs its slot
  const res = await fetch(`${BASE}/api/verifier`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'keep', pledge: { ...terms, version: 2, verifierPubkeys: terms.verifiers.map((v) => v.pubkey) }, confirm: true, note: 'quorum e2e' }) });
  const j = (await res.json()) as { slot?: number; verifierSig?: string; error?: string };
  if (!res.ok || j.slot === undefined) throw new Error(`demo verifier: ${j.error}`);
  r = { ...r, keepSigs: r.keepSigs.map((x, i) => (i === j.slot ? j.verifierSig! : x)) };
  console.log('after demo verifier:', checkRequestSigs(r, provider).keepCount, 'of 2; link length', encodeQuorumRequest(r).length);
  // the link goes through a URL round-trip to verifier 3, who signs from their wallet
  r = decodeAnyVerifyRequest(`#pledge=${encodeQuorumRequest(r)}`) as QuorumVerifyRequest;
  r = await signQuorumSlot(wallet(v3.priv), r, 2, 0, 'keep');
  const st = checkRequestSigs(r, provider);
  console.log('after V3:', st.keepCount, 'of 2');
  const keep = await buildQuorumKeep({ ...requestSpends(r, provider), stakerSig: hexToBin(r.stakerSig), verifierSigs: st.keepSigs.map((x) => (x ? hexToBin(x) : null)) }).send();
  console.log(`keep 2-of-3 (demo + V3) -> staker: ${keep.txid}  ${EXPLORER}${keep.txid}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
