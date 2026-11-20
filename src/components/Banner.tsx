import { SLIDES_URL, REPO_URL, EMBER_ADDRESS } from '@/lib/config';

// BCH Blaze 2026 required banner: presentation, repo, EMBER2026 CashTokens address.
// Only items with real values render; with none set the banner is hidden so the live site never shows placeholders.
function BannerContent({ cloned = false }: { cloned?: boolean }) {
  const tabIndex = cloned ? -1 : undefined;
  const items: React.ReactNode[] = [];
  if (SLIDES_URL) {
    items.push(
      <span className="banner-item" key="s">
        <a href={SLIDES_URL} target="_blank" rel="noreferrer" tabIndex={tabIndex}>
          Presentation
        </a>
      </span>,
    );
  }
  if (REPO_URL) {
    items.push(
      <span className="banner-item" key="r">
        <a href={REPO_URL} target="_blank" rel="noreferrer" tabIndex={tabIndex}>
          GitHub repo
        </a>
      </span>,
    );
  }
  if (EMBER_ADDRESS) {
    items.push(
      <span className="banner-item" key="e">
        <span>EMBER2026</span>{' '}
        <span className="addr">{EMBER_ADDRESS}</span>
      </span>,
    );
  }
  return (
    <>
      <span className="banner-kicker">BCH Blaze 2026</span>
      {items.flatMap((it, i) => [
        <span className="banner-sep" aria-hidden="true" key={`sep${i}`}>
          ·
        </span>,
        it,
      ])}
    </>
  );
}

export function Banner() {
  if (!SLIDES_URL && !REPO_URL && !EMBER_ADDRESS) return null;
  return (
    <div className="banner">
      <div className="banner-viewport">
        <div className="banner-track">
          <div className="banner-inner">
            <BannerContent />
          </div>
          <div className="banner-inner banner-clone" aria-hidden="true">
            <BannerContent cloned />
          </div>
        </div>
      </div>
    </div>
  );
}
