import Link from 'next/link';
import { ConnectWallet } from './ConnectWallet';
import { Logo } from './Logo';
import { NetworkBadge } from './NetworkBadge';

export function Header() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <Logo />
        <div className="nav-actions">
          <NetworkBadge />
          <Link className="btn btn-ghost nav-link" href="/pledges">My pledges</Link>
          <Link className="btn btn-ghost nav-link" href="/create">New pledge</Link>
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
