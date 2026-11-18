'use client';
// Client side of "List on the wall": the same staker-proof request a verify link carries (the
// staker's pre-signature over the keep tx for the locked UTXO), posted to /api/wall. The server
// rebuilds the contract, checks the lock on chain and the signature, then stores the terms only.
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { StoredPledge } from './pledges';
import { savePledge } from './pledges';
import { prepareVerifyRequest } from './walletActions';
import { prepareQuorumRequest } from './quorumActions';
import { encodeVerifyRequest } from './share';
import { encodeQuorumRequest } from './quorumShare';

export type ListResult = { ok: true; listedAt: number } | { ok: false; error: string; status?: number };

export async function listOnWall(manager: DappConnectionManager, p: StoredPledge): Promise<ListResult> {
  let link: string;
  try {
    link = p.version === 2 ? encodeQuorumRequest(await prepareQuorumRequest(manager, p)) : encodeVerifyRequest(await prepareVerifyRequest(manager, p));
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'The wallet didn’t sign' };
  }
  const res = await fetch('/api/wall', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ link, habit: p.promise }),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'Couldn’t reach Vouch. Try again.' };
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  // 409 "already listed" counts as listed.
  if (res.ok || (res.status === 409 && /is already on the wall/i.test(json.error ?? ''))) {
    const listedAt = Date.now();
    savePledge({ ...p, visibility: 'public', listedAt });
    return { ok: true, listedAt };
  }
  return { ok: false, error: json.error ?? `HTTP ${res.status}`, status: res.status };
}
