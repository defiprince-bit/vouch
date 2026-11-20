// Real chipnet run of the v1.1 / v2.1 verifier-only refund: lock -> keep signed by the verifier(s) only.
// Usage: CHIPNET_PROVIDER=rest npx tsx scripts/chipnet-verifier-refund.mts
import { readFileSync } from 'node:fs';
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { RestChipnetProvider } from './rest-provider.mts';
import { decodePrivateKeyWif, secp256k1, generatePrivateKey, hashTransaction, hexToBin } from '@bitauth/libauth';
import { createPledgeContract, buildKeep, stakerP2pkhAddress, newPledgeId } from '../src/lib/vouch';
import { createQuorumContract, buildQuorumKeep, QUORUM_FEE } from '../src/lib/quorum';

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
const verifier = key('CHIPNET_VERIFIER_WIF');
const beneficiary = key('CHIPNET_BENEFICIARY_WIF');
// A throwaway second verifier for the group run (fresh key each run, never stored).
const v2priv = generatePrivateKey();
const verifier2 = { pub: secp256k1.derivePublicKeyCompressed(v2priv) as Uint8Array, sig: new SignatureTemplate(v2priv) };
const STAKE = 1_800n;
const FEE = 500n;
const provider: NetworkProvider =
  process.env.CHIPNET_PROVIDER === 'rest' ? new RestChipnetProvider(staker.address) : new ElectrumNetworkProvider('chipnet');

/**
 * Build the lock, then build (and locally evaluate) the refund against it BEFORE broadcasting the
 * lock, so a refund that can't be built never strands coins in a contract whose terms aren't saved.
 */
async function lockThenRefund(contract: { address: string; lockingBytecode: string }, stake: bigint, refund: (utxo: { txid: string; vout: number; satoshis: bigint; lockingBytecode: string }) => { build(): string }) {
  const utxos = (await provider.getUtxos(staker.address)).filter((u) => !u.token);
  const lockHex = await new TransactionBuilder({ provider })
    .addInputs(utxos, staker.sig.unlockP2PKH())
    .addOutput({ to: contract.address, amount: stake })
    .addBchChangeOutputIfNeeded({ to: staker.address, feeRate: 1.0 })
    .build();
  const lockTxid = hashTransaction(hexToBin(lockHex));
  const refundHex = refund({ txid: lockTxid, vout: 0, satoshis: stake, lockingBytecode: contract.lockingBytecode }).build();
  await provider.sendRawTransaction(lockHex);
  console.log('  lock  ', EXPLORER + lockTxid);
  await sleep(3000);
  const refundTxid = await provider.sendRawTransaction(refundHex);
  console.log('  refund', EXPLORER + refundTxid);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const height = await provider.getBlockHeight();
const deadline = height + 200;
console.log('chipnet height', height);

const only = process.argv[2];
if (only !== 'v21') {
  // v1.1: one verifier signs the refund alone.
  const c1 = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline, pledgeId: newPledgeId(), verifierRefund: true }, provider);
  console.log('v1.1', c1.name, c1.address, '(keep: verifier signature only)');
  await lockThenRefund(c1, STAKE, (utxo) => buildKeep({ contract: c1, provider, utxo, verifierSig: verifier.sig, stakerAddress: staker.address, fee: FEE }));
  await sleep(3000);
}
if (only !== 'v11') {
  // v2.1: 2 of 2 verifiers sign the refund, no staker signature. Needs ~2,400 sats at the staker.
  const c2 = createQuorumContract({ stakerPubkey: staker.pub, verifierPubkeys: [verifier.pub, verifier2.pub], threshold: 2, beneficiaryAddress: beneficiary.address, deadline, pledgeId: newPledgeId(), verifierRefund: true }, provider);
  console.log('v2.1', c2.name, c2.address, '(keep: 2 of 2 verifier signatures, no staker signature)');
  await lockThenRefund(c2, QUORUM_FEE + 600n, (utxo) => buildQuorumKeep({ contract: c2, provider, utxo, verifierSigs: [verifier.sig, verifier2.sig], stakerAddress: staker.address }));
}
process.exit(0);
