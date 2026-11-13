// Display helpers shared by the UI (pure, unit-tested).
export const SATS_PER_BCH = 100_000_000n;
export const BLOCK_SECONDS = 600;

/** "0.05" / "0.00005" BCH -> sats. Returns null for anything that isn't a plain positive decimal with ≤ 8 places. */
export function bchToSats(input: string): bigint | null {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d*)(?:\.(\d{0,8}))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  return BigInt(m[1] || '0') * SATS_PER_BCH + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
}

/** sats -> "0.05 BCH" (trailing zeros trimmed, never scientific notation). */
export function formatBch(sats: bigint | string | number): string {
  const v = BigInt(sats);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / SATS_PER_BCH;
  const frac = (a % SATS_PER_BCH).toString().padStart(8, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''} BCH`;
}

export const formatSats = (sats: bigint | string | number) => `${BigInt(sats).toLocaleString('en-US')} sats`;

/** Blocks (rounded up, at least `min`) until a wall-clock time, assuming ~10-minute blocks. */
export function blocksUntil(targetMs: number, nowMs: number, min = 1): number {
  return Math.max(min, Math.ceil((targetMs - nowMs) / 1000 / BLOCK_SECONDS));
}

/** Estimated wall-clock time of a block height. */
export function estimateBlockTime(height: number, tipHeight: number, nowMs: number): number {
  return nowMs + (height - tipHeight) * BLOCK_SECONDS * 1000;
}

/** "14d 06h 12m" countdown; "0m" when past. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}h ${p(mm)}m` : h > 0 ? `${h}h ${p(mm)}m` : `${mm}m`;
}

/** "27 Nov 2026, 23:59 WAT"-style date in the viewer's timezone. */
export function formatDateTime(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone, timeZoneName: 'short',
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')} ${g('timeZoneName')}`.trim();
}

/** Value for <input type="datetime-local"> in local time. */
export function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** bchtest:qpabcd…wxyz */
export function shortAddr(a: string, keep = 6): string {
  const [prefix, body] = a.includes(':') ? a.split(':') : ['', a];
  if (body.length <= keep * 2 + 1) return a;
  return `${prefix ? prefix + ':' : ''}${body.slice(0, keep)}…${body.slice(-keep)}`;
}
