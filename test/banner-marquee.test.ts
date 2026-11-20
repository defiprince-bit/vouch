import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('banner marquee', () => {
  it('is shared from the root layout so the landing page and app both get it', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toMatch(/import \{ Banner \} from '@\/components\/Banner'/);
    expect(layout).toMatch(/<Banner \/>/);
  });

  it('duplicates the row for a seamless loop and keeps the clone out of the tab order', () => {
    const banner = read('src/components/Banner.tsx');
    expect(banner).toMatch(/banner-clone/);
    expect(banner).toMatch(/aria-hidden="true"/);
    expect(banner).toMatch(/cloned \? -1/);
    expect(banner).toMatch(/tabIndex=\{tabIndex\}/);
  });

  it('uses a CSS transform loop, pauses on hover and focus, and stays static on wide screens', () => {
    const css = read('src/app/app.css');
    expect(css).toMatch(/@keyframes vouch-banner-marquee/);
    expect(css).toMatch(/translate3d\(-50%/);
    expect(css).toMatch(/\.banner:hover \.banner-track/);
    expect(css).toMatch(/\.banner:focus-within \.banner-track/);
    expect(css).toMatch(/animation-play-state:\s*paused/);
    expect(css).toMatch(/@media \(max-width:\s*1279px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/\.banner-clone \{ display: none !important; \}/);
    expect(css).toMatch(/overflow-x:\s*auto/);
  });
});
