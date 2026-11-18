// Network selection + address/network checks. Pure helpers (no React), shared by client, server and tests.
import { decodeCashAddress, decodeCashAddressFormatWithoutPrefix } from '@bitauth/libauth';
import type { BchNetwork } from './providers';

export type { BchNetwork } from './providers';

export const NETWORKS: readonly BchNetwork[] = ['chipnet', 'mainnet'];
/** localStorage key holding the user's chosen network. */
export const NETWORK_STORAGE_KEY = 'vouch-network';
export const NETWORK_EVENT = 'vouch-network-changed';

export const isNetwork = (v: unknown): v is BchNetwork => v === 'chipnet' || v === 'mainnet';

/** Deployment default: chipnet unless NEXT_PUBLIC_BCH_NETWORK=mainnet. */
export function defaultNetwork(): BchNetwork {
  return process.env.NEXT_PUBLIC_BCH_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';
}

/** The stored choice if valid, else the deployment default. */
export function resolveNetwork(stored: string | null | undefined): BchNetwork {
  return isNetwork(stored) ? stored : defaultNetwork();
}

export const cashPrefix = (n: BchNetwork) => (n === 'mainnet' ? 'bitcoincash' : 'bchtest');
export const networkLabel = (n: BchNetwork) => (n === 'mainnet' ? 'Mainnet' : 'Chipnet');

const EXPLORER: Record<BchNetwork, string> = {
  mainnet: 'https://explorer.bitcoinunlimited.info',
  chipnet: 'https://chipnet.imaginary.cash',
};
export const explorerTx = (n: BchNetwork, txid: string) => `${EXPLORER[n]}/tx/${txid}`;
export const explorerAddr = (n: BchNetwork, address: string) => `${EXPLORER[n]}/address/${address}`;

const PREFIX_NETWORK: Record<string, BchNetwork> = { bitcoincash: 'mainnet', bchtest: 'chipnet' };

export type AddressCheck =
  | { ok: true; address: string; network: BchNetwork }
  | { ok: false; error: string; network?: BchNetwork };

/**
 * Check that `input` is a valid CashAddress for `network`. Accepts token-aware (z/r) addresses.
 * A prefix-less address is read as `network`'s prefix (and normalised to include it).
 */
export function checkAddress(input: string, network: BchNetwork): AddressCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter an address.' };
  const want = cashPrefix(network);
  const lower = raw.toLowerCase();
  let prefix: string;
  let address: string;
  if (lower.includes(':')) {
    const d = decodeCashAddress(lower);
    if (typeof d === 'string') return { ok: false, error: 'That isn’t a valid Bitcoin Cash address. Check it and paste it again.' };
    prefix = d.prefix;
    address = lower;
  } else {
    const d = decodeCashAddressFormatWithoutPrefix(lower, ['bitcoincash', 'bchtest', 'bchreg']);
    if (typeof d === 'string') return { ok: false, error: 'That isn’t a valid Bitcoin Cash address. Check it and paste it again.' };
    prefix = d.prefix;
    address = `${d.prefix}:${lower}`;
  }
  const found = PREFIX_NETWORK[prefix];
  if (!found) return { ok: false, error: `That is a ${prefix} address. Vouch is on ${network}: use a ${want}: address.` };
  if (found !== network) {
    return {
      ok: false,
      network: found,
      error: `That is a ${found} address (${prefix}:…), but Vouch is on ${network}. Use a ${want}: address, or switch the app to ${found}.`,
    };
  }
  return { ok: true, address, network: found };
}

/** Which network an address belongs to, or null if it isn't a valid prefixed CashAddress. */
export function addressNetwork(address: string): BchNetwork | null {
  const d = decodeCashAddress(address.trim().toLowerCase());
  return typeof d === 'string' ? null : (PREFIX_NETWORK[d.prefix] ?? null);
}

/** Active network in this browser: the stored choice, else the deployment default. Server: the default. */
export function activeNetwork(): BchNetwork {
  if (typeof window === 'undefined') return defaultNetwork();
  try {
    return resolveNetwork(window.localStorage.getItem(NETWORK_STORAGE_KEY));
  } catch {
    return defaultNetwork();
  }
}

/** Persist the choice and notify same-tab listeners (the storage event only fires in other tabs). */
export function storeNetwork(n: BchNetwork) {
  window.localStorage.setItem(NETWORK_STORAGE_KEY, n);
  window.dispatchEvent(new Event(NETWORK_EVENT));
}
