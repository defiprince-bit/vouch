'use client';
import { useEffect, useState } from 'react';

/** Public key of the CommitCash demo verifier (operated by this app), or null if not configured. */
export function useDemoVerifier(): { loading: boolean; pubkey: string | null } {
  const [state, setState] = useState<{ loading: boolean; pubkey: string | null }>({ loading: true, pubkey: null });
  useEffect(() => {
    let alive = true;
    fetch('/api/verifier')
      .then((r) => r.json() as Promise<{ pubkey: string | null }>)
      .then((j) => alive && setState({ loading: false, pubkey: j.pubkey }))
      .catch(() => alive && setState({ loading: false, pubkey: null }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
