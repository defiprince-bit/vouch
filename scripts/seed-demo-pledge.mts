// Lock a real chipnet demo pledge with the throwaway staker key and print the StoredPledge JSON
// (paste it into the browser's localStorage "vouch-pledges" to see a live status page).
// Usage: npx tsx scripts/seed-demo-pledge.mts [baseUrl] [days]
import { readFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { decodePrivateKeyWif, secp256k1, binToHex, hexToBin } from '@bitauth/libauth';
import { createPledgeContract, stakerP2pkhAddress, newPledgeId } from '../src/lib/vouch.ts';
import { RestNetworkProvider } from '../src/lib/providers.ts';

const BASE = process.argv[2] ?? 'http://localhost:3311';
const DAYS = Number(process.argv[3] ?? 7);
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (n: string) => {
  const d = decodePrivateKeyWif(env[n]);
  if (typeof d === 'string') throw new Error(d);
  const pub = secp256k1.derivePublicKeyCompressed(d.privateKey) as Uint8Array;
  return { pub, address: stakerP2pkhAddress(pub, 'chipnet'), sig: new SignatureTemplate(d.privateKey) };
};
const staker = key('CHIPNET_STAKER_WIF');
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
const provider = new RestNetworkProvider('chipnet', BASE);

const utxos = await provider.getUtxos(staker.address);
const total = utxos.reduce((a, u) => a + u.satoshis, 0n);
const STAKE = total - 1000n > 10_000n ? 10_000n : total - 1000n;
if (STAKE < 5000n) throw new Error(`staker has only ${total} sats; drip the chipnet faucet first`);
const v = (await (await fetch(BASE + '/api/verifier')).json()) as { pubkey: string };
const height = await provider.getBlockHeight();
const deadline = height + Math.round(DAYS * 144);
const id = newPledgeId();
const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: hexToBin(v.pubkey), beneficiaryAddress: beneficiary.address, deadline, pledgeId: id }, provider);
const tx = await new TransactionBuilder({ provider })
  .addInputs(utxos, staker.sig.unlockP2PKH())
  .addOutput({ to: contract.address, amount: STAKE })
  .addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 })
  .send();
for (let i = 0; i < 20 && (await contract.getUtxos()).length === 0; i++) await new Promise((r) => setTimeout(r, 1500));
const now = Date.now();
console.log(
  JSON.stringify({
    id, promise: 'Run three mornings this week.', stakeSats: STAKE.toString(), deadline, deadlineAt: now + (deadline - height) * 600_000,
    beneficiaryAddress: beneficiary.address, beneficiaryName: 'Chidi', stakerPubkey: binToHex(staker.pub), verifierPubkey: v.pubkey,
    verifierKind: 'demo', contractAddress: contract.address, network: 'chipnet', createdAt: now, lastTxid: tx.txid, lockTxid: tx.txid,
  }),
);
