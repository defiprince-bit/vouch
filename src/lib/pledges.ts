// Local pledge registry (browser localStorage). v1 has no backend: the chain is the source of truth for funds.
export interface StoredPledge {
  id: string; // pledgeId hex (16 bytes)
  promise: string;
  stakeSats: string;
  deadline: number; // block height
  beneficiaryAddress: string;
  stakerPubkey: string; // hex
  verifierPubkey: string; // hex
  verifierKind?: 'demo' | 'friend';
  verifierName?: string; // display only
  beneficiaryName?: string; // display only
  deadlineAt?: number; // ms, the wall-clock time the user picked (deadline height is derived from it)
  contractAddress: string;
  network: 'chipnet' | 'mainnet';
  createdAt: number;
  lastTxid?: string;
  lockTxid?: string;
  outcome?: 'kept' | 'broken' | 'settled'; // set when this browser sent the closing tx
  /**
   * Contract version. Missing or 1 = contracts/Vouch.cash (one verifier, `verifierPubkey`).
   * 2 = contracts/VouchQuorum.cash: `verifiers` (1..5, slot order) and `threshold` (M). For v2,
   * `verifierPubkey` mirrors verifiers[0] so older display code keeps working.
   */
  version?: 1 | 2;
  /**
   * true = the verifier-only-refund contract of this version: v1.1 (contracts/Vouch11.cash) or
   * v2.1 (contracts/VouchQuorum21.cash). The verifier(s) alone sign the refund, which can only pay
   * the staker's P2PKH. Missing = the original contract, where the refund also needs the staker's
   * signature (every pledge made before v1.1 / v2.1; the flag is part of what rebuilds its address).
   */
  verifierRefund?: true;
  verifiers?: QuorumVerifier[];
  threshold?: number;
  /** v2: signatures collected so far (link relay), all bound to `utxo`. */
  quorum?: QuorumProgress;
  /** Wall visibility picked on create. Missing = unlisted (pledges made before the wall). */
  visibility?: 'public' | 'unlisted';
  /**
   * Wall listing proof (src/lib/listSecret.ts): 32-byte hex secret and 16-byte hex nonce made at
   * create time; the pledge id commits to nonce, habit (`promise`) and sha256(listSecret). Lives
   * ONLY in this browser's storage: never in a verify link, share URL, or anything sent anywhere
   * except POST /api/wall and, for v1.1 / v2.1 demo-verifier refunds, POST /api/verifier (checked as
   * the staker's proof, never stored). Missing on pledges made before this existed (they can't be listed).
   */
  listSecret?: string;
  listNonce?: string;
  /** ms, when /api/wall accepted the listing. */
  listedAt?: number;
}

export interface QuorumVerifier {
  pubkey: string; // hex, 33 bytes
  name?: string; // display only
  kind?: 'demo' | 'friend';
}

export interface QuorumProgress {
  utxo: { txid: string; vout: number; satoshis: string };
  stakerSig?: string;
  /** Per slot: hex keep signature or null. */
  keepSigs: Array<string | null>;
  /** Per slot: hex breakByVerifier signature or null. */
  breakSigs: Array<string | null>;
}

export const isQuorumPledge = (p: Pick<StoredPledge, 'version'>) => p.version === 2;

export const PLEDGES_KEY = 'vouch-pledges';
/** Key used before the rename to Vouch; read as a fallback so existing pledges aren't lost. */
export const LEGACY_PLEDGES_KEY = 'commitcash-pledges';
export const PLEDGES_EVENT = 'vouch-pledges-changed';
const KEY = PLEDGES_KEY;

/** Raw JSON of this browser's pledges (new key first, then the pre-rename key). */
export function readPledgesRaw(storage: Pick<Storage, 'getItem'>): string {
  return storage.getItem(KEY) ?? storage.getItem(LEGACY_PLEDGES_KEY) ?? '[]';
}

