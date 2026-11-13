import Link from 'next/link';
import { ConnectWallet } from './ConnectWallet';
import { Logo } from './Logo';
import { NetworkBadge } from './NetworkBadge';

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <Logo />
        <NetworkBadge />
      </div>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/create" className="hover:text-emerald-300">New pledge</Link>
        <Link href="/pledges" className="hover:text-emerald-300">My pledges</Link>
        <ConnectWallet />
      </nav>
    </header>
  );
}
