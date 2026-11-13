import { SLIDES_URL, REPO_URL, EMBER_ADDRESS, IS_MAINNET } from '@/lib/config';

// BCH BLAZE 2026 required homepage banner: slides, repo, EMBER2026 CashTokens address.
export function Banner() {
  return (
    <div className="w-full border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">BCH BLAZE 2026</span>
        <a className="underline" href={SLIDES_URL} target="_blank" rel="noreferrer">Slides</a>
        <a className="underline" href={REPO_URL} target="_blank" rel="noreferrer">Repo</a>
        <span className="truncate">EMBER2026: <code>{EMBER_ADDRESS}</code></span>
        <span className="ml-auto rounded bg-black/30 px-2 py-0.5">{IS_MAINNET ? 'MAINNET: real BCH, dust only' : 'Chipnet: test coins, no real funds'}</span>
      </div>
    </div>
  );
}
