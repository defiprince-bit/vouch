'use client';
import { useEffect, useState } from 'react';
import type { WallResponse } from './wall';
import type { BchNetwork } from './network';

export interface WallLoad {
  data: WallResponse | null;
  error: string | null;
  /** Set when `network` had nothing listed and chipnet is shown instead. */
  fellBackFrom: BchNetwork | null;
}

async function fetchWall(network: BchNetwork): Promise<WallResponse> {
  const res = await fetch(`/api/wall?network=${network}`);
  const json = (await res.json()) as WallResponse & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** The wall for a network; an empty mainnet wall falls back to chipnet (never an empty wall). */
export function useWall(network: BchNetwork, attempt = 0): WallLoad {
  const [state, setState] = useState<WallLoad & { key: string }>({ key: '', data: null, error: null, fellBackFrom: null });
  const key = `${network}:${attempt}`;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let data = await fetchWall(network);
        let fellBackFrom: BchNetwork | null = null;
        if (data.cards.length === 0 && network !== 'chipnet') {
          data = await fetchWall('chipnet');
          fellBackFrom = network;
        }
        if (live) setState({ key, data, error: null, fellBackFrom });
      } catch (e) {
        if (live) setState({ key, data: null, error: (e as Error).message, fellBackFrom: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [network, key]);
  return state.key === key ? state : { data: null, error: null, fellBackFrom: null };
}
