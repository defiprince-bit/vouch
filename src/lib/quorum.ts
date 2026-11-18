// Vouch v2: M-of-N verifier quorum (contracts/VouchQuorum.cash). Pure helpers, no wallet code.
//
// A v2 pledge has 1..5 verifiers in fixed slots and a threshold M (1..N). Unused slots hold
// unspendable "nothing up my sleeve" keys. Signatures are collected slot by slot, at different
// times and in any order; every signer signs the SAME deterministic transaction (same UTXO, same
// single output, same fee, same version/locktime), so their signatures combine freely.
import { Contract, TransactionBuilder, placeholderSignature, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import {
  binToHex,
  hexToBin,
  hash160,
  hash256,
  sha256,
  utf8ToBin,
  decodeTransaction,
  generateSigningSerializationBch,
  secp256k1,
} from '@bitauth/libauth';
import quorumArtifact from './VouchQuorum.artifact';
import { addressToLockingBytecode, DEFAULT_MAX_FEE, DUST, type Signer } from './vouch';
import { unlockingPushes } from './wc';
import { checkAddress } from './network';

export const MAX_VERIFIERS = 5;
/** Fee for every v2 spend. Fixed so all signers sign one identical tx; a 5-of-5 keep is ~1 KB. */
export const QUORUM_FEE = 1500n;
/** Signing serialization every Vouch signature must use: SIGHASH_ALL | SIGHASH_UTXOS | FORKID. */
export const VOUCH_SIGHASH = 0x61;

/**
 * Keys for empty slots: 02 || sha256("vouch/unused-verifier-slot/<slot>/<counter>"), the first
 * counter that gives a valid curve point. The x-coordinate is a hash output, so nobody knows a
 * private key for any of them (see `unusedSlotKey` and its test). Changing these changes every
 * v2 pledge address, so they are pinned.
 */
export const UNUSED_SLOT_KEYS: readonly string[] = [
  '0230b5c9ae9400715a457dafa040181a42232cc8cfe4e504fd7bb34bf63fb151ce', // slot 0, counter 1
  '02cf7d8d943cf9ed4893188a39adc34faa720d22b8f83c8fd3c6e2b86b3668ca95', // slot 1, counter 0
  '02f16f399852ccf537663870a84b6560f2b8f0977357b03a17f2d42e8ee1963616', // slot 2, counter 0
  '02d4a3b49702bcec28a7baecb32fcb3a74edbf0556ce637945d38bb5997709609d', // slot 3, counter 0
  '02e043d207be647f60b849017fde7b308ea0e35746c5cd4bc75720dcc84e44662d', // slot 4, counter 0
];

/** Re-derive an unused-slot key (used by the test that pins UNUSED_SLOT_KEYS). */
export function unusedSlotKey(slot: number): string {
  for (let c = 0; ; c++) {
    const pk = Uint8Array.from([0x02, ...sha256.hash(utf8ToBin(`vouch/unused-verifier-slot/${slot}/${c}`))]);
    if (secp256k1.validatePublicKey(pk)) return binToHex(pk);
  }
}

export interface QuorumParams {
  stakerPubkey: Uint8Array;
  /** 1..5 verifier pubkeys, in slot order. */
  verifierPubkeys: Uint8Array[];
  /** M: how many verifiers must sign a keep (or a verifier break). 1..N. */
  threshold: number;
  beneficiaryAddress: string;
  deadline: number;
  pledgeId: string;
  maxFee?: bigint;
}

/** Message used everywhere a verifier key repeats one already in the pledge (another verifier or the staker). */
export const DUPLICATE_VERIFIER = 'The same key is listed twice: each verifier can only count once';
export const STAKER_AS_VERIFIER = 'Your own key is listed as a verifier: you can’t vouch for yourself';

/**
 * Problems with the quorum shape itself. Shared by create, the /verify page and the server, so all
 * three refuse the same pledges:
 * - 1..5 verifiers, each a compressed pubkey, none of them a reserved padding key;
 * - M is an integer between 1 and the number of real verifiers (padding slots never count);
 * - no key twice, and the staker's key in no slot (treated as a duplicate of the staker).
 */
export function quorumShapeIssues(stakerHex: string, verifierHexes: string[], threshold: unknown): string[] {
  const issues: string[] = [];
  const keys = verifierHexes.map((k) => String(k ?? '').toLowerCase());
  const staker = String(stakerHex ?? '').toLowerCase();
  const real = keys.filter((k) => !UNUSED_SLOT_KEYS.includes(k));
  if (keys.length < 1 || keys.length > MAX_VERIFIERS) issues.push(`Add between 1 and ${MAX_VERIFIERS} verifiers`);
  if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1 || threshold > real.length) {
    issues.push(`The approvals needed must be between 1 and ${Math.max(1, real.length)} (the number of verifiers)`);
  }
  if (keys.some((k) => !/^0[23][0-9a-f]{64}$/.test(k))) issues.push('Every verifier needs a 33-byte compressed public key');
  if (new Set(keys).size !== keys.length) issues.push(DUPLICATE_VERIFIER);
  if (staker && keys.includes(staker)) issues.push(STAKER_AS_VERIFIER);
  if (real.length !== keys.length) issues.push('That key is reserved');
  return issues;
}

