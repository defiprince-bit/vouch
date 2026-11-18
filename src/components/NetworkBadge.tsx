'use client';
import { useNetwork } from '@/lib/useNetwork';
import { networkLabel, storeNetwork } from '@/lib/network';
import { useWallet } from './WalletProvider';

/** Header network badge; click to switch chipnet ⇄ mainnet (saved in this browser). */
export function NetworkBadge() {
  const network = useNetwork();
  const wallet = useWallet();
  const next = network === 'mainnet' ? 'chipnet' : 'mainnet';
  function toggle() {
    const connected = wallet.state === 'connected';
    const warn =
      next === 'mainnet'
        ? 'Switch to mainnet? Pledges there lock real BCH, so use tiny amounts.'
        : 'Switch to chipnet? Chipnet uses test coins with no value.';
    const reconnect = connected ? '\n\nYour wallet will be disconnected. Switch your wallet to the same network, then connect again.' : '';
    if (!window.confirm(warn + reconnect)) return;
    // WalletProvider drops the session when the network changes (a wallet session is tied to one network).
    storeNetwork(next);
  }
  return (
    <button
      type="button"
      className={`network-badge network-toggle${network === 'mainnet' ? ' is-mainnet' : ''}`}
      onClick={toggle}
      title={`${network === 'mainnet' ? 'Mainnet: real BCH' : 'Chipnet: test coins, no real value'}. Click to switch to ${next}.`}
      aria-label={`Network: ${networkLabel(network)}. Switch to ${next}`}
      data-network={network}
    >
      {networkLabel(network)} <span aria-hidden="true">⇄</span>
    </button>
  );
}

/** Inline name of the active network ("chipnet" / "mainnet"), for copy. */
export function NetworkName() {
  return <>{useNetwork()}</>;
}
