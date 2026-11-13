// Real chipnet run: lock -> keep, lock -> forfeit (deadline already reached), lock -> breakByVerifier.
// Usage: npx tsx scripts/chipnet.mts [status|run|break]   (break = only the verifier-break path)
import { readFileSync } from 'node:fs';
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { RestChipnetProvider } from './rest-provider.mts';
import { decodePrivateKeyWif, secp256k1 } from '@bitauth/libauth';
import {
  createPledgeContract,
  buildKeep,
  buildForfeit,
  buildBreakByVerifier,
  stakerP2pkhAddress,
  newPledgeId,
  MIN_STAKE,
} from '../src/lib/vouch';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

function key(name: string) {
  const decoded = decodePrivateKeyWif(env[name]);
  if (typeof decoded === 'string') throw new Error(`${name}: ${decoded}`);
  const pub = secp256k1.derivePublicKeyCompressed(decoded.privateKey) as Uint8Array;
  return { pub, sig: new SignatureTemplate(decoded.privateKey), address: stakerP2pkhAddress(pub, 'chipnet') };
}

const EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const staker = key('CHIPNET_STAKER_WIF');
const verifier = key('CHIPNET_VERIFIER_WIF');
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
const STAKE = 5_000n;
const FEE = 500n;
// CHIPNET_PROVIDER=rest uses HTTPS (for networks that block Electrum ports); default is Electrum.
const provider: NetworkProvider =
  process.env.CHIPNET_PROVIDER === 'rest' ? new RestChipnetProvider(staker.address) : new ElectrumNetworkProvider('chipnet');

async function lock(contract: { address: string; lockingBytecode: string }) {
  const contractAddress = contract.address;
  const utxos = (await provider.getUtxos(staker.address)).filter((u) => !u.token);
  const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
  if (total < STAKE + 600n) throw new Error(`Staker ${staker.address} has ${total} sats; fund it first`);
  const tx = await new TransactionBuilder({ provider })
    .addInputs(utxos, staker.sig.unlockP2PKH())
    .addOutput({ to: contractAddress, amount: STAKE })
    .addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 })
    .send();
  const utxo = { txid: tx.txid, vout: 0, satoshis: STAKE, lockingBytecode: contract.lockingBytecode };
  return { txid: tx.txid, utxo };
}

async function main() {
  const mode = process.argv[2] ?? 'status';
  const height = await provider.getBlockHeight();
  console.log('chipnet height', height);
  console.log('staker  ', staker.address, 'balance', (await provider.getUtxos(staker.address)).reduce((s, u) => s + u.satoshis, 0n));
  console.log('verifier', verifier.address);
  console.log('benefic.', beneficiary.address);
  if (mode !== 'run' && mode !== 'break') return;
  if (STAKE < MIN_STAKE) throw new Error('stake too small');

  const results: Record<string, string> = {};
  const mk = (deadline: number) =>
    createPledgeContract(
      { stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline, pledgeId: newPledgeId() },
      provider,
    );

  if (mode === 'run') {
  // 1. lock + keep (deadline in the future)
  const c1 = mk(height + 144);
  const l1 = await lock(c1);
  results['lock#1 (keep pledge)'] = l1.txid;
  const k = await buildKeep({ contract: c1, provider, utxo: l1.utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress: staker.address, fee: FEE }).send();
  results['keep -> staker'] = k.txid;

  // 2. lock + forfeit (deadline = current height, so nLocktime is already satisfied)
  const c2 = mk(height);
  const l2 = await lock(c2);
  results['lock#2 (forfeit pledge)'] = l2.txid;
  const f = await buildForfeit({ contract: c2, provider, utxo: l2.utxo, beneficiaryAddress: beneficiary.address, deadline: height, fee: FEE }).send();
  results['forfeit -> beneficiary (no sig)'] = f.txid;

  }

  // 3. lock + breakByVerifier (needs a second faucet drip)
  try {
  const c3 = mk(height + 144);
  const l3 = await lock(c3);
  results['lock#3 (verifier-break pledge)'] = l3.txid;
  const b = await buildBreakByVerifier({ contract: c3, provider, utxo: l3.utxo, verifierSig: verifier.sig, beneficiaryAddress: beneficiary.address, fee: FEE }).send();
  results['breakByVerifier -> beneficiary'] = b.txid;
  } catch (e) {
    console.log('skipped breakByVerifier run:', (e as Error).message);
  }

  for (const [label, txid] of Object.entries(results)) console.log(`${label}: ${txid}  ${EXPLORER}${txid}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
