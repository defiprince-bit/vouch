// Server-only: the Vouch demo verifier and the keeper that settles expired pledges.
// The verifier key comes from COMMITCASH_VERIFIER_WIF (server env, never NEXT_PUBLIC_, never committed).
// Only import this from route handlers / scripts.
import { SignatureTemplate, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  createPledgeContract,
  buildKeep,
  buildForfeit,
  verifierKeepSignature,
  verifyByHeight,
  stakerP2pkhAddress,
  DEFAULT_FEE,
  type BchNetwork,
} from '@/lib/vouch';
import { checkAddress } from '@/lib/network';
import { secretMatchesPledge } from '@/lib/listSecret';
import { createQuorumContract, slotSignature, buildQuorumForfeit, quorumShapeIssues, QUORUM_FEE } from '@/lib/quorum';

export interface PledgeTerms {
  id: string;
  deadline: number;
  beneficiaryAddress: string;
  stakerPubkey: string;
  verifierPubkey: string;
  network: BchNetwork;
  /** v2 (VouchQuorum) only. */
  version?: 2;
  /**
   * v1.1 / v2.1: the verifier(s) alone sign the refund (contracts/Vouch11.cash,
   * contracts/VouchQuorum21.cash). Missing = the original contracts. Part of the contract address.
   */
  verifierRefund?: true;
  verifierPubkeys?: string[];
  threshold?: number;
}

/** Block heights only: at or above this, nLocktime is a clock time, which the verify-by cutoff and keeper don't handle. */
export const LOCKTIME_THRESHOLD = 500_000_000;

/** The demo verifier only signs mainnet pledges when DEMO_VERIFIER_MAINNET=1 is set on the server. */
export const demoVerifierAllowed = (network: BchNetwork) => network !== 'mainnet' || process.env.DEMO_VERIFIER_MAINNET === '1';

export class VerifierError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function loadVerifierKey(wif = process.env.COMMITCASH_VERIFIER_WIF): SignatureTemplate | null {
  if (!wif) return null;
  return new SignatureTemplate(wif.trim());
}

export function verifierPubkeyHex(key: SignatureTemplate): string {
  return binToHex(key.publicKey);
}

export function parseTerms(t: unknown): PledgeTerms {
  const p = t as Partial<PledgeTerms>;
  const hex33 = /^[0-9a-f]{66}$/i;
  if (!p || typeof p !== 'object') throw new VerifierError('Missing pledge');
  if (!/^[0-9a-f]{32}$/i.test(p.id ?? '')) throw new VerifierError('Bad pledge id');
  if (!Number.isInteger(p.deadline) || (p.deadline as number) <= 0) throw new VerifierError('Bad deadline');
  if ((p.deadline as number) >= LOCKTIME_THRESHOLD) throw new VerifierError('Bad deadline: must be a block height, not a clock time');
  if (p.version === 2) {
    if (!Array.isArray(p.verifierPubkeys) || !hex33.test(p.stakerPubkey ?? '')) throw new VerifierError('Bad pubkeys');
    const issues = quorumShapeIssues(p.stakerPubkey!, p.verifierPubkeys.map(String), p.threshold);
    if (issues.length) throw new VerifierError(issues[0]);
    p.verifierPubkey = p.verifierPubkeys[0];
  } else if (p.version !== undefined && (p.version as number) !== 1) {
    throw new VerifierError('Unknown pledge version');
  }
  if (p.verifierRefund !== undefined && typeof p.verifierRefund !== 'boolean') throw new VerifierError('Bad contract version');
  if (!p.verifierRefund) delete p.verifierRefund;
  if (!hex33.test(p.stakerPubkey ?? '') || !hex33.test(p.verifierPubkey ?? '')) throw new VerifierError('Bad pubkeys');
  if (p.network !== 'chipnet' && p.network !== 'mainnet') throw new VerifierError('Bad network');
  if (typeof p.beneficiaryAddress !== 'string') throw new VerifierError('Bad beneficiary');
  const bene = checkAddress(p.beneficiaryAddress, p.network);
  if (!bene.ok) throw new VerifierError(`Beneficiary: ${bene.error}`);
  return p as PledgeTerms;
}

