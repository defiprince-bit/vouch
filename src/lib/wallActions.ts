'use client';
// Client side of "List on the wall". The proof is the pledge's listSecret, which only the
// creating browser holds (src/lib/listSecret.ts); no wallet signature is involved. The server
// rebuilds the contract, checks that sha256(secret) + nonce + habit rebuild the pledge id the
// contract commits to, and checks the lock on chain.
import type { StoredPledge } from './pledges';
import { savePledge } from './pledges';
import { secretMatchesPledge } from './listSecret';

export type ListResult = { ok: true; listedAt: number } | { ok: false; error: string; status?: number };

/** Can this browser list `p`? It must hold the secret and nonce the pledge id commits to. */
export const canListHere = (p: StoredPledge) => secretMatchesPledge(p.listSecret, p.listNonce, p.promise, p.id);

export const LIST_ELSEWHERE_COPY =
  'Only the browser that created a pledge can list it. This one doesn’t hold its listing key (the pledge was made on another device, or before the wall existed).';

/** Terms only: what the server needs to rebuild the contract. */
export function wallTerms(p: StoredPledge) {
  const base = { id: p.id, deadline: p.deadline, beneficiaryAddress: p.beneficiaryAddress, stakerPubkey: p.stakerPubkey, network: p.network, contractAddress: p.contractAddress };
  return p.version === 2
    ? { ...base, version: 2 as const, verifierPubkeys: p.verifiers!.map((v) => v.pubkey), threshold: p.threshold! }
    : { ...base, verifierPubkey: p.verifierPubkey };
}

export async function listOnWall(p: StoredPledge): Promise<ListResult> {
  if (!canListHere(p)) return { ok: false, error: LIST_ELSEWHERE_COPY, status: 403 };
  const res = await fetch('/api/wall', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pledge: wallTerms(p), listSecret: p.listSecret, listNonce: p.listNonce, habit: p.promise }),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'Couldn’t reach Vouch. Try again.' };
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  // "already on the wall" counts as listed.
  if (res.ok || (res.status === 409 && /is already on the wall/i.test(json.error ?? ''))) {
    const listedAt = Date.now();
    savePledge({ ...p, visibility: 'public', listedAt });
    return { ok: true, listedAt };
  }
  return { ok: false, error: json.error ?? `HTTP ${res.status}`, status: res.status };
}
