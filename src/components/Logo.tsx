import Link from 'next/link';

// Single swap point for the brand. Mark: design/logo/mark-ink.svg (copied to /public/brand).
// The wordmark is live text (Syne via next/font) rather than lockup-ink.svg, because an <img> SVG
// can't load the web font. Use variant="dark" on dark surfaces.
export function Logo({ variant = 'ink' }: { variant?: 'ink' | 'dark' }) {
  return (
    <Link className="brand" href="/" aria-label="CommitCash home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand-mark" src={variant === 'dark' ? '/brand/mark-on-dark.svg' : '/brand/mark-ink.svg'} width={32} height={32} alt="" />
      <span className="wordmark">
        Commit<span>Cash</span>
      </span>
    </Link>
  );
}

/** Mark only (ticket stub). */
export function BrandMark({ size = 24 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-mark" src="/brand/mark-ink.svg" width={size} height={size} alt="" />;
}
