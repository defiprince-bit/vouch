'use client';
// Browser-side v2 (quorum) actions. Wallet signing goes through WizardConnect exactly like v1: the
// wallet fills the one all-zero placeholder signature in the unlocking bytecode (its own slot) and
// returns the signed tx WITHOUT broadcasting; we lift its signature out and add it to the bundle.
import { placeholderSignature, type SpendableUtxo } from 'cashscript';
import { hexToBin, binToHex, hashTransaction } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { StoredPledge, QuorumProgress } from './pledges';
import { STAKER_PATH, toWcSignRequest, type InputPath } from './wc';
import { getProvider } from './vouch';
import {
  buildQuorumKeep,
  buildQuorumBreakByVerifier,
  buildQuorumBreakByStaker,
  buildQuorumForfeit,
  quorumSigsFromTx,
  isValidSpendSig,
  countSigs,
  QUORUM_FEE,
  type SlotSigners,
} from './quorum';
import { quorumContract, requestSpends, checkRequestSigs, type QuorumTerms, type QuorumVerifyRequest } from './quorumShare';

/** The v2 pledge terms carried in links and sent to the server. */
export function quorumTerms(p: StoredPledge): QuorumTerms {
  if (p.version !== 2 || !p.verifiers || !p.threshold) throw new Error('Not a quorum pledge');
  return {
    id: p.id,
    promise: p.promise,
    stakeSats: p.stakeSats,
    deadline: p.deadline,
    beneficiaryAddress: p.beneficiaryAddress,
    stakerPubkey: p.stakerPubkey,
    contractAddress: p.contractAddress,
    network: p.network,
    verifiers: p.verifiers.map((v) => ({ pubkey: v.pubkey, ...(v.name ? { name: v.name } : {}) })),
    threshold: p.threshold,
    ...(p.beneficiaryName ? { beneficiaryName: p.beneficiaryName } : {}),
    ...(p.deadlineAt ? { deadlineAt: p.deadlineAt } : {}),
  };
}

async function signWithWallet(manager: DappConnectionManager, builder: Parameters<typeof toWcSignRequest>[0], path: InputPath, userPrompt: string) {
  const req = toWcSignRequest(builder, [path], { broadcast: false, userPrompt });
  const res = await manager.signTransaction(req as unknown as Parameters<DappConnectionManager['signTransaction']>[0]);
  if (res.error || !res.signedTransaction) throw new Error(res.error ?? 'Wallet returned no transaction');
  return res.signedTransaction;
}

async function lockedUtxo(p: StoredPledge): Promise<SpendableUtxo> {
  const c = quorumContract(quorumTerms(p));
  const utxo = (await c.getUtxos()).filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!utxo) throw new Error('Nothing locked in this pledge yet');
  return utxo;
}

/**
 * Staker pre-signs the refund (every verifier slot empty) and gets the share link payload.
 * Signatures already collected for the same UTXO are kept.
 */
export async function prepareQuorumRequest(manager: DappConnectionManager, p: StoredPledge): Promise<QuorumVerifyRequest> {
  const utxo = await lockedUtxo(p);
  const utxoJson = { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() };
  const n = p.verifiers!.length;
  const same = p.quorum && p.quorum.utxo.txid === utxo.txid && p.quorum.utxo.vout === utxo.vout;
  const base: QuorumVerifyRequest = {
    v: 2,
    pledge: quorumTerms(p),
    utxo: utxoJson,
    fee: QUORUM_FEE.toString(),
    stakerSig: '',
    keepSigs: same ? p.quorum!.keepSigs.slice(0, n) : Array(n).fill(null),
    breakSigs: same ? p.quorum!.breakSigs.slice(0, n) : Array(n).fill(null),
  };
  const s = requestSpends(base);
  if (same && p.quorum!.stakerSig && isValidSpendSig(s.keepSighash(), hexToBin(p.quorum!.stakerSig), hexToBin(p.stakerPubkey))) {
    return { ...base, stakerSig: p.quorum!.stakerSig };
  }
  const builder = buildQuorumKeep({ ...s, stakerSig: placeholderSignature(), verifierSigs: [] });
  const txHex = await signWithWallet(manager, builder, [0, STAKER_PATH.name, STAKER_PATH.index], 'Vouch: pre-sign your refund. Nothing is sent until enough verifiers approve.');
  const stakerSig = quorumSigsFromTx(txHex, 'keep').stakerSig;
  if (!stakerSig || !isValidSpendSig(s.keepSighash(), stakerSig, hexToBin(p.stakerPubkey))) throw new Error('The wallet’s signature didn’t check out. Try again.');
  return { ...base, stakerSig: binToHex(stakerSig) };
}

/** Persistable progress for the staker's pledge page. */
export const progressOf = (r: QuorumVerifyRequest): QuorumProgress => ({ utxo: r.utxo, stakerSig: r.stakerSig, keepSigs: r.keepSigs, breakSigs: r.breakSigs });

/**
 * A verifier signs their slot (keep = approve the refund, break = vote it broken). Returns the
 * request with their signature added. Nothing is broadcast here.
 */
