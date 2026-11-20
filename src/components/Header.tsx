import { ConnectWallet } from './ConnectWallet';
import { Logo } from './Logo';
import { NetworkBadge } from './NetworkBadge';
import { NavLink } from './NavLink';

export function Header() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <Logo />
        <div className="nav-actions">
          <NetworkBadge />
          <NavLink href="/" className="nav-home">Home</NavLink>
          <NavLink href="/wall">Wall</NavLink>
          <NavLink href="/pledges">My pledges</NavLink>
          <NavLink href="/create">New pledge</NavLink>
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
