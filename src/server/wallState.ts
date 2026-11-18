// On-chain state of a listed pledge. Nothing here trusts the client: the contract is rebuilt from
// the stored terms, and the state comes from the address's UTXOs and history.
//   active = a UTXO is still at the contract
//   kept   = the stake was spent back to the staker's P2PKH (keep)
//   paid   = the stake was spent to the beneficiary (breakByStaker, breakByVerifier or forfeit)
import { decodeTransaction, hexToBin, decodeAuthenticationInstructions, binToHex, type AuthenticationInstructionPush } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { createPledgeContract, stakerP2pkhAddress, type BchNetwork } from '@/lib/vouch';
import { createQuorumContract, MAX_VERIFIERS } from '@/lib/quorum';
import type { AddressHistoryTx } from '@/lib/providers';
import type { PaidHow, WallState } from '@/lib/wall';
import type { PledgeTerms } from './verifier';

export interface ChainReader {
  utxos(network: BchNetwork, address: string): Promise<Array<{ txid: string; vout: number; satoshis: bigint }>>;
  history(network: BchNetwork, address: string): Promise<AddressHistoryTx[]>;
  rawTx(network: BchNetwork, txid: string): Promise<string>;
  height(network: BchNetwork): Promise<number>;
}

export interface DerivedState {
  state: WallState;
  stakeSats: string;
  paidHow?: PaidHow;
  /** Verifier signatures in the spend that ended it (null while active). */
  sealsCollected: number | null;
  endedAt?: number;
  endTxid?: string;
}

export function contractForTerms(t: PledgeTerms, provider: NetworkProvider) {
  if (t.version === 2) {
    return createQuorumContract(
      {
        stakerPubkey: hexToBin(t.stakerPubkey),
        verifierPubkeys: t.verifierPubkeys!.map((k) => hexToBin(k)),
        threshold: t.threshold!,
        beneficiaryAddress: t.beneficiaryAddress,
        deadline: t.deadline,
        pledgeId: t.id,
      },
      provider,
    );
  }
  return createPledgeContract(
    { stakerPubkey: hexToBin(t.stakerPubkey), verifierPubkey: hexToBin(t.verifierPubkey), beneficiaryAddress: t.beneficiaryAddress, deadline: t.deadline, pledgeId: t.id },
    provider,
  );
}

/** Pushes of an unlocking script; OP_0..OP_16 become their small-number bytes. */
function pushes(b: Uint8Array): Uint8Array[] {
  return decodeAuthenticationInstructions(b).map((i) => {
    const d = (i as AuthenticationInstructionPush).data;
    if (d) return d;
    return i.opcode >= 0x51 && i.opcode <= 0x60 ? Uint8Array.of(i.opcode - 0x50) : new Uint8Array();
  });
}

/** Both contracts order their functions the same way. */
const FN = { keep: 0, breakByStaker: 1, breakByVerifier: 2, forfeit: 3 } as const;

/** Which function a spend used and how many verifier signatures it carried. */
export function readSpend(txHex: string, redeemScriptHex: string, version: 1 | 2): { fn: number; seals: number } | null {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') return null;
  for (const input of tx.inputs) {
    const p = pushes(input.unlockingBytecode);
    if (p.length < 2 || binToHex(p[p.length - 1]) !== redeemScriptHex) continue;
    const sel = p[p.length - 2];
    const fn = sel.length === 0 ? 0 : sel[0];
    let seals = 0;
    if (fn === FN.keep || fn === FN.breakByVerifier) {
      seals = version === 2 ? p.slice(0, MAX_VERIFIERS).filter((x) => x.length === 65).length : 1;
    }
    return { fn, seals };
  }
  return null;
}

const lc = (a: string) => a.trim().toLowerCase();

/** Derive the state from the chain. Returns null if nothing was ever locked at the address. */
export async function deriveState(terms: PledgeTerms, chain: ChainReader, provider: NetworkProvider, now = Date.now()): Promise<DerivedState | null> {
  const contract = contractForTerms(terms, provider);
  const address = lc(contract.address);
  const [utxos, history] = await Promise.all([chain.utxos(terms.network, contract.address), chain.history(terms.network, contract.address)]);
  if (utxos.length > 0) {
    const sum = utxos.reduce((a, u) => a + u.satoshis, 0n);
    return { state: 'active', stakeSats: sum.toString(), sealsCollected: null };
  }
  const spend = history.find((tx) => tx.inputs.some((i) => lc(i.address) === address));
  if (!spend) return null;
  const outs = spend.outputs.map((o) => lc(o.address));
  const staker = lc(stakerP2pkhAddress(hexToBin(terms.stakerPubkey), terms.network));
  const bene = lc(terms.beneficiaryAddress);
  const state: WallState | null = outs.includes(staker) ? 'kept' : outs.includes(bene) ? 'paid' : null;
  if (!state) return null; // the covenant allows no other destination
  const stake = spend.inputs.filter((i) => lc(i.address) === address).reduce((a, i) => a + BigInt(i.value), 0n);
  let seals: number | null = null;
  let paidHow: PaidHow | undefined;
  try {
    const read = readSpend(await chain.rawTx(terms.network, spend.hash), contract.bytecode, terms.version === 2 ? 2 : 1);
    if (read) {
      seals = read.seals;
      if (state === 'paid') paidHow = read.fn === FN.forfeit ? 'forfeited' : 'broken';
    }
  } catch {
    // raw tx unavailable: state is still known, the detail isn't
  }
  return {
    state,
    stakeSats: stake.toString(),
    sealsCollected: seals,
    ...(paidHow ? { paidHow } : {}),
    endedAt: spend.blockHeight && spend.timestamp ? spend.timestamp * 1000 : now,
    endTxid: spend.hash,
  };
}
