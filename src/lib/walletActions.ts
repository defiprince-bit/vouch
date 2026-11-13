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
import type { VerifyRequest } from './share';

export function pledgeContract(p: Pick<StoredPledge, 'stakerPubkey' | 'verifierPubkey' | 'beneficiaryAddress' | 'deadline' | 'id' | 'network'>, provider?: NetworkProvider) {
  const prov = provider ?? getProvider(p.network);
  const contract = createPledgeContract(
    {
      stakerPubkey: hexToBin(p.stakerPubkey),
      verifierPubkey: hexToBin(p.verifierPubkey),
      beneficiaryAddress: p.beneficiaryAddress,
      deadline: p.deadline,
      pledgeId: p.id,
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

/** Lock the stake from the wallet's receive/0 address. */
export async function lockFromWallet(manager: DappConnectionManager, p: StoredPledge) {
  const { provider, contract } = pledgeContract(p);
  const walletAddress = stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network);
  const walletUtxos = await provider.getUtxos(walletAddress);
  const builder = buildLock({ provider, walletUtxos, walletAddress, contractAddress: contract.address, stake: BigInt(p.stakeSats) });
  const paths = walletUtxos.filter((u) => !u.token).map((_, i): InputPath => [i, STAKER_PATH.name, STAKER_PATH.index]);
  return walletSign(manager, provider, builder, paths, { broadcast: true, userPrompt: `Vouch: lock ${p.stakeSats} sats on “${p.promise}”` });
}

/** Demo verifier flow (verifier first): get the verifier's signature, then the staker signs the refund and it's pushed. */
export async function keepWithDemoVerifier(manager: DappConnectionManager, p: StoredPledge, note: string) {
  const res = await fetch('/api/verifier', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'keep', pledge: pledgeTerms(p), confirm: true, note }),
  });
  const json = (await res.json()) as { verifierSig?: string; utxo?: { txid: string; vout: number; satoshis: string }; error?: string };
  if (!res.ok || !json.verifierSig || !json.utxo) throw new Error(json.error ?? 'Verifier refused');
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

/** Friend flow (staker first): pre-sign the refund, return a verify request to share. Nothing is broadcast. */
export async function prepareVerifyRequest(manager: DappConnectionManager, p: StoredPledge): Promise<VerifyRequest> {
  const { provider, contract } = pledgeContract(p);
  const utxo = await lockedUtxo(contract);
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
  const { stakerSig } = keepSignaturesFromTx(txHex);
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
      ...(p.beneficiaryName ? { beneficiaryName: p.beneficiaryName } : {}),
      ...(p.deadlineAt ? { deadlineAt: p.deadlineAt } : {}),
    },
    utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() },
    fee: DEFAULT_FEE.toString(),
    stakerSig: binToHex(stakerSig),
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

/** Verifier (friend) approves: signs the refund in their wallet; it's pushed right away. */
export async function approveKeepAsVerifier(manager: DappConnectionManager, r: VerifyRequest, walletIndex: number) {
  const { provider, contract } = pledgeContract(r.pledge);
  const builder = buildKeep({
    contract,
    provider,
    utxo: { ...r.utxo, satoshis: BigInt(r.utxo.satoshis), lockingBytecode: contract.lockingBytecode },
    stakerSig: hexToBin(r.stakerSig),
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
  const { provider, contract } = pledgeContract(p);
  const utxo = await lockedUtxo(contract);
  const builder = buildBreakByStaker({ contract, provider, utxo, stakerSig: placeholderSignature(), beneficiaryAddress: p.beneficiaryAddress });
  return walletSign(manager, provider, builder, [stakerPath], { broadcast: true, userPrompt: 'Vouch: I broke it. Send the stake to the beneficiary.' });
}

/** Settle an expired pledge: from the browser first, then via our server as a backup. */
export async function settleExpiredPledge(p: StoredPledge): Promise<string> {
  try {
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
