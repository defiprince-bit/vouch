import Link from 'next/link';
import { ConnectWallet } from './ConnectWallet';

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link href="/" className="text-lg font-bold tracking-tight">Commit<span className="text-emerald-400">Cash</span></Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/create" className="hover:text-emerald-300">New pledge</Link>
        <Link href="/pledges" className="hover:text-emerald-300">My pledges</Link>
        <ConnectWallet />
      </nav>
    </header>
  );
}
