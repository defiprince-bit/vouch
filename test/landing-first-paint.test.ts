import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('landing first paint', () => {
  it('keeps the hero visible in the SSR markup so LCP is not blocked on motion JS', () => {
    const page = read('src/app/(landing)/page.tsx');
    expect(page).toMatch(/className="vl-hero vl-doc is-in"/);
  });

  it('swaps the Newsreader font so italic fallback text is visible while it loads', () => {
    const page = read('src/app/(landing)/page.tsx');
    expect(page).toMatch(/Newsreader\(\{[\s\S]*display:\s*'swap'/);
  });

  it('hides reveal elements only under html.vl-anim, with a hard fallback class', () => {
    const css = read('src/app/(landing)/landing.css');
    expect(css).toMatch(/\.vl-anim \.vl-r \{ opacity: 0;/);
    expect(css).not.toMatch(/(?<!\.vl-anim )\.vl-r \{ opacity: 0;/);
    expect(css).toMatch(/html\.vl-revealed \.vl-r/);
  });

  it('opts into motion before first paint and reveals everything if motion JS is late', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toMatch(/vl-still/);
    expect(layout).toMatch(/vl-anim/);
    expect(layout).toMatch(/vl-motion-ready/);
    expect(layout).toMatch(/vl-revealed/);
    expect(layout).toMatch(/setTimeout\(/);
    expect(layout).toMatch(/static/);
    expect(layout).toMatch(/prefers-reduced-motion/);
  });

  it('lazy-loads the meadow canvas and cancels the reveal timeout once motion is running', () => {
    const rootTsx = read('src/app/(landing)/LandingRoot.tsx');
    expect(rootTsx).toMatch(/startSectionReveals/);
    expect(rootTsx).toMatch(/import\('\.\/landing-motion'\)/);
    expect(rootTsx).toMatch(/vl-motion-ready/);
  });
});
