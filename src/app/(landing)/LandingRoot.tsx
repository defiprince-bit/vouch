'use client';
import { useLayoutEffect, useRef } from 'react';
import { startLanding } from './landing-motion';

// Client wrapper for the landing page: picks the motion mode, runs section reveals and the
// meadow canvas, and tears everything down on unmount (client-side navigation away from /).
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
    if (q.has('shot')) document.body.classList.add('is-shot');
    const stop = startLanding(root, html.classList.contains('vl-still'));
    return () => {
      stop();
      html.classList.remove('vl-still', 'vl-anim');
      document.body.classList.remove('is-shot');
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
