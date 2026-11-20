// Public wall service: listing (POST /api/wall) and reading (GET /api/wall). Server-only.
//
// Listing proof: the pledge's listSecret (see src/lib/listSecret.ts). The staker's browser makes
// it at create time with a nonce and keeps both only in its own pledge storage. The pledge id
// (a contract constructor arg) is sha256(domain || nonce || habit || sha256(listSecret))[0..16),
// so the contract itself commits to the secret's hash before any link is shared. A verify link
// carries the pledge id but never the secret, so holding a link isn't enough to list, and nobody
// can pre-register under a secret of their own. The server
//   1. rate-limits per hashed IP and per staker key, counted in the registry (not in memory);
//   2. validates the terms (same rules as /api/verifier) and rebuilds the contract;
//   3. refuses if the rebuilt address isn't the one claimed, or isn't on the claimed network;
//   4. refuses (403) unless sha256(listSecret), the nonce and the habit rebuild the pledge id;
//   5. refuses unless the contract has a lock on chain (an unspent UTXO, or history);
//   6. caps each staker at MAX_ACTIVE_PER_STAKER active listings; pledgeId is UNIQUE.
// It stores sha256(listSecret), never the secret. Pledges whose id isn't such a commitment
// (made before this) can't be newly listed; the legacy seeds were inserted directly.
import { createHash } from 'node:crypto';
import { hexToBin } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { getProvider, stakerP2pkhAddress, type BchNetwork } from '@/lib/vouch';
import { listSecretHash, secretMatchesPledge } from '@/lib/listSecret';
import { restUpstream } from '@/lib/providers';
import { addressNetwork } from '@/lib/network';
import {
  cleanHabit,
  shortAddress,
  statsOf,
  MAX_ACTIVE_PER_STAKER,
  HABIT_MAX,
  type WallCard,
  type WallResponse,
} from '@/lib/wall';
import { parseTerms, VerifierError, loadVerifierKey, verifierPubkeyHex, type PledgeTerms } from './verifier';
import { DuplicateListingError, MemoryWallStore, TursoWallStore, type WallStore } from './wallStore';
import { contractForTerms, deriveState, type ChainReader, type DerivedState } from './wallState';
import { LEGACY_LISTINGS } from './wallLegacy';

export const LIST_LIMITS = { perIpPerHour: 10, perStakerPerHour: 8 };
/** Re-read an active pledge's state at most this often (ended states are final). */
export const STATE_TTL_MS = 60_000;

export const restChain: ChainReader = {
  utxos: (n, a) => restUpstream.utxos(n, a),
  history: (n, a) => restUpstream.history(n, a),
  rawTx: (n, t) => restUpstream.rawTx(n, t),
  height: (n) => restUpstream.height(n),
};

let storeSingleton: WallStore | null = null;
/** Turso when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set; otherwise a read-only list of the legacy chipnet runs. */
export function wallStore(): WallStore {
  if (storeSingleton) return storeSingleton;
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (url && token) storeSingleton = new TursoWallStore(url, token);
  else {
    const m = new MemoryWallStore(LEGACY_LISTINGS);
    m.kind = 'legacy-only';
    storeSingleton = m;
  }
  return storeSingleton;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`vouch-wall:${process.env.WALL_IP_SALT ?? 'v1'}:${ip}`).digest('hex').slice(0, 32);
}

export interface ListDeps {
  store: WallStore;
  chain: ChainReader;
  provider?: (network: BchNetwork) => NetworkProvider;
  now?: number;
}

