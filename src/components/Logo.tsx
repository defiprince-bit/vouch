import Link from 'next/link';

// Text wordmark. Single swap point: replace the contents of this component when the new mark lands.
export function Logo() {
  return (
    <Link href="/" aria-label="CommitCash home" className="font-display text-xl font-extrabold tracking-tight">
      Commit<span className="text-emerald-400">Cash</span>
    </Link>
  );
}