async function loadPledge(termsIn: unknown, provider: NetworkProvider) {
  const terms = parseTerms(termsIn);
  if (provider.network !== terms.network) throw new VerifierError('Network mismatch');
  const contract = createPledgeContract(
    {
      stakerPubkey: hexToBin(terms.stakerPubkey),
      verifierPubkey: hexToBin(terms.verifierPubkey),
      beneficiaryAddress: terms.beneficiaryAddress,
      deadline: terms.deadline,
      pledgeId: terms.id,
      verifierRefund: terms.verifierRefund === true,
    },
    provider,
  );
  // Never trust a client-supplied UTXO: read what is actually locked at the contract.
  const utxo = await largestUtxo(contract);
  return { terms, contract, utxo };
}

async function largestUtxo(contract: { getUtxos(): Promise<SpendableUtxo[]> }) {
  const utxos = await contract.getUtxos();
  const utxo = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!utxo) throw new VerifierError('Nothing is locked in this pledge', 404);
  return utxo;
}

async function loadQuorumPledge(terms: PledgeTerms, provider: NetworkProvider) {
  const contract = createQuorumContract(
    {
      stakerPubkey: hexToBin(terms.stakerPubkey),
      verifierPubkeys: terms.verifierPubkeys!.map((k) => hexToBin(k)),
      threshold: terms.threshold!,
      beneficiaryAddress: terms.beneficiaryAddress,
      deadline: terms.deadline,
      pledgeId: terms.id,
      verifierRefund: terms.verifierRefund === true,
    },
    provider,
  );
  return { contract, utxo: await largestUtxo(contract) };
}

const utxoJson = (u: SpendableUtxo) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString() });

/**
 * Demo verifier approves a keep. Rules: the pledge names this verifier, the requester confirmed
 * and described what they did, and it's before deadline - ~1h.
 * v1 / v2 (the refund also needs the staker's signature, so that signature is the staker's consent):
 * - With `stakerSig` (staker signed first): assemble the full keep and broadcast it now.
 * - Without: return the verifier signature; the staker's wallet completes and broadcasts.
 * v1.1 / v2.1 (the verifiers alone sign the refund): the request must carry the staker proof, the
 * listSecret the pledge id commits to (src/lib/listSecret.ts), which only the browser that made the
 * pledge holds. Otherwise anyone who knows a pledge's terms (they're on the wall) could make the
 * demo verifier end it early. The secret is checked and dropped, never stored or logged.
 * - v1.1: the demo verifier's signature is the whole refund, so it's broadcast now.
 * - v2.1: return its slot signature; the client broadcasts once M are in.
 */
export interface KeepApproval {
  txid?: string;
  verifierSig?: string;
  /** v2: which verifier slot `verifierSig` is for. */
  slot?: number;
  utxo: { txid: string; vout: number; satoshis: string };
  fee?: string;
}

export async function approveKeep(
  body: KeepBody,
  provider: NetworkProvider,
  key: SignatureTemplate,
): Promise<KeepApproval> {
  if (body.confirm !== true || !body.note || body.note.trim().length < 3) {
    throw new VerifierError('Confirm the promise was kept and say what you did');
  }
  const terms0 = parseTerms(body.pledge);
  if (!demoVerifierAllowed(terms0.network)) throw new VerifierError(DEMO_MAINNET_REFUSED, 403);
  if (terms0.verifierRefund && !secretMatchesPledge(body.listSecret, body.listNonce, body.habit, terms0.id)) {
    throw new VerifierError(STAKER_PROOF_REQUIRED, 403);
  }
  if (terms0.version === 2) return approveQuorumKeep(terms0, provider, key);
  const { terms, contract, utxo } = await loadPledge(body.pledge, provider);
  if (terms.verifierPubkey.toLowerCase() !== verifierPubkeyHex(key)) {
    throw new VerifierError('This pledge names a different verifier', 403);
  }
  const height = await provider.getBlockHeight();
  if (height >= verifyByHeight(terms.deadline)) {
    throw new VerifierError(`Too late: keep must be approved before block ${verifyByHeight(terms.deadline)} (now ${height})`, 409);
  }
  const stakerAddress = stakerP2pkhAddress(hexToBin(terms.stakerPubkey), terms.network);
  if (terms.verifierRefund) {
    const tx = await buildKeep({ contract, provider, utxo, verifierSig: key, stakerAddress }).send();
    return { txid: tx.txid, utxo: utxoJson(utxo) };
  }
  if (body.stakerSig) {
    if (!/^[0-9a-f]{130}$/i.test(body.stakerSig)) throw new VerifierError('Bad staker signature');
    const tx = await buildKeep({ contract, provider, utxo, stakerSig: hexToBin(body.stakerSig), verifierSig: key, stakerAddress }).send();
    return { txid: tx.txid, utxo: utxoJson(utxo) };
  }
  const verifierSig = verifierKeepSignature({ contract, provider, utxo, verifier: key, stakerAddress });
  return { verifierSig: binToHex(verifierSig), utxo: utxoJson(utxo), fee: DEFAULT_FEE.toString() };
}