export interface ListInput {
  /**
   * The pledge terms: id, deadline, beneficiaryAddress, stakerPubkey, network, contractAddress,
   * and verifierPubkey (v1) or version 2 + verifierPubkeys + threshold (quorum).
   */
  pledge: unknown;
  /** 32-byte hex secret and 16-byte hex nonce from the creating browser's pledge storage. */
  listSecret: unknown;
  listNonce: unknown;
  /** The habit exactly as committed in the pledge id. */
  habit: unknown;
  ip: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Validate and insert a listing. Throws VerifierError (400/403/409/429/503) with a human message. */
export async function listPledge(input: ListInput, deps: ListDeps): Promise<{ pledgeId: string; contractAddress: string; network: BchNetwork }> {
  const now = deps.now ?? Date.now();
  const { store, chain } = deps;
  if (store.kind === 'legacy-only') throw new VerifierError('Listing on the wall isn’t switched on for this deployment yet.', 503);
  const ipHash = hashIp(input.ip);
  const hourAgo = now - 3_600_000;
  if ((await store.countAttempts(hourAgo, { ipHash })) >= LIST_LIMITS.perIpPerHour) {
    throw new VerifierError('Too many listings from here in the last hour. Try again later.', 429);
  }

  // Every attempt counts toward the limits, valid or not.
  const raw = (input.pledge && typeof input.pledge === 'object' ? input.pledge : null) as Record<string, unknown> | null;
  const stakerPubkey = str(raw?.stakerPubkey).toLowerCase();
  const stakerKnown = /^0[23][0-9a-f]{64}$/.test(stakerPubkey);
  await store.recordAttempt(ipHash, stakerKnown ? stakerPubkey : null, now);
  if (stakerKnown && (await store.countAttempts(hourAgo, { stakerPubkey })) > LIST_LIMITS.perStakerPerHour) {
    throw new VerifierError('Too many listing attempts for this wallet in the last hour. Try again later.', 429);
  }
  if (!raw) throw new VerifierError('Missing pledge');

  const habit = cleanHabit(input.habit);
  if (!habit) throw new VerifierError(`Write the habit in 1 to ${HABIT_MAX} characters.`);

  // Same term rules as the verifier API (network, beneficiary on that network, deadline, quorum shape).
  const quorum = raw.version === 2;
  const terms: PledgeTerms = parseTerms({
    id: str(raw.id).toLowerCase(),
    deadline: raw.deadline,
    beneficiaryAddress: raw.beneficiaryAddress,
    stakerPubkey,
    network: raw.network,
    ...(raw.verifierRefund === true ? { verifierRefund: true } : {}),
    ...(quorum
      ? { version: 2, verifierPubkeys: Array.isArray(raw.verifierPubkeys) ? raw.verifierPubkeys.map((v) => str(v).toLowerCase()) : [], threshold: raw.threshold }
      : { verifierPubkey: str(raw.verifierPubkey).toLowerCase() }),
  });
  const network = terms.network;
  const claimed = str(raw.contractAddress).trim().toLowerCase();
  if (addressNetwork(claimed) !== network) throw new VerifierError(`The contract address isn’t a ${network} address.`);
  const provider = (deps.provider ?? getProvider)(network);
  const contract = contractForTerms(terms, provider);
  if (contract.address.toLowerCase() !== claimed) throw new VerifierError('These terms don’t match the contract address.');

  // The proof: sha256(listSecret), the nonce and the habit must rebuild the pledge id the contract commits to.
  if (!secretMatchesPledge(input.listSecret, input.listNonce, input.habit, terms.id)) {
    throw new VerifierError('This pledge can only be listed from the browser that created it.', 403);
  }

  // The lock must be on chain.
  const utxos = await chain.utxos(network, contract.address);
  if (!utxos.length && !(await chain.history(network, contract.address)).length) {
    throw new VerifierError('No locked stake found at this contract on chain. List it once the lock has gone through.');
  }

  if ((await store.countActiveForStaker(stakerPubkey)) >= MAX_ACTIVE_PER_STAKER) {
    throw new VerifierError(`This wallet already has ${MAX_ACTIVE_PER_STAKER} active pledges on the wall. List more once some have ended.`, 409);
  }
  // Unspent now: active. Already spent: left for readWall to derive (kept or paid).
  const state: DerivedState | null = utxos.length ? { state: 'active', stakeSats: utxos.reduce((a, u) => a + u.satoshis, 0n).toString(), sealsCollected: null } : null;
  try {
    await store.insert({
      pledgeId: terms.id.toLowerCase(),
      contractAddress: contract.address,
      network,
      version: terms.version === 2 ? 2 : 1,
      habit,
      stakerPubkey,
      termsJson: JSON.stringify(storedTerms(terms)),
      createdAt: now,
      legacy: false,
      hidden: false,
      state: state ? 'active' : null,
      stateJson: state ? JSON.stringify(state) : null,
      checkedAt: state ? now : null,
      listSecretHash: listSecretHash(input.listSecret as string),
    });
  } catch (e) {
    if (e instanceof DuplicateListingError) throw new VerifierError('This pledge is already on the wall.', 409);
    throw e;
  }
  cache.delete(network);
  return { pledgeId: terms.id, contractAddress: contract.address, network };
}

/** Only what's needed to rebuild the contract. */
function storedTerms(t: PledgeTerms): PledgeTerms {
  return {
    id: t.id,
    deadline: t.deadline,
    beneficiaryAddress: t.beneficiaryAddress,
    stakerPubkey: t.stakerPubkey,
    verifierPubkey: t.verifierPubkey,
    network: t.network,
    ...(t.verifierRefund ? { verifierRefund: true as const } : {}),
    ...(t.version === 2 ? { version: 2 as const, verifierPubkeys: t.verifierPubkeys, threshold: t.threshold } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading

const cache = new Map<BchNetwork, { at: number; value: WallResponse }>();
const CACHE_MS = 30_000;

export interface ReadDeps {
  store: WallStore;
  chain: ChainReader;
  provider?: (network: BchNetwork) => NetworkProvider;
  now?: number;
  demoPubkey?: string | null;
  /** Skip the in-process cache (tests). */
  fresh?: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await f(items[k]);
      }
    }),
  );
  return out;
}

