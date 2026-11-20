'use client';
// Browser-side pledge actions: build the tx, have the WizardConnect wallet sign it, push it.
import { placeholderSignature, type NetworkProvider, type SpendableUtxo, type TransactionBuilder } from 'cashscript';
import { hexToBin, binToHex, hashTransaction } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { childIndexOfPathName } from '@wizardconnect/core';
import {
  createPledgeContract,
  getProvider,
  buildLock,
  buildKeep,
  buildBreakByStaker,
  buildBreakByVerifier,
  buildForfeit,
  stakerP2pkhAddress,
  DEFAULT_FEE,
} from './vouch';
import { toWcSignRequest, keepSignaturesFromTx, DUMMY_SIGNATURE, STAKER_PATH, type InputPath } from './wc';
import type { StoredPledge } from './pledges';
import { gatherWalletUtxos, lockInputPaths, totalSats } from './walletUtxos';
import type { VerifyRequest } from './share';
import { isQuorumPledge } from './pledges';
import { quorumContract } from './quorumShare';
import { quorumTerms, quorumBreakByStaker, quorumForfeit, stakerProofOf } from './quorumActions';

/** Either contract version, for reads (address, UTXOs). Spends go through the version's own builders. */
export function anyPledgeContract(p: StoredPledge, provider?: NetworkProvider) {
  if (!isQuorumPledge(p)) return pledgeContract(p, provider);
  const prov = provider ?? getProvider(p.network);
  return { provider: prov, contract: quorumContract(quorumTerms(p), prov) };
}

export function pledgeContract(
  p: Pick<StoredPledge, 'stakerPubkey' | 'verifierPubkey' | 'beneficiaryAddress' | 'deadline' | 'id' | 'network' | 'verifierRefund'>,
  provider?: NetworkProvider,
) {
  const prov = provider ?? getProvider(p.network);
  const contract = createPledgeContract(
    {
      stakerPubkey: hexToBin(p.stakerPubkey),
      verifierPubkey: hexToBin(p.verifierPubkey),
      beneficiaryAddress: p.beneficiaryAddress,
      deadline: p.deadline,
      pledgeId: p.id,
      verifierRefund: p.verifierRefund === true,
    },
    prov,
  );
  return { provider: prov, contract };
}

export const pledgeTerms = (p: StoredPledge) => ({
  id: p.id,
  deadline: p.deadline,
  beneficiaryAddress: p.beneficiaryAddress,
  stakerPubkey: p.stakerPubkey,
  verifierPubkey: p.verifierPubkey,
  network: p.network,
  ...(p.verifierRefund ? { verifierRefund: true as const } : {}),
  ...(isQuorumPledge(p) ? { version: 2 as const, verifierPubkeys: p.verifiers!.map((v) => v.pubkey), threshold: p.threshold } : {}),
});

/** Ask the wallet to sign; if `broadcast`, also push it ourselves (harmless if the wallet already did). */
async function walletSign(
  manager: DappConnectionManager,
  provider: NetworkProvider,
  builder: TransactionBuilder,
  inputPaths: InputPath[],
  opts: { broadcast: boolean; userPrompt: string },
): Promise<{ txHex: string; txid: string }> {
  const req = toWcSignRequest(builder, inputPaths, opts);
  const res = await manager.signTransaction(req as unknown as Parameters<DappConnectionManager['signTransaction']>[0]);
  if (res.error || !res.signedTransaction) throw new Error(res.error ?? 'Wallet returned no transaction');
  const txHex = res.signedTransaction;
  const txid = hashTransaction(hexToBin(txHex));
  if (opts.broadcast) {
    try {
      await provider.sendRawTransaction(txHex);
    } catch (e) {
      if (!/already|known|in.?mempool|duplicate|missing.?inputs/i.test((e as Error).message)) throw e;
    }
  }
  return { txHex, txid };
}

async function lockedUtxo(contract: ReturnType<typeof pledgeContract>['contract']): Promise<SpendableUtxo> {
  const utxo = (await contract.getUtxos()).filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!utxo) throw new Error('Nothing locked in this pledge yet');
  return utxo;
}

const stakerPath: InputPath = [0, STAKER_PATH.name, STAKER_PATH.index];