export async function signQuorumSlot(manager: DappConnectionManager, r: QuorumVerifyRequest, slot: number, walletIndex: number, kind: 'keep' | 'break') {
  const s = requestSpends(r);
  const verifierSigs: SlotSigners = [];
  verifierSigs[slot] = placeholderSignature();
  const builder =
    kind === 'keep'
      ? buildQuorumKeep({ ...s, stakerSig: hexToBin(r.stakerSig), verifierSigs })
      : buildQuorumBreakByVerifier({ ...s, verifierSigs, beneficiaryAddress: r.pledge.beneficiaryAddress });
  const prompt =
    kind === 'keep'
      ? `Vouch: approve “${r.pledge.promise}”. Your signature counts towards the ${r.pledge.threshold} needed to refund your friend.`
      : `Vouch: vote “${r.pledge.promise}” broken. With ${r.pledge.threshold} votes the stake goes to the beneficiary.`;
  const txHex = await signWithWallet(manager, builder, [0, STAKER_PATH.name, walletIndex], prompt);
  const sig = quorumSigsFromTx(txHex, kind).slots[slot];
  const hash = kind === 'keep' ? s.keepSighash() : s.breakSighash();
  if (!sig || !isValidSpendSig(hash, sig, hexToBin(r.pledge.verifiers[slot].pubkey))) throw new Error('The wallet’s signature didn’t check out for your verifier slot.');
  const key = kind === 'keep' ? 'keepSigs' : 'breakSigs';
  const next = r[key].slice();
  next[slot] = binToHex(sig);
  return { ...r, [key]: next } as QuorumVerifyRequest;
}

/** Ask the Vouch demo verifier for its signature on its slot (keep only). */
export async function demoQuorumSig(r: QuorumVerifyRequest, note: string): Promise<QuorumVerifyRequest> {
  const res = await fetch('/api/verifier', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'keep', pledge: { ...r.pledge, version: 2 }, confirm: true, note }),
  });
  const j = (await res.json()) as { verifierSig?: string; slot?: number; utxo?: { txid: string; vout: number }; error?: string };
  if (!res.ok || !j.verifierSig || j.slot === undefined) throw new Error(j.error ?? 'The demo verifier refused');
  if (j.utxo && (j.utxo.txid !== r.utxo.txid || j.utxo.vout !== r.utxo.vout)) throw new Error('The locked coins changed; ask the staker for a fresh link');
  const next = r.keepSigs.slice();
  next[j.slot] = j.verifierSig;
  const merged = { ...r, keepSigs: next };
  if (!checkRequestSigs(merged).keepSigs[j.slot]) throw new Error('The demo verifier’s signature didn’t check out');
  return merged;
}

const hexOrNull = (s: string | null) => (s ? hexToBin(s) : null);

/** Broadcast the refund once the staker's signature and M valid verifier signatures are in. */
export async function broadcastQuorumKeep(r: QuorumVerifyRequest): Promise<{ txid: string }> {
  const st = checkRequestSigs(r);
  if (!st.stakerSigOk) throw new Error('The staker’s signature in this link is invalid');
  if (st.keepCount < r.pledge.threshold) throw new Error(`${st.keepCount} of ${r.pledge.threshold} approvals so far`);
  const s = requestSpends(r);
  const hex = buildQuorumKeep({ ...s, stakerSig: hexToBin(r.stakerSig), verifierSigs: st.keepSigs.map(hexOrNull) }).build();
  return { txid: await sendHex(s.provider, hex) };
}

/** Broadcast the verifier break once M valid break votes are in. */
export async function broadcastQuorumBreak(r: QuorumVerifyRequest): Promise<{ txid: string }> {
  const st = checkRequestSigs(r);
  if (st.breakCount < r.pledge.threshold) throw new Error(`${st.breakCount} of ${r.pledge.threshold} votes so far`);
  const s = requestSpends(r);
  const hex = buildQuorumBreakByVerifier({ ...s, verifierSigs: st.breakSigs.map(hexOrNull), beneficiaryAddress: r.pledge.beneficiaryAddress }).build();
  return { txid: await sendHex(s.provider, hex) };
}

async function sendHex(provider: ReturnType<typeof getProvider>, hex: string): Promise<string> {
  const txid = hashTransaction(hexToBin(hex));
  try {
    await provider.sendRawTransaction(hex);
  } catch (e) {
    if (!/already|known|in.?mempool|duplicate/i.test((e as Error).message)) throw e;
  }
  return txid;
}

/** Staker admits it (v2): same as v1, through the quorum contract. */
export async function quorumBreakByStaker(manager: DappConnectionManager, p: StoredPledge) {
  const provider = getProvider(p.network);
  const contract = quorumContract(quorumTerms(p), provider);
  const utxo = await lockedUtxo(p);
  const builder = buildQuorumBreakByStaker({ contract, provider, utxo, stakerSig: placeholderSignature(), beneficiaryAddress: p.beneficiaryAddress });
  const req = toWcSignRequest(builder, [[0, STAKER_PATH.name, STAKER_PATH.index]], { broadcast: true, userPrompt: 'Vouch: I broke it. Send the stake to the beneficiary.' });
  const res = await manager.signTransaction(req as unknown as Parameters<DappConnectionManager['signTransaction']>[0]);
  if (res.error || !res.signedTransaction) throw new Error(res.error ?? 'Wallet returned no transaction');
  return { txid: await sendHex(provider, res.signedTransaction) };
}

/** Anyone settles an expired v2 pledge to its beneficiary (browser first; the caller falls back to /api/settle). */
export async function quorumForfeit(p: StoredPledge): Promise<string> {
  const provider = getProvider(p.network);
  const contract = quorumContract(quorumTerms(p), provider);
  const utxo = await lockedUtxo(p);
  const tx = await buildQuorumForfeit({ contract, provider, utxo, beneficiaryAddress: p.beneficiaryAddress, deadline: p.deadline }).send();
  return tx.txid;
}

export { countSigs };
