// Public wall: shared types and pure helpers (client + server).
// A listing holds only what's needed to rebuild the contract and draw the card. Every state and
// figure is derived from the chain on the server (src/server/wallState.ts), never from the client.
import type { BchNetwork } from './providers';

export type Visibility = 'public' | 'unlisted';
export type WallState = 'active' | 'kept' | 'paid';
/** How a paid pledge ended. */
export type PaidHow = 'broken' | 'forfeited';

export const HABIT_MAX = 140;
/** Each staker key can hold this many active listings at once. */
export const MAX_ACTIVE_PER_STAKER = 5;

export const VISIBILITY_COPY = {
  public: { label: 'Listed on the wall', help: 'Shows on the wall: the goal, the stake, the deadline, and how it ends. Your address is shortened.' },
  unlisted: { label: 'Unlisted', help: 'Hidden from the wall. The coins, amount and payout are still visible on-chain to anyone with the address.' },
} as const;

/** Chipnet pledges default to the wall (so it can fill); mainnet ones start unlisted. */
export const defaultVisibility = (network: BchNetwork): Visibility => (network === 'mainnet' ? 'unlisted' : 'public');

/**
 * Habit text as stored and shown: control and bidi-override characters removed, whitespace
 * collapsed, 1..140 characters. Returns null if nothing is left or it's too long. (React escapes
 * it on render; this only keeps the stored text tidy.)
 */
export function cleanHabit(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || [...s].length > HABIT_MAX) return null;
  return s;
}

export interface WallCard {
  pledgeId: string;
  network: BchNetwork;
  version: 1 | 2;
  habit: string;
  /** e.g. "bchtest:qz0d…h80q" — never the full address. */
  stakerShort: string;
  stakeSats: string;
  state: WallState;
  paidHow?: PaidHow;
  /** v2: M and N. v1: the single verifier. */
  threshold?: number;
  verifierCount: number;
  /** Signatures that ended it (from the spending tx); null while active (signatures live in links, not on chain). */
  sealsCollected: number | null;
  /** v1: who verifies. */
  verifierType?: 'demo' | 'friend';
  deadline: number; // block height
  /** ms, estimated from the tip height while active. */
  deadlineAt?: number;
  /** ms, block time of the tx that ended it. */
  endedAt?: number;
  contractAddress: string;
  endTxid?: string;
  /** README chipnet test runs seeded onto the wall. */
  legacy: boolean;
}

export interface WallStats {
  vouchesMade: number;
  bchLockedSats: string;
  keptCount: number;
  paidCount: number;
}

export interface WallResponse {
  network: BchNetwork;
  cards: WallCard[];
  stats: WallStats;
  /** ms */
  generatedAt: number;
  /** False when the registry isn't configured and only the bundled legacy list is shown. */
  registry: 'turso' | 'legacy-only';
}

export function statsOf(cards: WallCard[]): WallStats {
  let locked = 0n;
  for (const c of cards) if (c.state === 'active') locked += BigInt(c.stakeSats);
  return {
    vouchesMade: cards.length,
    bchLockedSats: locked.toString(),
    keptCount: cards.filter((c) => c.state === 'kept').length,
    paidCount: cards.filter((c) => c.state === 'paid').length,
  };
}

export function shortAddress(address: string): string {
  const [prefix, body = ''] = address.includes(':') ? address.split(':') : ['', address];
  if (body.length <= 10) return address;
  return `${prefix ? prefix + ':' : ''}${body.slice(0, 4)}…${body.slice(-4)}`;
}
