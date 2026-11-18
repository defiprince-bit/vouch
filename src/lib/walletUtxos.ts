// Gather spendable coins across an HD wallet's addresses (receive + change), not just receive/0.
// HD wallets like Paytaca move funds to fresh receive indexes and change addresses, so reading
// only the staker's receive/0 address can show 0 sats even when the wallet is funded.
import type { NetworkProvider, SpendableUtxo } from 'cashscript';
import { childIndexOfPathName } from '@wizardconnect/core';
import { encodeCashAddress, CashAddressType, hash160 } from '@bitauth/libauth';
import type { BchNetwork } from './providers';
import type { InputPath } from './wc';

const p2pkhAddress = (pubkey: Uint8Array, network: BchNetwork) =>
  encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pubkey) }).address;

/** A wallet UTXO tagged with the address it sits on and the HD path that owns its key. */
export interface WalletUtxo extends SpendableUtxo {
  address: string;
  path: string;
  index: number;
}

/** The slice of WizardConnect's DappConnectionManager we need (easy to fake in tests). */
export interface PubkeySource {
  getPubkey(childIndex: number, index: bigint): Uint8Array | undefined;
  hasPath?(childIndex: number): boolean;
}

export const WALLET_SCAN_PATHS = ['receive', 'change'] as const;
export const SCAN_MAX = 20;
export const SCAN_GAP = 5;

/**
 * Scan indexes 0..max-1 of each path, in parallel batches of `gap`; stop a path once `gap`
 * consecutive addresses in a row are empty (no coins at all). Returns non-token UTXOs, largest first.
 */
export async function gatherWalletUtxos(
  manager: PubkeySource,
  provider: Pick<NetworkProvider, 'getUtxos'>,
  network: BchNetwork,
  opts: { paths?: readonly string[]; max?: number; gap?: number } = {},
): Promise<WalletUtxo[]> {
  const paths = opts.paths ?? WALLET_SCAN_PATHS;
  const max = opts.max ?? SCAN_MAX;
  const gap = opts.gap ?? SCAN_GAP;

  const scanPath = async (path: string): Promise<WalletUtxo[]> => {
    const child = childIndexOfPathName(path);
    if (child === undefined) return [];
    if (manager.hasPath && !manager.hasPath(child)) return [];
    const found: WalletUtxo[] = [];
    let emptyRun = 0;
    for (let start = 0; start < max && emptyRun < gap; start += gap) {
      const idxs = Array.from({ length: Math.min(gap, max - start) }, (_, k) => start + k);
      const batch = await Promise.all(
        idxs.map(async (index) => {
          const pk = manager.getPubkey(child, BigInt(index));
          if (!pk) return null; // wallet didn't expose this key
          const address = p2pkhAddress(pk, network);
          const utxos = await provider.getUtxos(address);
          return { index, address, utxos };
        }),
      );
      for (const r of batch) {
        if (!r) { emptyRun++; continue; }
        if (r.utxos.length === 0) emptyRun++;
        else emptyRun = 0;
        for (const u of r.utxos) if (!u.token) found.push({ ...u, address: r.address, path, index: r.index });
      }
      if (batch.every((r) => r === null)) break; // no more keys on this path
    }
    return found;
  };

  const all = (await Promise.all(paths.map(scanPath))).flat();
  return all.sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
}

export const totalSats = (utxos: { satoshis: bigint }[]) => utxos.reduce((s, u) => s + u.satoshis, 0n);

/** Rough P2PKH fee budget for a lock with n inputs (two outputs) at ~1.1 sat/byte, with headroom. */
export const lockFeeBudget = (nInputs: number) => 300n + 160n * BigInt(nInputs);

/** Largest-first coin selection that covers stake + fees. Returns null if the wallet can't. */
export function selectLockUtxos<T extends { satoshis: bigint; token?: unknown }>(utxos: T[], stake: bigint): T[] | null {
  const sorted = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const picked: T[] = [];
  let sum = 0n;
  for (const u of sorted) {
    picked.push(u);
    sum += u.satoshis;
    if (sum >= stake + lockFeeBudget(picked.length)) return picked;
  }
  return null;
}

/** inputPaths for a lock tx whose inputs are `utxos`, in order: each input signed by its own key. */
export const lockInputPaths = (utxos: Pick<WalletUtxo, 'path' | 'index'>[]): InputPath[] =>
  utxos.map((u, i): InputPath => [i, u.path, u.index]);

