'use client';
import { useEffect, useState } from 'react';
import type { BchNetwork } from './network';

/**
 * The Vouch demo verifier (operated by this app). `pubkey` is null if it isn't configured; `enabled`
 * is false on networks where it doesn't sign (mainnet, unless the server sets DEMO_VERIFIER_MAINNET=1).
 * Without `network`, `enabled` means "configured".
 */
export function useDemoVerifier(network?: BchNetwork): { loading: boolean; pubkey: string | null; enabled: boolean } {
  const [state, setState] = useState<{ key: string; loading: boolean; pubkey: string | null; enabled: boolean }>({ key: '', loading: true, pubkey: null, enabled: false });
  const key = network ?? '';
  useEffect(() => {
    let alive = true;
    fetch(network ? `/api/verifier?network=${network}` : '/api/verifier')
      .then((r) => r.json() as Promise<{ pubkey: string | null; enabled?: boolean }>)
      .then((j) => alive && setState({ key, loading: false, pubkey: j.pubkey, enabled: !!j.pubkey && j.enabled !== false }))
      .catch(() => alive && setState({ key, loading: false, pubkey: null, enabled: false }));
    return () => {
      alive = false;
    };
  }, [network, key]);
  return state.key === key ? state : { loading: true, pubkey: state.pubkey, enabled: false };
}