export function loadPledges(): StoredPledge[] {
  if (typeof window === 'undefined') return [];
  return parsePledges(readPledgesRaw(window.localStorage));
}

export function savePledge(p: StoredPledge) {
  const all = rawEntries().filter((x) => !(isObj(x) && typeof x.id === 'string' && x.id.toLowerCase() === p.id.toLowerCase()));
  window.localStorage.setItem(KEY, JSON.stringify([p, ...all]));
  window.dispatchEvent(new Event(PLEDGES_EVENT)); // same-tab subscribers (the storage event only fires in other tabs)
}

const HEX_ID = /^[0-9a-f]{32}$/;
const HEX_PUBKEY = /^0[23][0-9a-f]{64}$/;
const HEX_TXID = /^[0-9a-f]{64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const lowerHex = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v.toLowerCase()) ? v.toLowerCase() : undefined);
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const oneOf = <T extends string>(v: unknown, xs: readonly T[]) => (xs.includes(v as T) ? (v as T) : undefined);

/** Network an address's prefix says it is on (the contract is built from the address, so it wins). */
function prefixNetwork(address: string): StoredPledge['network'] | undefined {
  const prefix = address.toLowerCase().split(':')[0];
  return prefix === 'bitcoincash' ? 'mainnet' : prefix === 'bchtest' ? 'chipnet' : undefined;
}

/** Whole-sat integer string (accepts a number or a digit string), else undefined. */
function satsString(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim()) && BigInt(v.trim()) > 0n) return BigInt(v.trim()).toString();
  return undefined;
}

/** Block height (accepts a number or a digit string), else undefined. */
function height(v: unknown): number | undefined {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n < 500_000_000 ? n : undefined;
}

function normalizeQuorum(v: unknown, slots: number): QuorumProgress | undefined {
  if (!isObj(v) || !isObj(v.utxo)) return undefined;
  const txid = lowerHex(v.utxo.txid, HEX_TXID);
  const vout = v.utxo.vout;
  const satoshis = satsString(v.utxo.satoshis);
  if (!txid || typeof vout !== 'number' || !Number.isInteger(vout) || vout < 0 || !satoshis) return undefined;
  const sigs = (a: unknown) => Array.from({ length: slots }, (_, i) => (Array.isArray(a) && typeof a[i] === 'string' && /^[0-9a-f]+$/i.test(a[i]) ? (a[i] as string) : null));
  const stakerSig = str(v.stakerSig);
  return { utxo: { txid, vout, satoshis }, ...(stakerSig && /^[0-9a-f]+$/i.test(stakerSig) ? { stakerSig } : {}), keepSigs: sigs(v.keepSigs), breakSigs: sigs(v.breakSigs) };
}

/**
 * One stored record -> a well-formed StoredPledge, repairing what can be repaired (numeric strings,
 * a `network` that disagrees with the beneficiary address, junk optional fields) and returning null
 * for anything the pages can't safely render or rebuild a contract from. The list and status pages
 * only ever see normalized records, so one bad entry can't crash them.
 */
