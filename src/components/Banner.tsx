import { SLIDES_URL, REPO_URL, EMBER_ADDRESS } from '@/lib/config';

// BCH Blaze 2026 required banner: presentation, repo, EMBER2026 CashTokens address.
// Only items with real values render; with none set the banner is hidden so the live site never shows placeholders.
export function Banner() {
  const items: React.ReactNode[] = [];
  if (SLIDES_URL) items.push(<span className="banner-item" key="s"><a href={SLIDES_URL} target="_blank" rel="noreferrer">Presentation</a></span>);
  if (REPO_URL) items.push(<span className="banner-item" key="r"><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub repo</a></span>);
  if (EMBER_ADDRESS) items.push(<span className="banner-item" key="e"><span>EMBER2026</span> <span className="addr">{EMBER_ADDRESS}</span></span>);
  if (items.length === 0) return null;
  return (
    <div className="banner">
      <div className="banner-inner" style={{ flexWrap: 'nowrap', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <span className="banner-kicker">BCH Blaze 2026</span>
        {items.flatMap((it, i) => [<span className="banner-sep" aria-hidden="true" key={`sep${i}`}>·</span>, it])}
      </div>
    </div>
  );
}
