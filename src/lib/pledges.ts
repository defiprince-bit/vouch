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
  contractAddress: string;
  network: 'chipnet' | 'mainnet';
  createdAt: number;
  lastTxid?: string;
}

export const PLEDGES_KEY = 'commitcash-pledges';
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
}

export function parsePledges(raw: string | null): StoredPledge[] {
  try {
    return JSON.parse(raw ?? '[]') as StoredPledge[];
  } catch {
    return [];
  }
}
