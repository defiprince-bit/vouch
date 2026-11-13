import { describe, expect, it } from 'vitest';
import { bchToSats, blocksUntil, estimateBlockTime, formatBch, formatCountdown, formatDateTime, shortAddr } from '../src/lib/format';

describe('format helpers', () => {
  it('parses BCH amounts to sats', () => {
    expect(bchToSats('0.05')).toBe(5_000_000n);
    expect(bchToSats('1')).toBe(100_000_000n);
    expect(bchToSats('.00005')).toBe(5000n);
    expect(bchToSats(' 0.00000001 ')).toBe(1n);
    expect(bchToSats('0.000000001')).toBeNull();
    expect(bchToSats('abc')).toBeNull();
    expect(bchToSats('')).toBeNull();
    expect(bchToSats('-1')).toBeNull();
  });
  it('formats sats as BCH', () => {
    expect(formatBch(5_000_000n)).toBe('0.05 BCH');
    expect(formatBch('10000')).toBe('0.0001 BCH');
    expect(formatBch(100_000_000)).toBe('1 BCH');
    expect(formatBch(1n)).toBe('0.00000001 BCH');
  });
  it('converts times to blocks and back', () => {
    const now = 1_000_000_000_000;
    expect(blocksUntil(now + 7 * 24 * 3600 * 1000, now)).toBe(1008);
    expect(blocksUntil(now + 61_000, now)).toBe(1);
    expect(blocksUntil(now - 1, now, 12)).toBe(12);
    expect(estimateBlockTime(110, 100, now)).toBe(now + 6_000_000);
  });
  it('formats countdowns and dates', () => {
    expect(formatCountdown(((14 * 24 + 6) * 60 + 12) * 60_000 + 59_000)).toBe('14d 06h 12m');
    expect(formatCountdown(65 * 60_000)).toBe('1h 05m');
    expect(formatCountdown(-5)).toBe('0m');
    expect(formatDateTime(Date.UTC(2026, 10, 27, 22, 59), 'Africa/Lagos')).toMatch(/^27 Nov 2026, 23:59 (WAT|GMT\+1)$/);
  });
  it('shortens addresses', () => {
    expect(shortAddr('bchtest:qp34e56f9uvf90zw48z2mmng4963r46seqp57s4td2')).toBe('bchtest:qp34e5…7s4td2');
    expect(shortAddr('short')).toBe('short');
  });
});

import { readPledgesRaw } from '../src/lib/pledges';
describe('pledge storage after the rename', () => {
  const store = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
  it('prefers vouch-pledges, falls back to the legacy commitcash-pledges key', () => {
    expect(readPledgesRaw(store({ 'vouch-pledges': '[1]', 'commitcash-pledges': '[2]' }))).toBe('[1]');
    expect(readPledgesRaw(store({ 'commitcash-pledges': '[2]' }))).toBe('[2]');
    expect(readPledgesRaw(store({}))).toBe('[]');
  });
});
