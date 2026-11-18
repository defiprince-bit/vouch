// v2 (quorum) verify links. One link that any verifier opens; it carries the pledge terms, the locked
// UTXO, the staker's pre-signed keep signature and every verifier signature collected so far:
//
//   staker pre-signs -> link#0 -> verifier A signs -> link#A (sig A) -> verifier B signs -> ...
//
// Each verifier gets the latest link, adds their signature and passes it on (to the next verifier or
// back to the staker). Whoever holds M valid signatures broadcasts. No backend: the bundle travels in
// the URL fragment, which browsers never send to the server. Order doesn't matter, and two partial
// links can be merged slot by slot (the staker's pledge page does that when links come back).
import { binToHex, hexToBin } from '@bitauth/libauth';
import { placeholderSignature, type NetworkProvider } from 'cashscript';
import type { StoredPledge, QuorumVerifier } from './pledges';
import { checkLinkNetwork, decodeVerifyRequest, fromB64Url, toB64Url, type VerifyRequest } from './share';
import { stakerP2pkhAddress, getProvider } from './vouch';
import {
  createQuorumContract,
  buildQuorumKeep,
  buildQuorumBreakByVerifier,
  quorumShapeIssues,
  spendSighash,
  validSlotSigs,
  isValidSpendSig,
  mergeSlotSigs,
  QUORUM_FEE,
  MAX_VERIFIERS,
} from './quorum';

export type QuorumTerms = Pick<
  StoredPledge,
  'id' | 'promise' | 'stakeSats' | 'deadline' | 'beneficiaryAddress' | 'stakerPubkey' | 'contractAddress' | 'network'
> &
  Partial<Pick<StoredPledge, 'beneficiaryName' | 'deadlineAt'>> & {
    verifiers: Array<Pick<QuorumVerifier, 'pubkey' | 'name'>>;
    threshold: number;
  };

export interface QuorumVerifyRequest {
  v: 2;
  pledge: QuorumTerms;
  utxo: { txid: string; vout: number; satoshis: string };
  fee: string;
  /** Staker's signature over the deterministic keep tx (hex). */
  stakerSig: string;
  /** Per verifier slot: hex keep signature, or null. */
  keepSigs: Array<string | null>;
  /** Per verifier slot: hex breakByVerifier signature, or null. */
  breakSigs: Array<string | null>;
}

export type AnyVerifyRequest = VerifyRequest | QuorumVerifyRequest;
export const isQuorumRequest = (r: AnyVerifyRequest): r is QuorumVerifyRequest => r.v === 2;

const SIG = /^[0-9a-f]{130}$/i;
const sigList = (a: unknown, n: number): Array<string | null> =>
  Array.from({ length: n }, (_, i) => {
    const s = Array.isArray(a) ? a[i] : null;
    return typeof s === 'string' && SIG.test(s) ? s.toLowerCase() : null;
  });