/** What M of N lets the verifiers do, for the create and verify copy. M approve OR M force a break. */
export function quorumPowerCopy(m: number, n: number, reader: 'staker' | 'verifier' = 'staker'): { summary: string; warning: string | null } {
  const refund = reader === 'staker' ? 'your refund' : 'the staker’s refund';
  const summary =
    n === 1
      ? `The one verifier can approve ${refund}, and can also force a break that sends the stake to the beneficiary.`
      : `Any ${m} of the ${n} verifiers can approve ${refund}, and any ${m} of them can also force a break that sends the stake to the beneficiary.`;
  const warning =
    m !== 1
      ? null
      : n === 1
        ? 'With 1 of 1, that one verifier can rule it broken on their own and send the stake to the beneficiary.'
        : `With 1 of ${n}, any single verifier can rule it broken on their own and send the stake to the beneficiary, even if ${n === 2 ? 'the other one disagrees' : `the other ${n - 1} disagree`}.`;
  return { summary, warning };
}

/** The five constructor slot keys: the real verifiers, then unspendable padding. */
export function slotKeys(verifierPubkeys: Uint8Array[]): Uint8Array[] {
  return Array.from({ length: MAX_VERIFIERS }, (_, i) => verifierPubkeys[i] ?? hexToBin(UNUSED_SLOT_KEYS[i]));
}

export function createQuorumContract(params: QuorumParams, provider: NetworkProvider) {
  if (params.stakerPubkey.length !== 33) throw new Error('Pubkeys must be 33-byte compressed keys');
  const issues = quorumShapeIssues(binToHex(params.stakerPubkey), params.verifierPubkeys.map(binToHex), params.threshold);
  if (issues.length) throw new Error(issues[0]);
  // Block heights only: the verify-by cutoff and the keeper treat the deadline as a height.
  if (!Number.isInteger(params.deadline) || params.deadline <= 0 || params.deadline >= 500_000_000) throw new Error('Bad deadline: must be a block height');
  const net = provider.network;
  if (net === 'chipnet' || net === 'mainnet') {
    const c = checkAddress(params.beneficiaryAddress, net);
    if (!c.ok) throw new Error(`Beneficiary: ${c.error}`);
  }
  const pledgeId = hexToBin(params.pledgeId);
  if (pledgeId.length !== 16) throw new Error('pledgeId must be 16 bytes');
  const [v0, v1, v2, v3, v4] = slotKeys(params.verifierPubkeys);
  return new Contract(
    quorumArtifact,
    [
      params.stakerPubkey,
      v0,
      v1,
      v2,
      v3,
      v4,
      BigInt(params.threshold),
      addressToLockingBytecode(params.beneficiaryAddress),
      BigInt(params.deadline),
      pledgeId,
      params.maxFee ?? DEFAULT_MAX_FEE,
    ],
    { provider, contractType: 'p2sh32' },
  );
}

export type QuorumContract = ReturnType<typeof createQuorumContract>;

/** Per-slot signers. Missing / null = that verifier hasn't signed (an empty push on-chain). */
export type SlotSigners = Array<Signer | null | undefined>;

const EMPTY = new Uint8Array(0);
function slotArgs(sigs: SlotSigners): [Signer, Signer, Signer, Signer, Signer] {
  const a = Array.from({ length: MAX_VERIFIERS }, (_, i) => sigs[i] ?? EMPTY);
  return [a[0], a[1], a[2], a[3], a[4]];
}

function payout(utxo: SpendableUtxo, fee: bigint): bigint {
  const value = utxo.satoshis - fee;
  if (value < DUST) throw new Error('Stake too small to pay out above dust');
  return value;
}

interface QuorumSpend {
  contract: QuorumContract;
  provider: NetworkProvider;
  utxo: SpendableUtxo;
  fee?: bigint;
}

/** keep: staker + any M verifiers; pays the staker's P2PKH. */
export function buildQuorumKeep(o: QuorumSpend & { stakerSig: Signer; verifierSigs: SlotSigners; stakerAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.keep(o.stakerSig, ...slotArgs(o.verifierSigs)))
    .addOutput({ to: o.stakerAddress, amount: payout(o.utxo, o.fee ?? QUORUM_FEE) });
}

/** breakByVerifier: any M verifiers rule it broken; pays the beneficiary. */
export function buildQuorumBreakByVerifier(o: QuorumSpend & { verifierSigs: SlotSigners; beneficiaryAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.breakByVerifier(...slotArgs(o.verifierSigs)))
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? QUORUM_FEE) });
}

export function buildQuorumBreakByStaker(o: QuorumSpend & { stakerSig: Signer; beneficiaryAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.breakByStaker(o.stakerSig))
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? QUORUM_FEE) });
}

