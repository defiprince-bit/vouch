// Real chipnet run of a VouchQuorum 2-of-3 keep, using the same link-relay steps as the app:
//   staker locks, pre-signs the keep with every verifier slot empty; verifier 3 signs alone; verifier 1
//   signs alone; each signature is checked off-chain against the sighash; the bundle is broadcast.
// Optional `break`: a second pledge ended by a 2-of-3 breakByVerifier vote.
// Usage: npx tsx scripts/chipnet-quorum.mts [status|run|break]
import { readFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder, placeholderSignature } from 'cashscript';
import { binToHex, decodePrivateKeyWif, secp256k1 } from '@bitauth/libauth';
import { RestNetworkProvider } from '../src/lib/providers';
import { stakerP2pkhAddress, newPledgeId } from '../src/lib/vouch';
import {
  createQuorumContract,
  buildQuorumKeep,
  buildQuorumBreakByVerifier,
  quorumSigsFromTx,
  slotSignature,
  spendSighash,
  validSlotSigs,
  countSigs,
} from '../src/lib/quorum';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
function key(name: string) {
  const decoded = decodePrivateKeyWif(env[name]);
  if (typeof decoded === 'string') throw new Error(`${name}: ${decoded}`);
  const pub = secp256k1.derivePublicKeyCompressed(decoded.privateKey) as Uint8Array;
  return { pub, sig: new SignatureTemplate(decoded.privateKey), address: stakerP2pkhAddress(pub, 'chipnet') };
}

const EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const staker = key('CHIPNET_STAKER_WIF');
const verifiers = [key('CHIPNET_VERIFIER_WIF'), key('CHIPNET_VERIFIER2_WIF'), key('CHIPNET_VERIFIER3_WIF')];
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
const STAKE = 5_000n;
const provider = new RestNetworkProvider('chipnet');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lock(contractAddress: string, lockingBytecode: string) {
  const utxos = (await provider.getUtxos(staker.address)).filter((u) => !u.token);
  const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
  if (total < STAKE + 600n) throw new Error(`Staker ${staker.address} has ${total} sats; fund it from https://tbch.googol.cash first`);
  const tx = await new TransactionBuilder({ provider })
    .addInputs(utxos, staker.sig.unlockP2PKH())
    .addOutput({ to: contractAddress, amount: STAKE })
    .addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 })
    .send();
  return { txid: tx.txid, utxo: { txid: tx.txid, vout: 0, satoshis: STAKE, lockingBytecode } };
}

async function main() {
  const mode = process.argv[2] ?? 'status';
  const height = await provider.getBlockHeight();
  console.log('chipnet height', height);
  console.log('staker', staker.address, 'balance', (await provider.getUtxos(staker.address)).reduce((s, u) => s + u.satoshis, 0n));
  if (mode === 'status') return;
  const results: Record<string, string> = {};
  const pubs = verifiers.map((v) => v.pub);
  const mk = () => {
    const pledgeId = newPledgeId();
    console.log('pledgeId', pledgeId, 'deadline', height + 144);
    return createQuorumContract(
      { stakerPubkey: staker.pub, verifierPubkeys: pubs, threshold: 2, beneficiaryAddress: beneficiary.address, deadline: height + 144, pledgeId },
      provider,
    );
  };

  if (mode === 'run') {
    const c = mk();
    console.log('2-of-3 pledge contract', c.address);
    const l = await lock(c.address, c.lockingBytecode);
    results['lock (2-of-3 keep pledge)'] = l.txid;
    const base = { contract: c, provider, utxo: l.utxo, stakerAddress: staker.address, beneficiaryAddress: beneficiary.address };
    // 1. staker pre-signs, all verifier slots empty (this is what the share link carries)
    const stakerSig = quorumSigsFromTx(buildQuorumKeep({ ...base, stakerSig: staker.sig, verifierSigs: [] }).build(), 'keep').stakerSig!;
    let bundle: Array<string | null> = [null, null, null];
    // 2. verifier 3 opens the link and signs their slot only
    bundle[2] = binToHex(slotSignature('keep', { ...base, slot: 2, signer: verifiers[2].sig }));
    // 3. later, verifier 1 opens the forwarded link and adds theirs
    bundle[0] = binToHex(slotSignature('keep', { ...base, slot: 0, signer: verifiers[0].sig }));
    const sighash = spendSighash(c, buildQuorumKeep({ ...base, stakerSig: placeholderSignature(), verifierSigs: [] }));
    bundle = validSlotSigs(sighash, pubs, bundle);
    console.log('valid approvals', countSigs(bundle), 'of 3 (need 2)');
    await sleep(2000);
    const k = await buildQuorumKeep({ ...base, stakerSig, verifierSigs: bundle.map((s) => (s ? Buffer.from(s, 'hex') : null)) }).send();
    results['keep 2-of-3 (verifiers 1+3) -> staker'] = k.txid;
  }

  if (mode === 'break' || mode === 'run') {
    try {
      const c = mk();
      const l = await lock(c.address, c.lockingBytecode);
      results['lock (2-of-3 break pledge)'] = l.txid;
      const base = { contract: c, provider, utxo: l.utxo, stakerAddress: staker.address, beneficiaryAddress: beneficiary.address };
      const votes: Array<string | null> = [null, null, null];
      votes[1] = binToHex(slotSignature('break', { ...base, slot: 1, signer: verifiers[1].sig }));
      votes[2] = binToHex(slotSignature('break', { ...base, slot: 2, signer: verifiers[2].sig }));
      await sleep(2000);
      const b = await buildQuorumBreakByVerifier({ ...base, verifierSigs: votes.map((s) => (s ? Buffer.from(s, 'hex') : null)) }).send();
      results['breakByVerifier 2-of-3 (verifiers 2+3) -> beneficiary'] = b.txid;
    } catch (e) {
      console.log('skipped break run:', (e as Error).message);
    }
  }
  for (const [label, txid] of Object.entries(results)) console.log(`${label}: ${txid}  ${EXPLORER}${txid}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
