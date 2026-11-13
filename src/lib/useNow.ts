'use client';
import { useSyncExternalStore } from 'react';

// Wall clock as an external store: 0 during prerender, then ticks every 30s on the client.
let now = 0;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      subs.forEach((s) => s());
    }, 30_000);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot() {
  if (!now) now = Date.now();
  return now;
}

/** Current time in ms (0 on the server). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
