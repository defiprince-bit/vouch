// CommitCash contract helpers: instantiate a pledge covenant and build its four spend transactions.
import {
  Contract,
  ElectrumNetworkProvider,
  TransactionBuilder,
  type NetworkProvider,
  type SpendableUtxo,
  type SignatureTemplate,
} from 'cashscript';
import {
  cashAddressToLockingBytecode,
  encodeCashAddress,
  hash160,
  binToHex,
  hexToBin,
  CashAddressType,
} from '@bitauth/libauth';
import artifact from './CommitCash.artifact';

export type BchNetwork = 'chipnet' | 'mainnet';

/** Default fee cap baked into each pledge (sats). */
export const DEFAULT_MAX_FEE = 2000n;
/** Fee we actually pay for a 1-in/1-out spend (~1 sat/byte, well under the cap). */
export const DEFAULT_FEE = 1000n;
export const DUST = 546n;
/** Smallest stake the UI allows: dust + fee cap + margin. */
export const MIN_STAKE = DUST + DEFAULT_MAX_FEE + 2454n; // 5000 sats

/** A signer: a SignatureTemplate (local key) or a raw 65-byte Schnorr/DER signature from a wallet. */
export type Signer = SignatureTemplate | Uint8Array;

export interface PledgeParams {
  stakerPubkey: Uint8Array;
  verifierPubkey: Uint8Array;
  beneficiaryAddress: string;
  /** Block height (< 500_000_000) or MTP unix seconds (>= 500_000_000). */
  deadline: number;
  /** 16 random bytes, hex. Makes every pledge address unique. */
  pledgeId: string;
  maxFee?: bigint;
}

/** Network is chipnet unless NEXT_PUBLIC_BCH_NETWORK=mainnet is set explicitly. */
export function getNetwork(): BchNetwork {
  return process.env.NEXT_PUBLIC_BCH_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';
}

export function getProvider(network: BchNetwork = getNetwork()): NetworkProvider {
  return new ElectrumNetworkProvider(network);
}

export function newPledgeId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return binToHex(bytes);
}

export function addressToLockingBytecode(address: string): Uint8Array {
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === 'string') throw new Error(`Invalid BCH address: ${result}`);
  return result.bytecode;
}

/** The staker's P2PKH address — the only place a keep can pay. */
export function stakerP2pkhAddress(stakerPubkey: Uint8Array, network: BchNetwork = getNetwork()): string {
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  return encodeCashAddress({ prefix, type: CashAddressType.p2pkh, payload: hash160(stakerPubkey) }).address;
}

/** UI-side guards from the trust model (not enforceable on-chain). */
export function validatePledge(params: PledgeParams, stake: bigint): string[] {
  const issues: string[] = [];
  if (stake < MIN_STAKE) issues.push(`Stake must be at least ${MIN_STAKE} sats`);
  if (binToHex(params.verifierPubkey) === binToHex(params.stakerPubkey)) {
    issues.push('Verifier is the staker: this is a self-honour pledge');
  }
  try {
    const beneficiary = binToHex(addressToLockingBytecode(params.beneficiaryAddress));
    const verifierP2pkh = '76a914' + binToHex(hash160(params.verifierPubkey)) + '88ac';
    if (beneficiary === verifierP2pkh) issues.push('Verifier must not be the beneficiary');
  } catch (e) {
    issues.push((e as Error).message);
  }
  return issues;
}

export function createPledgeContract(params: PledgeParams, provider: NetworkProvider) {
  if (params.stakerPubkey.length !== 33 || params.verifierPubkey.length !== 33) {
    throw new Error('Pubkeys must be 33-byte compressed keys');
  }
  if (!Number.isInteger(params.deadline) || params.deadline <= 0) throw new Error('Bad deadline');
  const pledgeId = hexToBin(params.pledgeId);
  if (pledgeId.length !== 16) throw new Error('pledgeId must be 16 bytes');
  const maxFee = params.maxFee ?? DEFAULT_MAX_FEE;
  return new Contract(
    artifact,
    [
      params.stakerPubkey,
      params.verifierPubkey,
      addressToLockingBytecode(params.beneficiaryAddress),
      BigInt(params.deadline),
      pledgeId,
      maxFee,
    ],
    { provider, contractType: 'p2sh32' },
  );
}

export type PledgeContract = ReturnType<typeof createPledgeContract>;

function payout(utxo: SpendableUtxo, fee: bigint): bigint {
  const value = utxo.satoshis - fee;
  if (value < DUST) throw new Error('Stake too small to pay out above dust');
  return value;
}

interface SpendBase {
  contract: PledgeContract;
  provider: NetworkProvider;
  utxo: SpendableUtxo;
  fee?: bigint;
}

/** keep: staker + verifier sign; the covenant only lets coins return to the staker's P2PKH. */
export function buildKeep(o: SpendBase & { stakerSig: Signer; verifierSig: Signer; stakerAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.keep(o.stakerSig, o.verifierSig))
    .addOutput({ to: o.stakerAddress, amount: payout(o.utxo, o.fee ?? DEFAULT_FEE) });
}

/** breakByStaker: staker admits the miss; stake goes to the beneficiary. */
export function buildBreakByStaker(o: SpendBase & { stakerSig: Signer; beneficiaryAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.breakByStaker(o.stakerSig))
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? DEFAULT_FEE) });
}

/** breakByVerifier: verifier rules the promise broken; stake goes to the beneficiary. */
export function buildBreakByVerifier(o: SpendBase & { verifierSig: Signer; beneficiaryAddress: string }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.breakByVerifier(o.verifierSig))
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? DEFAULT_FEE) });
}

/** forfeit: no signature; after the deadline anyone can push the stake to the beneficiary. */
export function buildForfeit(o: SpendBase & { beneficiaryAddress: string; deadline: number }) {
  return new TransactionBuilder({ provider: o.provider })
    .addInput(o.utxo, o.contract.unlock.forfeit())
    .addOutput({ to: o.beneficiaryAddress, amount: payout(o.utxo, o.fee ?? DEFAULT_FEE) })
    .setLocktime(o.deadline);
}
