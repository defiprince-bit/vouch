// Copy the design pack's stylesheet into the app, pointing the font stacks at next/font.
// Usage: node scripts/sync-design-css.mjs [/path/to/design/mocks/styles.css]
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const src = process.argv[2] ?? '../bchblaze/design/mocks/styles.css';
let css = readFileSync(src, 'utf8');
const swap = [
  [/--font-display:[^;]*;/, '--font-display: var(--font-syne), "Syne", ui-sans-serif, sans-serif;'],
  [/--font-body:[^;]*;/, '--font-body: var(--font-figtree), "Figtree", ui-sans-serif, sans-serif;'],
  [/--font-mono:[^;]*;/, '--font-mono: var(--font-dm-mono), "DM Mono", ui-monospace, monospace;'],
];
for (const [re, to] of swap) {
  if (!re.test(css)) throw new Error(`design css: ${re} not found`);
  css = css.replace(re, to);
}
const stamp = statSync(src).mtime.toISOString();
writeFileSync('src/app/design.css', `/* Synced from the design pack (styles.css, modified ${stamp}). Edit app overrides in app.css, not here. */\n${css}`);
console.log(`synced ${src} (${stamp})`);
