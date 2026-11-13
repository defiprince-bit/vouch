import { IS_MAINNET } from '@/lib/config';

export function NetworkBadge() {
  return IS_MAINNET ? (
    <span className="network-badge is-mainnet" title="Mainnet: real BCH">Mainnet</span>
  ) : (
    <span className="network-badge" title="Chipnet: test coins, no real value">Chipnet</span>
  );
}