/** Parse a /verify#pledge=… fragment of either version. */
export function decodeAnyVerifyRequest(fragment: string): AnyVerifyRequest {
  let raw: { v?: unknown };
  try {
    raw = JSON.parse(fromB64Url(fragment.replace(/^#/, '').replace(/^pledge=/, ''))) as { v?: unknown };
  } catch {
    throw new Error('Invalid verify link: ask your friend to copy the whole link again');
  }
  if (raw?.v !== 2) return decodeVerifyRequest(fragment);
  const r = raw as QuorumVerifyRequest;
  if (!r.pledge || !r.utxo || !SIG.test(r.stakerSig ?? '') || !/^[0-9a-f]{64}$/i.test(r.utxo.txid ?? '')) throw new Error('Invalid verify link');
  const p = r.pledge;
  if (!Array.isArray(p.verifiers)) throw new Error('Invalid verify link');
  const issues = quorumShapeIssues(p.stakerPubkey ?? '', p.verifiers.map((v) => v?.pubkey ?? ''), p.threshold);
  if (issues.length) throw new Error(`Invalid verify link: ${issues[0]}`);
  if (!Number.isInteger(p.deadline) || p.deadline <= 0 || p.deadline >= 500_000_000) throw new Error('Invalid verify link: bad deadline');
  checkLinkNetwork(p);
  // The terms must really describe the contract the link points at.
  const c = quorumContract(p);
  if (c.address !== p.contractAddress) throw new Error('Invalid verify link: the pledge terms don’t match its contract address');
  const n = p.verifiers.length;
  return { ...r, keepSigs: sigList(r.keepSigs, n), breakSigs: sigList(r.breakSigs, n) };
}

export function encodeQuorumRequest(r: QuorumVerifyRequest): string {
  return toB64Url(JSON.stringify(r));
}

export function quorumVerifyLink(origin: string, r: QuorumVerifyRequest): string {
  return `${origin}/verify#pledge=${encodeQuorumRequest(r)}`;
}

export function quorumContract(p: Pick<QuorumTerms, 'stakerPubkey' | 'verifiers' | 'threshold' | 'beneficiaryAddress' | 'deadline' | 'id' | 'network'>, provider?: NetworkProvider) {
  return createQuorumContract(
    {
      stakerPubkey: hexToBin(p.stakerPubkey),
      verifierPubkeys: p.verifiers.map((v) => hexToBin(v.pubkey)),
      threshold: p.threshold,
      beneficiaryAddress: p.beneficiaryAddress,
      deadline: p.deadline,
      pledgeId: p.id,
    },
    provider ?? getProvider(p.network),
  );
}

/** The (deterministic) keep and break transactions a request's signatures are over. */
export function requestSpends(r: Pick<QuorumVerifyRequest, 'pledge' | 'utxo' | 'fee'>, provider?: NetworkProvider) {
  const prov = provider ?? getProvider(r.pledge.network);
  const contract = quorumContract(r.pledge, prov);
  const utxo = { txid: r.utxo.txid, vout: r.utxo.vout, satoshis: BigInt(r.utxo.satoshis), lockingBytecode: contract.lockingBytecode };
  const fee = BigInt(r.fee || QUORUM_FEE.toString());
  const stakerAddress = stakerP2pkhAddress(hexToBin(r.pledge.stakerPubkey), r.pledge.network);
  const base = { contract, provider: prov, utxo, fee };
  return {
    contract,
    provider: prov,
    utxo,
    fee,
    stakerAddress,
    keepSighash: () => spendSighash(contract, buildQuorumKeep({ ...base, stakerSig: placeholderSignature(), verifierSigs: [], stakerAddress })),
    breakSighash: () => spendSighash(contract, buildQuorumBreakByVerifier({ ...base, verifierSigs: [], beneficiaryAddress: r.pledge.beneficiaryAddress })),
  };
}

export interface QuorumState {
  keepSigs: Array<string | null>;
  breakSigs: Array<string | null>;
  keepCount: number;
  breakCount: number;
  stakerSigOk: boolean;
  /** Slots whose signature in the link was invalid and got dropped. */
  dropped: number[];
}

/** Check every signature in a request against its spend; invalid ones are dropped (never broadcast). */
export function checkRequestSigs(r: QuorumVerifyRequest, provider?: NetworkProvider): QuorumState {
  const s = requestSpends(r, provider);
  const pubs = r.pledge.verifiers.map((v) => hexToBin(v.pubkey));
  const keepHash = s.keepSighash();
  const keepSigs = validSlotSigs(keepHash, pubs, r.keepSigs);
  const breakSigs = validSlotSigs(s.breakSighash(), pubs, r.breakSigs);
  const dropped = r.pledge.verifiers
    .map((_, i) => i)
    .filter((i) => (r.keepSigs[i] && !keepSigs[i]) || (r.breakSigs[i] && !breakSigs[i]));
  return {
    keepSigs,
    breakSigs,
    keepCount: keepSigs.filter(Boolean).length,
    breakCount: breakSigs.filter(Boolean).length,
    stakerSigOk: isValidSpendSig(keepHash, hexToBin(r.stakerSig), hexToBin(r.pledge.stakerPubkey)),
    dropped,
  };
}

/** Merge signatures from another link for the same pledge + UTXO into `r`. */
export function mergeRequests(r: QuorumVerifyRequest, other: QuorumVerifyRequest): QuorumVerifyRequest {
  if (other.pledge.contractAddress !== r.pledge.contractAddress) throw new Error('That link is for a different pledge');
  if (other.utxo.txid !== r.utxo.txid || other.utxo.vout !== r.utxo.vout) throw new Error('That link is for an older lock of this pledge');
  const n = r.pledge.verifiers.length;
  return { ...r, keepSigs: mergeSlotSigs(r.keepSigs, other.keepSigs, n), breakSigs: mergeSlotSigs(r.breakSigs, other.breakSigs, n) };
}

/** Verifier list for display: name, whether they approved / voted break. */
export function slotLabels(p: Pick<QuorumTerms, 'verifiers'>, demoPubkey?: string | null) {
  return p.verifiers.map((v, i) => ({
    slot: i,
    pubkey: v.pubkey,
    isDemo: !!demoPubkey && v.pubkey.toLowerCase() === demoPubkey.toLowerCase(),
    name: v.name?.trim() || (demoPubkey && v.pubkey.toLowerCase() === demoPubkey.toLowerCase() ? 'Vouch demo verifier' : `Verifier ${i + 1}`),
  }));
}

export const sigHex = (s: Uint8Array) => binToHex(s);
export { MAX_VERIFIERS };