/**
 * v2: the demo verifier is one of the quorum. It signs its own slot of the keep and returns the
 * signature; the client adds it to the link bundle and broadcasts once M are in. Same rules as v1.
 */
async function approveQuorumKeep(terms: PledgeTerms, provider: NetworkProvider, key: SignatureTemplate) {
  if (provider.network !== terms.network) throw new VerifierError('Network mismatch');
  const slot = terms.verifierPubkeys!.findIndex((k) => k.toLowerCase() === verifierPubkeyHex(key));
  if (slot < 0) throw new VerifierError('This pledge doesn’t name the demo verifier', 403);
  const { contract, utxo } = await loadQuorumPledge(terms, provider);
  const height = await provider.getBlockHeight();
  if (height >= verifyByHeight(terms.deadline)) {
    throw new VerifierError(`Too late: keep must be approved before block ${verifyByHeight(terms.deadline)} (now ${height})`, 409);
  }
  const stakerAddress = stakerP2pkhAddress(hexToBin(terms.stakerPubkey), terms.network);
  const sig = slotSignature('keep', { contract, provider, utxo, slot, signer: key, stakerAddress, beneficiaryAddress: terms.beneficiaryAddress });
  return { slot, verifierSig: binToHex(sig), utxo: utxoJson(utxo), fee: QUORUM_FEE.toString() };
}

export const STAKER_PROOF_REQUIRED =
  'Only the staker can ask the demo verifier for this refund: ask from the pledge page in the browser you made the pledge in.';

/** What a demo-verifier keep request carries. listSecret / listNonce / habit: the v1.1 / v2.1 staker proof. */
export interface KeepBody {
  pledge: unknown;
  confirm?: boolean;
  note?: string;
  stakerSig?: string;
  listSecret?: unknown;
  listNonce?: unknown;
  habit?: unknown;
}

export const DEMO_MAINNET_REFUSED = 'The Vouch demo verifier is chipnet-only. On mainnet, name a friend as your verifier.';

/**
 * The demo verifier only ever co-signs KEEP. It never signs breakByVerifier: this endpoint can't
 * authenticate the caller, so anyone holding a pledge's terms (the beneficiary included) could
 * otherwise force a demo pledge to break. A demo pledge ends by keep, by expiry (forfeit), or by
 * the staker's own breakByStaker, which the staker signs alone in their wallet.
 */
export const DEMO_BREAK_REFUSED =
  'The demo verifier never signs a break. To break your own pledge, sign "I broke it" in your wallet; after the deadline anyone can settle it to the beneficiary.';

export async function demoVerifierAction(
  body: KeepBody & { action?: string },
  provider: NetworkProvider,
  key: SignatureTemplate,
) {
  if (body.action === 'keep') return approveKeep(body, provider, key);
  if (body.action === 'break') throw new VerifierError(DEMO_BREAK_REFUSED, 403);
  throw new VerifierError('action must be keep');
}

/** Anyone may settle an expired pledge to its beneficiary; no key needed. */
export async function settleExpired(body: { pledge: unknown }, provider: NetworkProvider) {
  const t = parseTerms(body.pledge);
  if (t.version === 2) {
    if (provider.network !== t.network) throw new VerifierError('Network mismatch');
    const { contract, utxo } = await loadQuorumPledge(t, provider);
    const h = await provider.getBlockHeight();
    if (h < t.deadline) throw new VerifierError(`Deadline not reached (block ${t.deadline}, now ${h})`, 409);
    const tx = await buildQuorumForfeit({ contract, provider, utxo, beneficiaryAddress: t.beneficiaryAddress, deadline: t.deadline }).send();
    return { txid: tx.txid };
  }
  const { terms, contract, utxo } = await loadPledge(body.pledge, provider);
  const height = await provider.getBlockHeight();
  if (height < terms.deadline) throw new VerifierError(`Deadline not reached (block ${terms.deadline}, now ${height})`, 409);
  const tx = await buildForfeit({ contract, provider, utxo, beneficiaryAddress: terms.beneficiaryAddress, deadline: terms.deadline }).send();
  return { txid: tx.txid };
}
