'use client';
import { useSyncExternalStore } from 'react';

// Demo countdown on the landing ticket. It's an illustration, not a live pledge: on every page
// load the deadline is set just under four hours away, then it ticks down once a second.
// The server (and the hydration pass) render a fixed value, so there's no hydration mismatch;
// the client takes over on its first 1s tick.
const START_MS = (3 * 3600 + 59 * 60 + 0) * 1000; // 03:59:00 on load
const SERVER_REMAINING = START_MS;

let deadline = 0;
let remaining = SERVER_REMAINING;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (!deadline) deadline = Date.now() + START_MS;
  let left = deadline - Date.now();
  // Demo loop: if someone leaves the tab open for four hours, start again instead of sitting at zero.
  if (left <= 0) {
    deadline = Date.now() + START_MS;
    left = START_MS;
  }
  remaining = left;
}

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    tick();
    timer = setInterval(() => {
      tick();
      subs.forEach((s) => s());
    }, 1000);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => remaining;
const serverSnapshot = () => SERVER_REMAINING;

const pad = (n: number) => String(n).padStart(2, '0');

/** hh:mm:ss for a remaining time in ms. Exported for tests. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function Runner() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false" className="vl-runner">
      <circle cx="14.5" cy="4" r="2.2" fill="currentColor" />
      <path
        d="M9 21l2.6-5.2 2.9 2.4V22M11.6 15.8l1.1-5.3-3.2 1.2-1.9 3M12.7 10.5l2.4 2.6 3.4.6M6 20.5l3-.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const RUNS = 3;
const DONE = 1;

export function TicketCountdown() {
  const ms = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div className="vl-countdown">
      {/* role=timer is aria-live="off" by default: the label gives the summary, the seconds don't get announced. */}
      <p className="vl-countdown-time" role="timer" aria-live="off" aria-label="Under 4 hours left on this example pledge">
        <span className="vl-countdown-digits" aria-hidden="true">{formatRemaining(ms)}</span>
        <span className="vl-countdown-unit" aria-hidden="true">remaining</span>
      </p>
      <div className="vl-runs" role="group" aria-label={`${RUNS} runs: ${DONE} done, ${RUNS - DONE} to go`}>
        <p className="vl-runs-label" aria-hidden="true">{RUNS} runs</p>
        <ul className="vl-runs-boxes" aria-hidden="true">
          {Array.from({ length: RUNS }, (_, i) => (
            <li key={i} className={i < DONE ? 'is-done' : ''}>
              <Runner />
              {i < DONE ? (
                <svg className="vl-run-check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
