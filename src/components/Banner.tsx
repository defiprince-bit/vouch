import { SLIDES_URL, REPO_URL, EMBER_ADDRESS } from '@/lib/config';

const Todo = () => <span className="todo">TODO</span>;

// BCH Blaze 2026 required banner (every page): presentation, repo, EMBER2026 CashTokens address.
export function Banner() {
  return (
    <div className="banner">
      <div className="banner-inner">
        <span className="banner-kicker">BCH Blaze 2026</span>
        <span className="banner-sep" aria-hidden="true">·</span>
        <span className="banner-item">
          <a href={SLIDES_URL || '#'} target={SLIDES_URL ? '_blank' : undefined} rel="noreferrer">Presentation</a>
          {!SLIDES_URL && <Todo />}
        </span>
        <span className="banner-sep" aria-hidden="true">·</span>
        <span className="banner-item">
          <a href={REPO_URL || '#'} target={REPO_URL ? '_blank' : undefined} rel="noreferrer">GitHub repo</a>
          {!REPO_URL && <Todo />}
        </span>
        <span className="banner-sep" aria-hidden="true">·</span>
        <span className="banner-item">
          <span>EMBER2026</span>
          <span className="addr">{EMBER_ADDRESS || 'bitcoincash:z…placeholder'}</span>
          {!EMBER_ADDRESS && <Todo />}
        </span>
      </div>
    </div>
  );
}
