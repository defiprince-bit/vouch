'use client';
import { useSyncExternalStore } from 'react';
import { activeNetwork, defaultNetwork, NETWORK_EVENT, NETWORK_STORAGE_KEY, type BchNetwork } from './network';

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === NETWORK_STORAGE_KEY) && cb();
  window.addEventListener('storage', onStorage);
  window.addEventListener(NETWORK_EVENT, cb);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(NETWORK_EVENT, cb);
  };
}

/** The network the app is on (localStorage choice, else NEXT_PUBLIC_BCH_NETWORK). SSR: the default. */
export function useNetwork(): BchNetwork {
  return useSyncExternalStore(subscribe, activeNetwork, defaultNetwork);
}
