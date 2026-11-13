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
}

export const PLEDGES_KEY = 'commitcash-pledges';
export const PLEDGES_EVENT = 'commitcash-pledges-changed';
const KEY = PLEDGES_KEY;

export function loadPledges(): StoredPledge[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as StoredPledge[];
  } catch {
    return [];
  }
}

export function savePledge(p: StoredPledge) {
  const all = loadPledges().filter((x) => x.id !== p.id);
  window.localStorage.setItem(KEY, JSON.stringify([p, ...all]));
  window.dispatchEvent(new Event(PLEDGES_EVENT)); // same-tab subscribers (the storage event only fires in other tabs)
}

export function parsePledges(raw: string | null): StoredPledge[] {
  try {
    return JSON.parse(raw ?? '[]') as StoredPledge[];
  } catch {
    return [];
  }
}

export function findPledge(raw: string | null, id: string): StoredPledge | undefined {
  return parsePledges(raw).find((p) => p.id === id);
}