export function normalizePledge(v: unknown): StoredPledge | null {
  if (!isObj(v)) return null;
  const id = lowerHex(v.id, HEX_ID);
  const stakeSats = satsString(v.stakeSats);
  const deadline = height(v.deadline);
  const beneficiaryAddress = str(v.beneficiaryAddress)?.trim();
  const stakerPubkey = lowerHex(v.stakerPubkey, HEX_PUBKEY);
  const addrNet = beneficiaryAddress ? prefixNetwork(beneficiaryAddress) : undefined;
  if (!id || !stakeSats || !deadline || !beneficiaryAddress || !addrNet || !stakerPubkey) return null;
  const network = addrNet;

  let version: 1 | 2 | undefined;
  let verifiers: QuorumVerifier[] | undefined;
  let threshold: number | undefined;
  let quorum: QuorumProgress | undefined;
  let verifierPubkey = lowerHex(v.verifierPubkey, HEX_PUBKEY);
  if (v.version === 2) {
    if (!Array.isArray(v.verifiers) || v.verifiers.length < 1 || v.verifiers.length > 5) return null;
    verifiers = [];
    for (const q of v.verifiers) {
      const pubkey = isObj(q) ? lowerHex(q.pubkey, HEX_PUBKEY) : undefined;
      if (!pubkey || !isObj(q)) return null;
      const name = str(q.name);
      const kind = oneOf(q.kind, ['demo', 'friend'] as const);
      verifiers.push({ pubkey, ...(name ? { name } : {}), ...(kind ? { kind } : {}) });
    }
    threshold = typeof v.threshold === 'number' && Number.isInteger(v.threshold) && v.threshold >= 1 && v.threshold <= verifiers.length ? v.threshold : undefined;
    if (!threshold) return null;
    version = 2;
    verifierPubkey = verifiers[0].pubkey;
    quorum = normalizeQuorum(v.quorum, verifiers.length);
  } else if (v.version !== undefined && v.version !== 1) {
    return null; // a future format this build doesn't understand
  }
  if (!verifierPubkey) return null;

  const promise = str(v.promise)?.trim() || 'Untitled pledge';
  const createdAt = finite(v.createdAt) ?? 0;
  const out: StoredPledge = {
    id,
    promise,
    stakeSats,
    deadline,
    beneficiaryAddress,
    stakerPubkey,
    verifierPubkey,
    contractAddress: str(v.contractAddress) ?? '',
    network,
    createdAt,
  };
  const verifierKind = oneOf(v.verifierKind, ['demo', 'friend'] as const);
  if (verifierKind) out.verifierKind = verifierKind;
  if (str(v.verifierName)) out.verifierName = v.verifierName as string;
  if (str(v.beneficiaryName)) out.beneficiaryName = v.beneficiaryName as string;
  const deadlineAt = finite(v.deadlineAt);
  if (deadlineAt && deadlineAt > 0) out.deadlineAt = deadlineAt;
  const lastTxid = lowerHex(v.lastTxid, HEX_TXID);
  if (lastTxid) out.lastTxid = lastTxid;
  const lockTxid = lowerHex(v.lockTxid, HEX_TXID);
  if (lockTxid) out.lockTxid = lockTxid;
  const outcome = oneOf(v.outcome, ['kept', 'broken', 'settled'] as const);
  if (outcome) out.outcome = outcome;
  if (version) out.version = version;
  if (v.verifierRefund === true) out.verifierRefund = true;
  if (verifiers) out.verifiers = verifiers;
  if (threshold) out.threshold = threshold;
  if (quorum) out.quorum = quorum;
  const visibility = oneOf(v.visibility, ['public', 'unlisted'] as const);
  if (visibility) out.visibility = visibility;
  const listSecret = lowerHex(v.listSecret, /^[0-9a-f]{64}$/);
  if (listSecret) out.listSecret = listSecret;
  const listNonce = lowerHex(v.listNonce, /^[0-9a-f]{32}$/);
  if (listNonce) out.listNonce = listNonce;
  const listedAt = finite(v.listedAt);
  if (listedAt) out.listedAt = listedAt;
  return out;
}

/** This browser's pledges, normalized; malformed entries are skipped (never thrown), duplicates keep the first. */
export function parsePledges(raw: string | null): StoredPledge[] {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: StoredPledge[] = [];
  for (const item of data) {
    let p: StoredPledge | null = null;
    try {
      p = normalizePledge(item);
    } catch {
      p = null;
    }
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** Raw stored entries (unparsed), so a save never silently drops records this build can't read. */
function rawEntries(): unknown[] {
  try {
    const data: unknown = JSON.parse(readPledgesRaw(window.localStorage));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function findPledge(raw: string | null, id: string): StoredPledge | undefined {
  return parsePledges(raw).find((p) => p.id === id);
}