/**
 * Lock the stake using coins from any of the wallet's receive/change addresses (HD wallets spread
 * funds around). Change goes back to the staker's receive/0 address.
 */
export async function lockFromWallet(manager: DappConnectionManager, p: StoredPledge) {
  const { provider, contract } = anyPledgeContract(p);
  const walletAddress = stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network);
  const walletUtxos = await gatherWalletUtxos(manager, provider, p.network);
  const { builder, inputs } = buildLock({ provider, walletUtxos, walletAddress, contractAddress: contract.address, stake: BigInt(p.stakeSats) });
  return walletSign(manager, provider, builder, lockInputPaths(inputs), { broadcast: true, userPrompt: `Vouch: lock ${p.stakeSats} sats on “${p.promise}”` });
}

/** Spendable (non-token) balance across the connected wallet's receive and change addresses. */
export async function walletBalance(manager: DappConnectionManager, network: StoredPledge['network']): Promise<bigint> {
  return totalSats(await gatherWalletUtxos(manager, getProvider(network), network));
}

/**
 * Demo verifier flow.
 * v1.1: the verifier signs the refund alone and the server broadcasts it; no wallet needed. The
 *       request carries this browser's staker proof (listSecret), so only the staker can ask.
 * v1:   verifier first: get the verifier's signature, then the staker signs the refund and it's pushed.
 */
export async function keepWithDemoVerifier(manager: DappConnectionManager | null, p: StoredPledge, note: string): Promise<{ txid: string; txHex?: string }> {
  const proof = p.verifierRefund ? stakerProofOf(p) : null;
  if (p.verifierRefund && !proof) throw new Error('Ask the demo verifier from the browser you made this pledge in');
  const res = await fetch('/api/verifier', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'keep', pledge: pledgeTerms(p), confirm: true, note, ...(proof ?? {}) }),
  });
  const json = (await res.json()) as { txid?: string; verifierSig?: string; utxo?: { txid: string; vout: number; satoshis: string }; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Verifier refused');
  if (p.verifierRefund) {
    if (!json.txid) throw new Error(json.error ?? 'Verifier refused');
    return { txid: json.txid };
  }
  if (!manager) throw new Error('Connect your wallet to sign your refund');
  if (!json.verifierSig || !json.utxo) throw new Error(json.error ?? 'Verifier refused');
  const { provider, contract } = pledgeContract(p);
  const utxo = { ...json.utxo, satoshis: BigInt(json.utxo.satoshis), lockingBytecode: contract.lockingBytecode };
  const builder = buildKeep({
    contract,
    provider,
    utxo,
    stakerSig: placeholderSignature(),
    verifierSig: hexToBin(json.verifierSig),
    stakerAddress: stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network),
  });
  return walletSign(manager, provider, builder, [stakerPath], { broadcast: true, userPrompt: 'Vouch: verifier approved. Sign to get your stake back.' });
}

/**
 * Friend flow: return a verify request to share. Nothing is broadcast.
 * v1:   the staker pre-signs the refund first (wallet prompt).
 * v1.1: no wallet signature (`manager` may be null): the verifier signs the refund alone.
 */
export async function prepareVerifyRequest(manager: DappConnectionManager | null, p: StoredPledge): Promise<VerifyRequest> {
  const { provider, contract } = pledgeContract(p);
  const utxo = await lockedUtxo(contract);
  let stakerSig: Uint8Array | undefined;
  if (!p.verifierRefund) {
    if (!manager) throw new Error('Connect your wallet to pre-sign your refund');
    const builder = buildKeep({
      contract,
      provider,
      utxo,
      stakerSig: placeholderSignature(),
      verifierSig: DUMMY_SIGNATURE,
      stakerAddress: stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network),
    });
    const { txHex } = await walletSign(manager, provider, builder, [stakerPath], {
      broadcast: false,
      userPrompt: 'Vouch: pre-sign your refund. Nothing is sent until your verifier approves.',
    });
    stakerSig = keepSignaturesFromTx(txHex).stakerSig;
    if (!stakerSig) throw new Error('The wallet didn’t sign the refund. Try again.');
  }
  return {
    v: 1,
    pledge: {
      id: p.id,
      promise: p.promise,
      stakeSats: p.stakeSats,
      deadline: p.deadline,
      beneficiaryAddress: p.beneficiaryAddress,
      stakerPubkey: p.stakerPubkey,
      verifierPubkey: p.verifierPubkey,
      contractAddress: p.contractAddress,
      network: p.network,
      ...(p.verifierRefund ? { verifierRefund: true as const } : {}),
      ...(p.beneficiaryName ? { beneficiaryName: p.beneficiaryName } : {}),
      ...(p.deadlineAt ? { deadlineAt: p.deadlineAt } : {}),
    },
    utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() },
    fee: DEFAULT_FEE.toString(),
    stakerSig: stakerSig ? binToHex(stakerSig) : '',
  };
}