/** Cards + stats for a network. States are re-read from the chain when stale (active only). */
export async function readWall(network: BchNetwork, deps: ReadDeps): Promise<WallResponse> {
  const now = deps.now ?? Date.now();
  const hit = cache.get(network);
  if (!deps.fresh && hit && now - hit.at < CACHE_MS) return hit.value;
  const provider = (deps.provider ?? getProvider)(network);
  const rows = await deps.store.list(network);
  const demo = deps.demoPubkey === undefined ? defaultDemoPubkey() : deps.demoPubkey;

  const derived = await mapLimit(rows, 4, async (row): Promise<DerivedState | null> => {
    const known = row.stateJson ? (JSON.parse(row.stateJson) as DerivedState) : null;
    const final = known && known.state !== 'active';
    const fresh = row.checkedAt !== null && now - row.checkedAt < STATE_TTL_MS;
    if (known && (final || fresh)) return known;
    try {
      const d = await deriveState(JSON.parse(row.termsJson) as PledgeTerms, deps.chain, provider, now);
      if (d) await deps.store.saveState(row.pledgeId, d.state, JSON.stringify(d), now).catch(() => {});
      return d ?? known;
    } catch {
      return known; // upstream down: last known state
    }
  });

  let tip: number | null = null;
  if (derived.some((d) => d?.state === 'active')) tip = await deps.chain.height(network).catch(() => null);

  const cards: WallCard[] = [];
  rows.forEach((row, i) => {
    const d = derived[i];
    if (!d) return; // never seen on chain: not shown, not counted
    const t = JSON.parse(row.termsJson) as PledgeTerms;
    const v2 = row.version === 2;
    cards.push({
      pledgeId: row.pledgeId,
      network,
      version: row.version,
      habit: row.habit,
      stakerShort: shortAddress(stakerP2pkhAddress(hexToBin(t.stakerPubkey), network)),
      stakeSats: d.stakeSats,
      state: d.state,
      ...(d.paidHow ? { paidHow: d.paidHow } : {}),
      ...(v2 ? { threshold: t.threshold } : {}),
      verifierCount: v2 ? t.verifierPubkeys!.length : 1,
      sealsCollected: d.sealsCollected,
      ...(!v2 ? { verifierType: demo && t.verifierPubkey.toLowerCase() === demo ? ('demo' as const) : ('friend' as const) } : {}),
      deadline: t.deadline,
      ...(d.state === 'active' && tip ? { deadlineAt: now + (t.deadline - tip) * 600_000 } : {}),
      ...(d.endedAt ? { endedAt: d.endedAt } : {}),
      ...(d.endTxid ? { endTxid: d.endTxid } : {}),
      contractAddress: row.contractAddress,
      legacy: row.legacy,
    });
  });
  const value: WallResponse = { network, cards, stats: statsOf(cards), generatedAt: now, registry: deps.store.kind === 'turso' ? 'turso' : 'legacy-only' };
  cache.set(network, { at: now, value });
  return value;
}

function defaultDemoPubkey(): string | null {
  try {
    const k = loadVerifierKey();
    return k ? verifierPubkeyHex(k).toLowerCase() : null;
  } catch {
    return null;
  }
}

export const _test = { clearCache: () => cache.clear() };
