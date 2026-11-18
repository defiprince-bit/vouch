'use client';
import { useLayoutEffect, useRef } from 'react';
import { startSectionReveals } from './landing-reveal';

// Client wrapper for the landing page: picks the motion mode, runs section reveals,
// lazy-loads the meadow canvas, and tears everything down on unmount (client-side
// navigation away from /).
export function LandingRoot({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const html = document.documentElement;
    const q = new URLSearchParams(window.location.search);
    // The inline script in the root layout normally set this before first paint; on a
    // client-side navigation to / it didn't run, so decide here (before paint, layout effect).
    if (!html.classList.contains('vl-still') && !html.classList.contains('vl-anim')) {
      const still = q.has('static') || q.has('shot') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      html.classList.add(still ? 'vl-still' : 'vl-anim');
    }
    // Cancel the inline script's hard reveal timeout — motion JS is running.
    html.classList.add('vl-motion-ready');
    if (q.has('shot')) document.body.classList.add('is-shot');
    const still = html.classList.contains('vl-still');
    const stopReveals = startSectionReveals(root, still);
    let stopMotion: (() => void) | undefined;
    let cancelled = false;
    const motion = import('./landing-motion').then(({ startLanding }) => {
      if (cancelled) return;
      stopMotion = startLanding(root, still);
      if (cancelled) {
        stopMotion();
        stopMotion = undefined;
      }
    });
    return () => {
      cancelled = true;
      stopReveals();
      stopMotion?.();
      void motion;
      html.classList.remove('vl-still', 'vl-anim', 'vl-motion-ready', 'vl-revealed');
      document.body.classList.remove('is-shot');
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
