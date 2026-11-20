import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatRemaining } from '../src/app/(landing)/TicketCountdown';

const root = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('landing ticket countdown', () => {
  it('formats hh:mm:ss and never goes negative', () => {
    expect(formatRemaining((3 * 3600 + 58 * 60 + 27) * 1000)).toBe('03:58:27');
    expect(formatRemaining(999)).toBe('00:00:01');
    expect(formatRemaining(-5000)).toBe('00:00:00');
  });

  it('renders a fixed server value (no hydration mismatch) and keeps seconds out of screen readers', () => {
    const src = read('src/app/(landing)/TicketCountdown.tsx');
    expect(src).toMatch(/useSyncExternalStore\(subscribe, snapshot, serverSnapshot\)/);
    expect(src).toMatch(/aria-live="off"/);
    expect(src).toMatch(/aria-label=/);
  });

  it('uses the new motto and drops the example tag on the ticket', () => {
    const page = read('src/app/(landing)/page.tsx');
    expect(page).toMatch(/Put your money where/);
    expect(page).not.toMatch(/Example only — not a live pledge/);
    expect(page).not.toMatch(/Say what you’ll do/);
  });
});