export function buildQuorumForfeit(o: QuorumSpend & { beneficiaryAddress: string; deadline: number }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.forfeit())
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? QUORUM_FEE) })
    .setLocktime(o.deadline);
}

/*
 * Unlocking bytecode layout (CashScript pushes args in reverse, then selector, then redeem script):
 *   keep(stakerSig, s0..s4)    -> [s4, s3, s2, s1, s0, stakerSig, selector, redeemScript]
 *   breakByVerifier(s0..s4)    -> [s4, s3, s2, s1, s0, selector, redeemScript]
 */
export function quorumSigsFromTx(txHex: string, kind: 'keep' | 'break', inputIndex = 0) {
  const pushes = unlockingPushes(txHex, inputIndex);
  const slots = pushes.slice(0, MAX_VERIFIERS).reverse();
  const stakerSig = kind === 'keep' ? pushes[MAX_VERIFIERS] : undefined;
  return { slots, stakerSig };
}

/** The sighash every signer of this spend signs (the tx's unlocking bytecode isn't covered). */
export function spendSighash(contract: QuorumContract, builder: TransactionBuilder, sighashType = VOUCH_SIGHASH): Uint8Array {
  const tx = decodeTransaction(hexToBin(builder.build()));
  if (typeof tx === 'string') throw new Error(tx);
  const sourceOutputs = [{ lockingBytecode: hexToBin(contract.lockingBytecode), valueSatoshis: builder.inputs[0].satoshis }];
  const serialization = generateSigningSerializationBch(
    { inputIndex: 0, sourceOutputs, transaction: tx },
    { coveredBytecode: hexToBin(contract.bytecode), signingSerializationType: new Uint8Array([sighashType]) },
  );
  return hash256(serialization);
}

/** Is `sig` a valid Vouch (Schnorr, ALL|UTXOS) signature by `pubkey` over this spend? */
export function isValidSpendSig(sighash: Uint8Array, sig: Uint8Array, pubkey: Uint8Array): boolean {
  if (sig.length !== 65 || sig[64] !== VOUCH_SIGHASH) return false;
  return secp256k1.verifySignatureSchnorr(sig.slice(0, 64), pubkey, sighash);
}

/** Keep the valid signatures only (an invalid non-empty one would fail the whole script: NULLFAIL). */
export function validSlotSigs(sighash: Uint8Array, verifierPubkeys: Uint8Array[], sigs: Array<string | null | undefined>): Array<string | null> {
  return verifierPubkeys.map((pk, i) => {
    const s = sigs[i];
    if (!s || !/^[0-9a-f]{130}$/i.test(s)) return null;
    return isValidSpendSig(sighash, hexToBin(s), pk) ? s.toLowerCase() : null;
  });
}

export const countSigs = (sigs: Array<string | null | undefined>) => sigs.filter(Boolean).length;

/** Merge two sig bundles slot by slot (first non-empty wins; callers validate). */
export function mergeSlotSigs(a: Array<string | null | undefined>, b: Array<string | null | undefined>, n: number): Array<string | null> {
  return Array.from({ length: n }, (_, i) => a[i] || b[i] || null);
}

/** A local key's signature for one slot of a keep / break (demo verifier, scripts, tests). */
export function slotSignature(
  kind: 'keep' | 'break',
  o: QuorumSpend & { slot: number; signer: Signer; stakerAddress: string; beneficiaryAddress: string },
): Uint8Array {
  const verifierSigs: SlotSigners = [];
  verifierSigs[o.slot] = o.signer;
  const builder =
    kind === 'keep'
      ? buildQuorumKeep({ ...o, stakerSig: placeholderSignature(), verifierSigs })
      : buildQuorumBreakByVerifier({ ...o, verifierSigs });
  const sig = quorumSigsFromTx(builder.build(), kind).slots[o.slot];
  if (sig?.length !== 65) throw new Error('Signing failed');
  return sig;
}

/** UI-side guards for a v2 pledge (on top of quorumShapeIssues): no verifier may be the beneficiary. */
export function quorumPledgeIssues(params: QuorumParams): string[] {
  const issues = quorumShapeIssues(binToHex(params.stakerPubkey), params.verifierPubkeys.map(binToHex), params.threshold);
  try {
    const beneficiary = binToHex(addressToLockingBytecode(params.beneficiaryAddress));
    const clash = params.verifierPubkeys.findIndex((pk) => beneficiary === '76a914' + binToHex(hash160(pk)) + '88ac');
    if (clash >= 0) issues.push('Verifier must not be the beneficiary');
  } catch (e) {
    issues.push((e as Error).message);
  }
  if (!Number.isInteger(params.deadline) || params.deadline >= 500_000_000) issues.push('The deadline must be a block height');
  return issues;
}

/** Did the user paste a CashAddress where a verifier public key belongs? */
export const looksLikeAddress = (s: string) => /^(bitcoincash:|bchtest:|bchreg:)?[qpzr][0-9a-z]{40,}$/i.test(s.trim());