/** Find which receive index of the connected wallet holds `pubkeyHex` (verifier side). */
export function findWalletIndex(manager: DappConnectionManager, pubkeyHex: string, max = 50): number | null {
  const child = childIndexOfPathName(STAKER_PATH.name) ?? 0;
  for (let i = 0; i < max; i++) {
    const pk = manager.getPubkey(child, BigInt(i));
    if (pk && binToHex(pk) === pubkeyHex.toLowerCase()) return i;
  }
  return null;
}

/** Verifier (friend) approves: signs the refund in their wallet; it's pushed right away (v1.1: their signature is all it needs). */
export async function approveKeepAsVerifier(manager: DappConnectionManager, r: VerifyRequest, walletIndex: number) {
  const { provider, contract } = pledgeContract(r.pledge);
  const builder = buildKeep({
    contract,
    provider,
    utxo: { ...r.utxo, satoshis: BigInt(r.utxo.satoshis), lockingBytecode: contract.lockingBytecode },
    stakerSig: r.pledge.verifierRefund ? undefined : hexToBin(r.stakerSig),
    verifierSig: placeholderSignature(),
    stakerAddress: stakerP2pkhAddress(hexToBin(r.pledge.stakerPubkey), r.pledge.network),
  });
  return walletSign(manager, provider, builder, [[0, STAKER_PATH.name, walletIndex]], {
    broadcast: true,
    userPrompt: `Vouch: approve “${r.pledge.promise}”. Signing sends the stake back to your friend.`,
  });
}

/** Verifier (friend) rules it broken: stake goes to the beneficiary. */
export async function breakAsVerifier(manager: DappConnectionManager, r: VerifyRequest, walletIndex: number) {
  const { provider, contract } = pledgeContract(r.pledge);
  const utxo = await lockedUtxo(contract);
  const builder = buildBreakByVerifier({ contract, provider, utxo, verifierSig: placeholderSignature(), beneficiaryAddress: r.pledge.beneficiaryAddress });
  return walletSign(manager, provider, builder, [[0, STAKER_PATH.name, walletIndex]], {
    broadcast: true,
    userPrompt: `Vouch: rule “${r.pledge.promise}” broken. The stake goes to the beneficiary.`,
  });
}

/** Staker admits it: stake goes to the beneficiary. */
export async function breakFromWallet(manager: DappConnectionManager, p: StoredPledge) {
  if (isQuorumPledge(p)) return quorumBreakByStaker(manager, p);
  const { provider, contract } = pledgeContract(p);
  const utxo = await lockedUtxo(contract);
  const builder = buildBreakByStaker({ contract, provider, utxo, stakerSig: placeholderSignature(), beneficiaryAddress: p.beneficiaryAddress });
  return walletSign(manager, provider, builder, [stakerPath], { broadcast: true, userPrompt: 'Vouch: I broke it. Send the stake to the beneficiary.' });
}

/** Settle an expired pledge: from the browser first, then via our server as a backup. */
export async function settleExpiredPledge(p: StoredPledge): Promise<string> {
  try {
    if (isQuorumPledge(p)) return await quorumForfeit(p);
    const { provider, contract } = pledgeContract(p);
    const utxo = await lockedUtxo(contract);
    const tx = await buildForfeit({ contract, provider, utxo, beneficiaryAddress: p.beneficiaryAddress, deadline: p.deadline }).send();
    return tx.txid;
  } catch (browserErr) {
    const res = await fetch('/api/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pledge: pledgeTerms(p) }) });
    const json = (await res.json()) as { txid?: string; error?: string };
    if (!res.ok || !json.txid) throw new Error(json.error ?? (browserErr as Error).message);
    return json.txid;
  }
}
