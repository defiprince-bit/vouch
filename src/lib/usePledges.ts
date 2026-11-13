'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { parsePledges, readPledgesRaw, PLEDGES_EVENT, type StoredPledge } from './pledges';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(PLEDGES_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(PLEDGES_EVENT, cb);
  };
}

/** Pledges saved in this browser; null during SSR / first paint. */
export function usePledges(): StoredPledge[] | null {
  const raw = useSyncExternalStore(subscribe, () => readPledgesRaw(window.localStorage), () => null);
  return useMemo(() => (raw === null ? null : parsePledges(raw)), [raw]);
}
